using System.Runtime.InteropServices;
using ICorDebugSharp;
using ICorDebugSharp.Extensions;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// One breakpoint the client asked for, expressed the way the engine understands it: a module, a
/// metadata token and an IL offset. The offset is always a sequence point — the runtime rejects
/// anything else with <c>BreakpointSetError</c> — which is what the symbol resolver snaps to.
/// </summary>
internal sealed class BreakpointEntry {
	public const string LineKind = "line";
	public const string FunctionKind = "function";

	public required string Id { get; init; }

	/// <summary>Line or function; the two are set independently and must not evict each other.</summary>
	public string Kind { get; init; } = LineKind;

	public required string ModulePath { get; init; }

	public required int MetadataToken { get; init; }

	/// <summary>
	/// Where the statement's own code starts, which is the offset a stop is reported at. It is tried
	/// first, but the runtime does not always accept a breakpoint there (see
	/// <see cref="SequencePointIlOffset"/>).
	/// </summary>
	public required int IlOffset { get; init; }

	/// <summary>
	/// The start of the sequence point tiling the IL at <see cref="IlOffset"/>, the only kind of
	/// offset the runtime will place a breakpoint on. Settable by the resolver; null when it has no
	/// better answer than <see cref="IlOffset"/> itself.
	/// </summary>
	public int? SequencePointIlOffset { get; init; }

	/// <summary>Where the engine breakpoint is actually placed, for identity based callbacks.</summary>
	public int BoundIlOffset { get; set; }

	/// <summary>The offsets the runtime has already refused, so a retry does not repeat them.</summary>
	public HashSet<int> RefusedOffsets { get; } = new();

	/// <summary>The module the entry is bound to, which a retry binds against again.</summary>
	public ICorDebugModule? Module { get; set; }

	/// <summary>The line the client asked for, before it was snapped to a sequence point.</summary>
	public int RequestedLine { get; init; }

	public int Line { get; init; }

	public int EndLine { get; init; }

	public int Column { get; init; }

	public int EndColumn { get; init; }

	public string? Description { get; init; }

	public bool Enabled { get; set; } = true;

	/// <summary>The engine breakpoint, once the module that owns it is loaded.</summary>
	public ICorDebugFunctionBreakpoint? Breakpoint { get; set; }

	/// <summary>Why the breakpoint is not usable, when it is not. Null means it is fine.</summary>
	public string? Message { get; set; }

	public bool IsBound => Breakpoint is not null;

	/// <summary>
	/// The offsets the breakpoint may be placed at, in the order they are tried: the start of the
	/// statement's own code, then the sequence point tiling it. The runtime refuses a breakpoint that
	/// is not on a point boundary with <c>BreakpointSetError</c> — asynchronously, after creation has
	/// already succeeded — so both are kept as fallbacks rather than only the one it prefers.
	/// </summary>
	public IEnumerable<int> CandidateOffsets {
		get {
			if (!RefusedOffsets.Contains(IlOffset))
				yield return IlOffset;
			if (SequencePointIlOffset is { } point && point != IlOffset && !RefusedOffsets.Contains(point))
				yield return point;
		}
	}
}

/// <summary>
/// The session's breakpoints. A request almost always arrives before the module it refers to is
/// loaded — the debuggee is suspended at startup and the client sets breakpoints immediately — so
/// entries live here unbound until <see cref="BindModule"/> sees their module come in.
/// </summary>
internal sealed class BreakpointTable {
	readonly object gate = new();
	readonly List<BreakpointEntry> entries = new();

	/// <summary>
	/// Replaces the entries of one kind. Line and function breakpoints are set by separate commands,
	/// so a request for one must not drop the other.
	/// </summary>
	public void Replace(string kind, IReadOnlyList<BreakpointEntry> requested) {
		lock (gate) {
			foreach (var entry in entries.Where(entry => entry.Kind == kind).ToArray()) {
				Deactivate(entry);
				entries.Remove(entry);
			}
			entries.AddRange(requested);
		}
	}

	public void Clear() {
		lock (gate) {
			foreach (var entry in entries)
				Deactivate(entry);
			entries.Clear();
		}
	}

	public BreakpointEntry? Find(string id) {
		lock (gate)
			return entries.FirstOrDefault(entry => entry.Id == id);
	}

	public IReadOnlyList<BreakpointEntry> Snapshot() {
		lock (gate)
			return entries.ToArray();
	}

	/// <summary>Binds every unbound entry that belongs to a module which has just loaded.</summary>
	public IReadOnlyList<BreakpointEntry> BindModule(ICorDebugModule module) {
		var modulePath = TryGetModulePath(module);
		var bound = new List<BreakpointEntry>();
		lock (gate) {
			foreach (var entry in entries) {
				if (entry.IsBound || !PathsMatch(entry.ModulePath, modulePath))
					continue;
				if (TryBind(module, modulePath, entry))
					bound.Add(entry);
			}
		}
		return bound;
	}

