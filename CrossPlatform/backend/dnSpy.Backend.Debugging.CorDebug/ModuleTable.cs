using System.Runtime.InteropServices;
using dnSpy.Backend.Contracts;
using ICorDebugSharp;
using ICorDebugSharp.Extensions;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Tracks the modules the runtime reports through <c>LoadModule</c>/<c>UnloadModule</c>. Modules
/// carry the metadata the engine needs to turn a <c>(token, IL offset)</c> pair into a breakpoint,
/// so the table is also the lookup the breakpoint table binds against.
/// </summary>
internal sealed class ModuleTable {
	readonly object gate = new();
	readonly List<ModuleEntry> modules = new();

	public void Add(ICorDebugModule module) {
		var entry = ModuleEntry.Create(module);
		lock (gate) {
			modules.RemoveAll(existing => string.Equals(existing.Path, entry.Path, StringComparison.Ordinal));
			modules.Add(entry);
		}
	}

	public void Remove(ICorDebugModule module) {
		var token = TryGetToken(module);
		lock (gate) {
			if (token is not null)
				modules.RemoveAll(existing => existing.Token == token.Value);
		}
	}

	public IReadOnlyList<DebugModuleDto> Snapshot() {
		ModuleEntry[] snapshot;
		lock (gate)
			snapshot = modules.ToArray();
		return snapshot
			.OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
			.Select(entry => new DebugModuleDto(entry.Path, entry.Name, entry.Path, null, "No symbols (IL only)"))
			.ToArray();
	}

	/// <summary>The loaded modules, for callers that need to sweep all of them.</summary>
	public IReadOnlyList<ICorDebugModule> Enumerate() {
		lock (gate)
			return modules.Select(entry => entry.Module).ToArray();
	}

	/// <summary>Finds a loaded module by absolute path, falling back to a file-name match.</summary>
	public ICorDebugModule? Find(string path) {
		ModuleEntry[] snapshot;
		lock (gate)
			snapshot = modules.ToArray();
		foreach (var entry in snapshot) {
			if (string.Equals(entry.Path, path, StringComparison.Ordinal))
				return entry.Module;
		}
		var fileName = Path.GetFileName(path);
		foreach (var entry in snapshot) {
			if (string.Equals(Path.GetFileName(entry.Path), fileName, StringComparison.OrdinalIgnoreCase))
				return entry.Module;
		}
		return null;
	}

	public ICorDebugModule? FindByToken(int token) {
		lock (gate)
			return modules.FirstOrDefault(entry => entry.Token == token)?.Module;
	}

	public void Clear() {
		lock (gate)
			modules.Clear();
	}

	static int? TryGetToken(ICorDebugModule module) {
		try {
			return module.Token;
		}
		catch (Exception ex) when (IsComFailure(ex)) {
			return null;
		}
	}

	internal static bool IsComFailure(Exception ex) =>
		ex is COMException or InvalidCastException or InvalidOperationException or NotSupportedException;

	internal sealed record ModuleEntry(int Token, string Path, string Name, ICorDebugModule Module) {
		public static ModuleEntry Create(ICorDebugModule module) {
			string path;
			try {
				// On Linux this is the absolute path of the file the module was loaded from.
				path = module.Name ?? string.Empty;
			}
			catch (Exception ex) when (IsComFailure(ex)) {
				path = string.Empty;
			}
			var token = TryGetToken(module) ?? 0;
			// Fully qualified: the enclosing record's Path property would otherwise win here.
			return new ModuleEntry(token, path, string.IsNullOrEmpty(path) ? path : System.IO.Path.GetFileName(path), module);
		}
	}
}
