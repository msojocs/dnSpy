using System.Globalization;
using System.Text.Json;
using dnSpy.Backend.Contracts;
using ICorDebugSharp;
using ICorDebugSharp.Extensions;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// The stack and value half of a session: the frames of a stopped thread, the scopes of a frame, and
/// the arguments and locals inside it.
/// </summary>
/// <remarks>
/// Frames are addressed by an id the engine hands out, because an ICorDebug frame has no identity of
/// its own and stops being valid as soon as the process runs again. Everything that has to be
/// decompiled — a frame's line, a local's name — happens off the dispatcher: the debuggee stays
/// suspended while it runs, but holding the COM thread through a decompilation would stall the pump.
/// </remarks>
internal sealed partial class CorDebugSession {
	/// <summary>
	/// How many frames of one stack get their decompiled line looked up. The frames nearest the stop
	/// are the ones a user navigates; resolving a hundred of them would decompile a hundred methods.
	/// </summary>
	const int MaxResolvedFrames = 24;

	const string RunningReason = "The process is running.";

	readonly FrameTable frameTable = new();
	readonly VariableTable variableTable = new();
	ManagedValueFormatter? valueFormatter;

	ManagedValueFormatter Formatter => valueFormatter ??= new ManagedValueFormatter(variableTable);

	/// <summary>An identity the client can address: the frame id, and where the frame is.</summary>
	sealed record RawFrame(int Id, string ModulePath, int MetadataToken, int IlOffset);

	/// <summary>One value read off a frame, before the decompiler has had a say about its name.</summary>
	sealed record RawVariable(bool IsArgument, int Index, string Text, string? TypeName, int VariablesReference);

	/// <summary>The values of one frame, and the body they belong to, so names can be looked up.</summary>
	sealed record VariableSnapshot(string ModulePath, int MetadataToken, IReadOnlyList<RawVariable> Variables);

	// ---------------------------------------------------------------- stack trace

	internal async Task<JsonElement> StackTraceAsync(JsonElement? arguments, CancellationToken cancellationToken) {
		var args = arguments is { ValueKind: JsonValueKind.Object } value ? value : default;
		var threadId = GetInt(args, "threadId") ?? 0;
		var startFrame = Math.Max(GetInt(args, "startFrame") ?? 0, 0);
		var levels = GetInt(args, "levels") ?? 0;

		var snapshot = await Dispatcher.RunAsync(() => SnapshotFrames(threadId, startFrame, levels)).ConfigureAwait(false);
		var resolved = await ResolveFramesAsync(snapshot, cancellationToken).ConfigureAwait(false);
		return JsonSerializer.SerializeToElement(new {
			stackFrames = resolved,
			totalFrames = resolved.Length,
		});
	}

	/// <summary>Walks the stopped thread and registers what it finds, so scopes can come back to it.</summary>
	IReadOnlyList<RawFrame> SnapshotFrames(int threadId, int startFrame, int levels) {
		if (!IsStopped)
			throw new RpcException(ErrorCodes.InvalidParams, RunningReason);
		var thread = Threads.Find(threadId) ?? throw new RpcException(ErrorCodes.InvalidParams, $"There is no thread with id {threadId}.");
		var frames = new List<RawFrame>();
		// The active chain holds the frame the thread stopped in; each caller chain holds the frames
		// that were running when it was called. Enumerating from the active chain outwards is what
		// puts the innermost frame first, which is the order the client numbers them in.
		var chain = thread.ActiveChain;
		for (var depth = 0; chain is not null && depth < 64; depth++) {
			if (chain.IsManaged) {
				foreach (var frame in chain.Frames) {
					var entry = frameTable.Add(frame, threadId);
					var (modulePath, token) = FrameIdentity(frame);
					frames.Add(new RawFrame(entry.Id, modulePath, token, ReadIlOffset(frame)));
				}
			}
			chain = chain.Caller;
		}
		return startFrame >= frames.Count
			? Array.Empty<RawFrame>()
			: (levels > 0 ? frames.Skip(startFrame).Take(levels) : frames.Skip(startFrame)).ToArray();
	}