	public void UnbindModule(ICorDebugModule module) {
		var modulePath = TryGetModulePath(module);
		lock (gate) {
			foreach (var entry in entries) {
				if (!entry.IsBound || !PathsMatch(entry.ModulePath, modulePath))
					continue;
				Deactivate(entry);
				entry.Message = "Module not loaded yet.";
			}
		}
	}

	/// <summary>Finds the entry an engine breakpoint belongs to, for identity based callbacks.</summary>
	public BreakpointEntry? FindByEngineIdentity(uint token, int ilOffset) {
		lock (gate) {
			foreach (var entry in entries) {
				// The engine knows the offset the breakpoint was placed at, which is the fallback one
				// whenever the statement's own start was refused.
				if (entry.MetadataToken == unchecked((int)token) && entry.BoundIlOffset == ilOffset && entry.IsBound)
					return entry;
			}
			return null;
		}
	}

	bool TryBind(ICorDebugModule module, string modulePath, BreakpointEntry entry) {
		try {
			var function = module.GetFunctionFromToken(unchecked((int)entry.MetadataToken));
			// The candidates are tried in order: creation itself fails outright for an offset the
			// runtime cannot use, and when it does not, the refusal arrives later as
			// OnBreakpointSetError, which calls back in here with that offset marked refused.
			foreach (var offset in entry.CandidateOffsets) {
				try {
					var breakpoint = function.ILCode.CreateBreakpoint(offset);
					breakpoint.Activate(entry.Enabled);
					entry.Breakpoint = breakpoint;
					entry.BoundIlOffset = offset;
					entry.Module = module;
					entry.Message = null;
					return true;
				}
				catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
					entry.RefusedOffsets.Add(offset);
				}
			}
			// The token is not in this module, or the method has no IL body the engine can hook.
			entry.Breakpoint = null;
			entry.Module = null;
			entry.Message = $"Metadata token 0x{entry.MetadataToken:X8} could not be bound in {System.IO.Path.GetFileName(modulePath)}.";
			return false;
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			entry.Breakpoint = null;
			entry.Module = null;
			entry.Message = $"Metadata token 0x{entry.MetadataToken:X8} could not be bound in {System.IO.Path.GetFileName(modulePath)}.";
			return false;
		}
	}

	/// <summary>
	/// The runtime refused a breakpoint it had already accepted, which it reports when the code is
	/// first jitted. The entry is moved to its next candidate offset; when there is none left it stays
	/// unbound and the caller reports why.
	/// </summary>
	/// <returns>True when the entry was rebound elsewhere, false when nothing more can be tried.</returns>
	public bool RetryAtFallback(uint token, int ilOffset) {
		lock (gate) {
			foreach (var entry in entries) {
				if (!entry.IsBound || entry.MetadataToken != unchecked((int)token) || entry.BoundIlOffset != ilOffset)
					continue;
				var module = entry.Module;
				Deactivate(entry);
				entry.RefusedOffsets.Add(ilOffset);
				entry.Message = null;
				if (module is not null && TryBind(module, entry.ModulePath, entry))
					return true;
				entry.Message = $"Breakpoint could not be bound after the runtime refused IL offset {ilOffset}.";
				return false;
			}
			return false;
		}
	}

	public void SetEnabled(BreakpointEntry entry, bool enabled) {
		entry.Enabled = enabled;
		if (entry.Breakpoint is null)
			return;
		try {
			entry.Breakpoint.Activate(enabled);
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			entry.Breakpoint = null;
			entry.Message = "Module not loaded yet.";
		}
	}

	public void SetMessage(BreakpointEntry entry, string? message, bool dropBreakpoint) {
		if (dropBreakpoint)
			Deactivate(entry);
		entry.Message = message;
	}

	static void Deactivate(BreakpointEntry entry) {
		var breakpoint = entry.Breakpoint;
		entry.Breakpoint = null;
		if (breakpoint is null)
			return;
		try {
			breakpoint.Activate(false);
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			// The process is gone; there is nothing left to deactivate.
		}
	}

	internal static string TryGetModulePath(ICorDebugModule module) {
		try {
			return module.Name ?? string.Empty;
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			return string.Empty;
		}
	}

	/// <summary>
	/// The resolver speaks in the paths the workspace knows, the runtime in the paths it loaded.
	/// They normally agree on Linux; the file-name fallback covers a debuggee started elsewhere.
	/// </summary>
	internal static bool PathsMatch(string left, string right) {
		if (string.IsNullOrEmpty(left) || string.IsNullOrEmpty(right))
			return false;
		if (string.Equals(System.IO.Path.GetFullPath(left), System.IO.Path.GetFullPath(right), StringComparison.Ordinal))
			return true;
		return string.Equals(System.IO.Path.GetFileName(left), System.IO.Path.GetFileName(right), StringComparison.OrdinalIgnoreCase);
	}
}