	/// <summary>
	/// Names the frames the decompiler knows, and gives the rest the identity their metadata carries.
	/// Only the workspace's own modules are looked up: a frame in the framework has no source to show,
	/// and loading one to name it would cost more than the name is worth.
	/// </summary>
	async Task<object[]> ResolveFramesAsync(IReadOnlyList<RawFrame> frames, CancellationToken cancellationToken) {
		var workspaceModules = new Dictionary<string, bool>(StringComparer.Ordinal);
		var resolved = new object[frames.Count];
		var budget = MaxResolvedFrames;
		for (var index = 0; index < frames.Count; index++) {
			var frame = frames[index];
			var name = Describe(frame);
			var line = 0;
			var column = 0;
			string? nodeId = null;
			if (budget > 0 && SymbolResolver is not null && !string.IsNullOrEmpty(frame.ModulePath) &&
				await IsWorkspaceModuleAsync(frame.ModulePath, workspaceModules, cancellationToken).ConfigureAwait(false)) {
				budget--;
				var location = await SymbolResolver.ResolveIlLocationAsync(WorkspaceId, frame.ModulePath, frame.MetadataToken, frame.IlOffset, cancellationToken).ConfigureAwait(false);
				if (location is not null) {
					name = location.Description ?? name;
					line = location.StartLine;
					column = location.StartColumn;
					nodeId = location.NodeId;
				}
			}
			resolved[index] = new {
				id = frame.Id,
				name,
				line,
				column,
				source = string.IsNullOrEmpty(frame.ModulePath)
					? null
					: new { name = Path.GetFileName(frame.ModulePath), path = frame.ModulePath },
				nodeId,
			};
		}
		return resolved;
	}

	async Task<bool> IsWorkspaceModuleAsync(string modulePath, Dictionary<string, bool> cache, CancellationToken cancellationToken) {
		if (cache.TryGetValue(modulePath, out var known))
			return known;
		var isWorkspace = await SymbolResolver!.IsWorkspaceModuleAsync(WorkspaceId, modulePath, cancellationToken).ConfigureAwait(false);
		cache[modulePath] = isWorkspace;
		return isWorkspace;
	}

	/// <summary>What a frame is called when no decompiled name is available for it.</summary>
	static string Describe(RawFrame frame) => string.IsNullOrEmpty(frame.ModulePath)
		? $"0x{frame.MetadataToken:X8}"
		: $"{Path.GetFileName(frame.ModulePath)}!0x{frame.MetadataToken:X8}";

	/// <summary>The module and method a frame runs, read the way the resolver spells them.</summary>
	static (string ModulePath, int MetadataToken) FrameIdentity(ICorDebugFrame frame) {
		try {
			var module = frame.Function.Module;
			return (module is null ? string.Empty : BreakpointTable.TryGetModulePath(module), unchecked((int)frame.FunctionToken.Value));
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			return (string.Empty, 0);
		}
	}

	/// <summary>
	/// The IL offset a frame is stopped at. The instruction pointer reports the instruction the frame
	/// is about to execute, which is the location itself: a breakpoint at <c>IL_0001</c> reports
	/// <c>IP = 1</c>, and so does a step that has just run the instruction at <c>IL_0000</c>. That is
	/// worth stating because the Windows debugger APIs report the instruction just executed instead,
	/// and an offset shifted by one would miss every sequence point after the first.
	/// </summary>
	static int ReadIlOffset(ICorDebugFrame frame) {
		if (frame is not ICorDebugILFrame ilFrame)
			return -1;
		try {
			var (offset, _) = ilFrame.IP;
			return offset;
		}
		catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
			return -1;
		}
	}

	// ---------------------------------------------------------------- scopes

	internal JsonElement Scopes(JsonElement? arguments) {
		var args = arguments is { ValueKind: JsonValueKind.Object } value ? value : default;
		var frameId = GetInt(args, "frameId") ?? 0;
		var entry = frameTable.Find(frameId) ?? throw new RpcException(ErrorCodes.InvalidParams, $"There is no frame with id {frameId}; it belongs to an earlier stop.");
		if (entry.Frame is not ICorDebugILFrame ilFrame)
			return JsonSerializer.SerializeToElement(new { scopes = Array.Empty<object>() });
		if (entry.LocalsReference == 0)
			entry.LocalsReference = variableTable.Add(new FrameScopeEntry(ilFrame));
		return JsonSerializer.SerializeToElement(new {
			scopes = new object[] {
				// Arguments come first because that is how the Locals window reads in dnSpy: what the
				// method was called with, then what it has computed so far.
				new { name = "Locals", variablesReference = entry.LocalsReference, expensive = false },
			},
		});
	}

	// ---------------------------------------------------------------- variables

	internal async Task<JsonElement> VariablesAsync(JsonElement? arguments, CancellationToken cancellationToken) {
		var args = arguments is { ValueKind: JsonValueKind.Object } value ? value : default;
		var reference = GetInt(args, "variablesReference") ?? 0;
		if (!IsStopped)
			throw new RpcException(ErrorCodes.InvalidParams, RunningReason);
		var entry = variableTable.Find(reference) ?? throw new RpcException(ErrorCodes.InvalidParams, $"There is no variable set with reference {reference}; it belongs to an earlier stop.");

		if (entry is not FrameScopeEntry scope) {
			var children = await Dispatcher.RunAsync(() => Formatter.Children(entry).Select(child => {
				var formatted = Formatter.Format(child.Value);
				return (child.Name, formatted.Text, formatted.TypeName, formatted.VariablesReference);
			}).ToArray()).ConfigureAwait(false);
			return JsonSerializer.SerializeToElement(new {
				variables = children.Select(child => new {
					name = child.Name,
					value = child.Text,
					type = child.TypeName,
					variablesReference = child.VariablesReference,
				}).ToArray(),
			});
		}

		// The values are read on the dispatcher, where the COM objects live; the names come from the
		// decompiler afterwards, because decompiling on the dispatcher would stall the event pump.
		var snapshot = await Dispatcher.RunAsync(() => ReadFrameVariables(scope)).ConfigureAwait(false);
		var names = SymbolResolver is null || string.IsNullOrEmpty(snapshot.ModulePath)
			? Array.Empty<DebugVariableNameDto>()
			: await SymbolResolver.GetVariableNamesAsync(WorkspaceId, snapshot.ModulePath, snapshot.MetadataToken, cancellationToken).ConfigureAwait(false);
		var argumentsByName = names.Where(name => name.IsArgument).ToDictionary(name => name.Index);
		var localsByName = names.Where(name => !name.IsArgument).ToDictionary(name => name.Index);
		return JsonSerializer.SerializeToElement(new {
			variables = snapshot.Variables.Select(variable => {
				var known = (variable.IsArgument ? argumentsByName : localsByName).GetValueOrDefault(variable.Index);
				return new {
					name = known?.Name ?? (variable.IsArgument ? $"arg{variable.Index.ToString(CultureInfo.InvariantCulture)}" : $"local{variable.Index.ToString(CultureInfo.InvariantCulture)}"),
					value = variable.Text,
					// The decompiler knows the declared type; the runtime only the one it was handed.
					type = known is null || string.IsNullOrEmpty(known.TypeName) ? variable.TypeName : known.TypeName,
					variablesReference = variable.VariablesReference,
				};
			}).ToArray(),
		});
	}

	/// <summary>Reads a frame's arguments and locals, in the order the client lists them.</summary>
	VariableSnapshot ReadFrameVariables(FrameScopeEntry scope) {
		var frame = scope.Frame;
		var (modulePath, token) = FrameIdentity(frame);
		var variables = new List<RawVariable>();
		var index = 0;
		foreach (var argument in frame.Arguments) {
			var formatted = Formatter.Format(argument);
			// A slot the runtime cannot describe is still listed: its position is what the client
			// matches a name against, and hiding it would silently shift every name after it.
			variables.Add(new RawVariable(true, index++, formatted.Text, formatted.TypeName, formatted.VariablesReference));
		}
		index = 0;
		foreach (var local in frame.LocalVariables) {
			var formatted = Formatter.Format(local);
			variables.Add(new RawVariable(false, index++, formatted.Text, formatted.TypeName, formatted.VariablesReference));
		}
		return new VariableSnapshot(modulePath, token, variables);
	}
}
