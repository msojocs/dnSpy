using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Resources;
using System.Security.Cryptography;
using System.Text;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using dnSpy.Backend.Contracts;
using ICSharpCode.Decompiler;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.OutputVisitor;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.Disassembler;
using ICSharpCode.CodeConverter;
using ICSharpCode.BamlDecompiler;
using DecompilerAstNode = ICSharpCode.Decompiler.CSharp.Syntax.AstNode;
using DecompilerILFunction = ICSharpCode.Decompiler.IL.ILFunction;
// Imported by alias: the namespace itself would make dnlib's Parameter ambiguous with the metadata one.
using PdbReaderProvider = System.Reflection.Metadata.MetadataReaderProvider;
using DecompilerILVariable = ICSharpCode.Decompiler.IL.ILVariable;
using DecompilerVariableKind = ICSharpCode.Decompiler.IL.VariableKind;
using DecompilerIMember = ICSharpCode.Decompiler.TypeSystem.IMember;
using DecompilerIType = ICSharpCode.Decompiler.TypeSystem.IType;
using DecompilerMetadataFile = ICSharpCode.Decompiler.Metadata.MetadataFile;

namespace dnSpy.Backend.Core;

public sealed class WorkspaceManager : IDisposable, IDebugSymbolResolver {
	const int MaxHexReadLength = 1024 * 1024;
	readonly ConcurrentDictionary<string, Workspace> workspaces = new(StringComparer.Ordinal);
	readonly SymbolResolver symbols = new();
	bool disposed;

	public async Task<OpenWorkspaceResponse> OpenAsync(OpenWorkspaceRequest request, CancellationToken cancellationToken) {
		ObjectDisposedException.ThrowIf(disposed, this);
		if (request.Paths.Count == 0)
			throw new RpcException(ErrorCodes.InvalidParams, "At least one path is required.");

		var paths = ExpandPaths(request.Paths);
		if (paths.Count == 0)
			throw new RpcException(ErrorCodes.FileNotFound, "No managed assemblies were found in the selected paths.");

		var workspace = new Workspace(symbols);
		try {
			await workspace.OpenAsync(paths, cancellationToken).ConfigureAwait(false);
			if (!workspaces.TryAdd(workspace.Id, workspace))
				throw new InvalidOperationException("Could not register the workspace.");
			return workspace.CreateOpenResponse();
		}
		catch {
			workspace.Dispose();
			throw;
		}
	}

	public void Close(WorkspaceRequest request) {
		if (workspaces.TryRemove(request.WorkspaceId, out var workspace))
			workspace.Dispose();
	}

	public Task<TreeNodesResponse> GetRootsAsync(WorkspaceRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetRoots(), cancellationToken);

	public Task<TreeNodesResponse> GetChildrenAsync(NodeRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetChildren(request.NodeId), cancellationToken);

	public Task<TreeNodeDto> GetNodeAsync(NodeRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetNodeDto(request.NodeId), cancellationToken);

	public Task<DecompileResponse> DecompileAsync(DecompileRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.DecompileAsync(request, cancellationToken), cancellationToken);

	public Task<FindMemberResponse> FindMemberAsync(FindMemberRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.FindMember(request.ModulePath, request.MetadataToken), cancellationToken);

	public Task<SearchResponse> SearchAsync(SearchRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.Search(request, cancellationToken), cancellationToken);

	public Task<AnalyzeReferencesResponse> AnalyzeReferencesAsync(AnalyzeReferencesRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.AnalyzeReferences(request, cancellationToken), cancellationToken);

	public Task<HexLengthResponse> GetHexLengthAsync(HexLengthRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetHexLength(request.ModuleId), cancellationToken);

	public async Task<HexReadResponse> ReadHexAsync(HexReadRequest request, CancellationToken cancellationToken) {
		if (request.Offset < 0 || request.Count < 0)
			throw new RpcException(ErrorCodes.InvalidParams, "Offset and count must not be negative.");
		if (request.Count > MaxHexReadLength)
			throw new RpcException(ErrorCodes.RangeTooLarge, $"A hex read is limited to {MaxHexReadLength} bytes.");
		return await GetWorkspace(request.WorkspaceId).RunAsync(
			w => w.ReadHexAsync(request.ModuleId, request.Offset, request.Count, cancellationToken),
			cancellationToken).ConfigureAwait(false);
	}

	public Task<ModuleInfoResponse> GetModuleInfoAsync(ModuleInfoRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetModuleInfo(request.ModuleId), cancellationToken);

	public Task<BeginEditResponse> BeginEditAsync(BeginEditRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.BeginEdit(), cancellationToken);

	public Task<MethodBodyResponse> GetMethodBodyAsync(MethodBodyRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.GetMethodBody(request.MethodNodeId), cancellationToken);

	public Task QueueRenameAsync(RenameEditRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueRename(request);
			return true;
		}, cancellationToken);

	public Task QueueDeleteAsync(DeleteEditRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueDelete(request);
			return true;
		}, cancellationToken);

	public Task QueueSetNamespaceAsync(SetNamespaceEditRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueSetNamespace(request);
			return true;
		}, cancellationToken);

	public Task QueueMethodBodyAsync(ReplaceMethodBodyRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueMethodBody(request);
			return true;
		}, cancellationToken);

	public Task QueueMethodBodyStubAsync(ReplaceMethodBodyWithStubRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueMethodBodyStub(request);
			return true;
		}, cancellationToken);

	public Task QueueResourceAsync(ReplaceResourceRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.QueueResource(request);
			return true;
		}, cancellationToken);

	public Task<EditCommitResponse> CommitEditAsync(EditTransactionRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.CommitEdit(request.TransactionId), cancellationToken);

	public Task RollbackEditAsync(EditTransactionRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => {
			w.RollbackEdit(request.TransactionId);
			return true;
		}, cancellationToken);

	public Task<EditCommitResponse> UndoAsync(WorkspaceRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.Undo(), cancellationToken);

	public Task<EditCommitResponse> RedoAsync(WorkspaceRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.Redo(), cancellationToken);

	public Task<SaveModuleResponse> SaveModuleAsync(SaveModuleRequest request, CancellationToken cancellationToken) =>
		GetWorkspace(request.WorkspaceId).RunAsync(w => w.SaveModuleAsync(request, cancellationToken), cancellationToken);

	// ---------------------------------------------------------------- debug symbols

	public Task<ResolveBreakpointsResponse> ResolveBreakpointsAsync(string workspaceId, IReadOnlyList<BreakpointQuery> queries, CancellationToken cancellationToken) =>
		GetWorkspace(workspaceId).RunAsync(w => w.ResolveBreakpoints(queries, cancellationToken), cancellationToken);

	public Task<ResolvedIlLocation?> ResolveIlLocationAsync(string? workspaceId, string modulePath, int metadataToken, int ilOffset, CancellationToken cancellationToken) =>
		WithSymbolsAsync(workspaceId, w => symbols.ResolveIlLocation(w, modulePath, metadataToken, ilOffset, cancellationToken), cancellationToken);

	public Task<MethodIlInfoResponse?> GetMethodIlInfoAsync(string workspaceId, string modulePath, int metadataToken, CancellationToken cancellationToken) =>
		WithSymbolsAsync(workspaceId, w => symbols.GetMethodIlInfo(w, modulePath, metadataToken, cancellationToken), cancellationToken);

	public Task<IReadOnlyList<MethodIlInfoResponse>> FindMethodsAsync(string? workspaceId, string name, CancellationToken cancellationToken) =>
		WithSymbolsAsync(workspaceId, w => symbols.FindMethods(w, name, cancellationToken), cancellationToken);

	public Task<IReadOnlyList<DebugVariableNameDto>> GetVariableNamesAsync(string? workspaceId, string modulePath, int metadataToken, CancellationToken cancellationToken) =>
		WithSymbolsAsync(workspaceId, w => symbols.GetVariableNames(w, modulePath, metadataToken, cancellationToken), cancellationToken);

	public Task<SteppingTargetsResponse?> GetSteppingTargetsAsync(string? workspaceId, string modulePath, int metadataToken, int ilOffset, bool stepInto, CancellationToken cancellationToken) =>
		WithSymbolsAsync(workspaceId, w => symbols.GetSteppingTargets(w, modulePath, metadataToken, ilOffset, stepInto, cancellationToken), cancellationToken);

	public Task<bool> IsWorkspaceModuleAsync(string? workspaceId, string modulePath, CancellationToken cancellationToken) =>
		WithSymbolsAsync(workspaceId, w => symbols.IsWorkspaceModule(w, modulePath), cancellationToken);

	/// <summary>
	/// Runs a symbol lookup. Without a workspace the lookup still answers — a debuggee attached
	/// without one, or a module that lives outside the workspace, is read straight from its file.
	/// </summary>
	Task<T> WithSymbolsAsync<T>(string? workspaceId, Func<Workspace?, T> action, CancellationToken cancellationToken) =>
		workspaceId is not null && workspaces.TryGetValue(workspaceId, out var workspace)
			? workspace.RunAsync(_ => action(workspace), cancellationToken)
			: Task.Run(() => action(null), cancellationToken);

	Workspace GetWorkspace(string id) => workspaces.TryGetValue(id, out var workspace)
		? workspace
		: throw new RpcException(ErrorCodes.WorkspaceNotFound, "The workspace no longer exists.");

	static IReadOnlyList<string> ExpandPaths(IReadOnlyList<string> requestedPaths) {
		var paths = new HashSet<string>(StringComparer.Ordinal);
		foreach (var requestedPath in requestedPaths) {
			if (string.IsNullOrWhiteSpace(requestedPath))
				continue;
			var path = Path.GetFullPath(requestedPath);
			if (File.Exists(path)) {
				paths.Add(path);
				continue;
			}
			if (Directory.Exists(path)) {
				foreach (var candidate in Directory.EnumerateFiles(path, "*", SearchOption.TopDirectoryOnly)) {
					var extension = Path.GetExtension(candidate);
					if (extension.Equals(".dll", StringComparison.OrdinalIgnoreCase) ||
						extension.Equals(".exe", StringComparison.OrdinalIgnoreCase) ||
						extension.Equals(".netmodule", StringComparison.OrdinalIgnoreCase) ||
						extension.Equals(".winmd", StringComparison.OrdinalIgnoreCase))
						paths.Add(Path.GetFullPath(candidate));
				}
				continue;
			}
			throw new RpcException(ErrorCodes.FileNotFound, $"Path does not exist: {path}");
		}
		return paths.Order(StringComparer.Ordinal).ToArray();
	}

	public void Dispose() {
		if (disposed)
			return;
		disposed = true;
		foreach (var workspace in workspaces.Values)
			workspace.Dispose();
		workspaces.Clear();
		symbols.Dispose();
	}

	/// Answers the debug engine's IL-level questions. A module the workspace has open is read through
	/// the workspace; anything else — a debuggee attached without a workspace, a frame in a framework
	/// assembly — is loaded from its own file on demand and released when it falls out of the cache.
	/// </summary>
	sealed class SymbolResolver : IDisposable {
		const int MaxExternalModules = 16;
		const int MaxCachedMethods = 512;

		readonly object gate = new();
		readonly Dictionary<string, Workspace.ModuleEntry> externalModules = new(StringComparer.Ordinal);
		readonly Queue<string> externalOrder = new();
		readonly Dictionary<string, IReadOnlyList<CodeStatementDto>> methodStatements = new(StringComparer.Ordinal);
		readonly Dictionary<string, IReadOnlyList<DebugVariableNameDto>> variableNames = new(StringComparer.Ordinal);
		bool disposed;

		/// <summary>Drops every cached statement table; call after the decompiled text changes.</summary>
		public void Invalidate() {
			lock (gate) {
				methodStatements.Clear();
				variableNames.Clear();
			}
		}

		public Workspace.ModuleEntry? FindModule(Workspace? workspace, string path) {
			var full = Path.GetFullPath(path);
			return workspace?.FindModuleEntry(full) ?? FindExternalModule(full);
		}

		Workspace.ModuleEntry? FindExternalModule(string path) {
			lock (gate) {
				ObjectDisposedException.ThrowIf(disposed, this);
				if (externalModules.TryGetValue(path, out var cached))
					return cached;
			}
			if (!File.Exists(path))
				return null;
			ModuleDefMD module;
			try {
				module = ModuleDefMD.Load(path);
			}
			catch (Exception ex) when (ex is BadImageFormatException or IOException or UnauthorizedAccessException) {
				return null;
			}
			lock (gate) {
				if (externalModules.TryGetValue(path, out var raced))
					return raced;
				var entry = new Workspace.ModuleEntry(path, module) { IsExternal = true };
				while (externalOrder.Count >= MaxExternalModules) {
					if (externalModules.Remove(externalOrder.Dequeue(), out var evicted))
						evicted.Module.Dispose();
				}
				externalModules.Add(path, entry);
				externalOrder.Enqueue(path);
				return entry;
			}
		}

		public ResolvedIlLocation? ResolveIlLocation(Workspace? workspace, string modulePath, int metadataToken, int ilOffset, CancellationToken cancellationToken) {
			var entry = FindModule(workspace, modulePath);
			if (entry is null || entry.Module.ResolveToken(metadataToken) is not MethodDef method)
				return null;
			var source = FindSourceMethod(method);
			var statements = GetMethodStatements(workspace?.SymbolScope ?? string.Empty, entry, source, cancellationToken);
			var bodyToken = method.MDToken.Raw;
			// The sequence points tile the body, so the point that contains an offset is the statement the
			// runtime stopped in — whether or not the offset is where that statement's own code starts. The
			// two differ wherever the decompiler's statement begins inside code the points charge to it, and
			// an engine that reports such an offset (an async body, a field store) would otherwise name the
			// statement before it.
			var hit = statements.FirstOrDefault(statement => statement.MetadataToken == bodyToken && ilOffset >= statement.SequencePointIlOffset && ilOffset < statement.IlEndOffset)
				?? statements.LastOrDefault(statement => statement.MetadataToken == bodyToken && statement.SequencePointIlOffset <= ilOffset);
			if (hit is null)
				return null;
			return new ResolvedIlLocation(
				workspace?.TryGetMemberNodeId(entry, source),
				hit.Description,
				entry.Path,
				unchecked((int)bodyToken),
				hit.StartLine,
				hit.EndLine,
				hit.StartColumn,
				hit.EndColumn,
				hit.IlOffset,
				hit.IlEndOffset,
				hit.IsHidden,
				entry.IsExternal);
		}

		public MethodIlInfoResponse? GetMethodIlInfo(Workspace? workspace, string modulePath, int metadataToken, CancellationToken cancellationToken) {
			var entry = FindModule(workspace, modulePath);
			return entry is not null && entry.Module.ResolveToken(metadataToken) is MethodDef method
				? CreateMethodInfo(workspace, entry, method, cancellationToken)
				: null;
		}

		public IReadOnlyList<DebugVariableNameDto> GetVariableNames(Workspace? workspace, string modulePath, int metadataToken, CancellationToken cancellationToken) {
			var entry = FindModule(workspace, modulePath);
			if (entry is null || entry.Module.ResolveToken(metadataToken) is not MethodDef method || !method.HasBody)
				return Array.Empty<DebugVariableNameDto>();
			var scope = workspace?.SymbolScope ?? string.Empty;
			var key = $"{scope}|{entry.Path}|{method.MDToken.Raw:X8}";
			lock (gate) {
				ObjectDisposedException.ThrowIf(disposed, this);
				if (variableNames.TryGetValue(key, out var cached))
					return cached;
			}
			var names = BuildVariableNames(entry, method, cancellationToken);
			lock (gate) {
				if (variableNames.Count >= MaxCachedMethods)
					variableNames.Clear();
				variableNames[key] = names;
			}
			return names;
		}

		/// <summary>
		/// The statements a step from an IL location can land on, plus those of the method it calls when
		/// stepping into. A step is driven by breakpoints on these locations because the runtime, having
		/// no symbols, steps at IL-instruction granularity: it would stop in the middle of a statement.
		/// Statements are boundaries by construction.
		/// </summary>
		public SteppingTargetsResponse? GetSteppingTargets(Workspace? workspace, string modulePath, int metadataToken, int ilOffset, bool stepInto, CancellationToken cancellationToken) {
			var entry = FindModule(workspace, modulePath);
			if (entry is null || entry.Module.ResolveToken(metadataToken) is not MethodDef method)
				return null;
			var body = GetMethodStatements(workspace?.SymbolScope ?? string.Empty, entry, FindSourceMethod(method), cancellationToken)
				.Where(statement => statement.MetadataToken == metadataToken && !statement.IsHidden)
				.OrderBy(statement => statement.IlOffset)
				.ToArray();
			var targets = new List<SteppingTarget>();
			// A statement the thread is stopped inside of is where the step starts, so the line it is on is
			// the one the client marks: landing on another statement of it would not move the marker. They
			// are kept when they are all the body has, since stopping within the line beats running on.
			// The containment is the tiled one, like a reported stop: the location may be an offset the
			// statement's own code does not start at — a state machine's field store — and reading the line
			// off the statement's own start would name the wrong statement there.
			var current = body.FirstOrDefault(statement => ilOffset >= statement.SequencePointIlOffset && ilOffset < statement.IlEndOffset)
				?? body.LastOrDefault(statement => statement.SequencePointIlOffset <= ilOffset);
			var line = current?.StartLine;
			var stops = body.Where(statement => statement.StartLine != line).ToArray();
			if (stops.Length == 0)
				stops = body;
			// Every statement of the body is armed, not only the ones after the location: a loop runs its
			// body again, and the order the thread reaches them in is not the order of their IL offsets.
			// Whichever one the runtime reports first is the one the thread actually got to. Each is armed
			// at both offsets it has (see ArmStatement): a target the runtime cannot place is a target the
			// step cannot land on, and a body whose statements are all like that would never complete.
			foreach (var offset in stops.SelectMany(statement => ArmStatement(method, statement)).Distinct().OrderBy(offset => offset))
				targets.Add(new SteppingTarget(entry.Path, metadataToken, offset));
			var bodyTargets = targets.Count;
			if (stepInto)
				AddCalleeTargets(targets, workspace, entry, method, ilOffset, cancellationToken);
			// Nothing of the body can run again before it returns, so the step has to leave the method — a
			// body maps its statements, the caller's resume point is not among them. A step into a call is
			// the exception: what it lands on belongs to the callee.
			var leavesMethod = targets.Count == bodyTargets
				&& !body.Any(statement => statement.IlOffset > ilOffset)
				&& !HasBackEdge(method, ilOffset);
			return new SteppingTargetsResponse(targets, leavesMethod);
		}

		/// <summary>
		/// The IL offsets a statement has to be armed at for a step to be able to land on it: where its own
		/// code starts, and — when the statement begins inside the sequence point covering it — the start of
		/// that point, because the runtime refuses a breakpoint anywhere else. Arming the second is what
		/// makes a state machine steppable: the field store in front of a statement is a point of its own,
		/// so the statement's own start is an offset <c>CreateBreakpoint</c> rejects.
		/// </summary>
		static IEnumerable<int> ArmStatement(MethodDef method, CodeStatementDto statement) {
			yield return statement.IlOffset;
			if (statement.SequencePointIlOffset < statement.IlOffset && RunsInto(method, statement.SequencePointIlOffset, statement.IlOffset))
				yield return statement.SequencePointIlOffset;
		}

		/// <summary>
		/// True when the IL before a statement runs straight into it. Where it branches instead, that IL
		/// belongs to the statement before — a loop's condition tail, which the tiling hands to whatever
		/// follows it — and a breakpoint there would stop the thread inside the other statement, reporting
		/// a line the user is not on. Such a point start is no substitute for the statement's own.
		/// </summary>
		static bool RunsInto(MethodDef method, int start, int end) {
			if (method.Body is not { } body)
				return false;
			foreach (var instruction in body.Instructions) {
				var offset = (int)instruction.Offset;
				if (offset >= end)
					break;
				if (offset < start)
					continue;
				// A branch within the range runs it out of order, and a branch into it is another
				// statement's control flow reaching inside.
				if (instruction.OpCode.FlowControl is FlowControl.Branch or FlowControl.Cond_Branch or FlowControl.Return)
					return false;
				switch (instruction.Operand) {
				case Instruction target when target.Offset >= start && target.Offset < end:
				case IList<Instruction> targets when targets.Any(target => target.Offset >= start && target.Offset < end):
					return false;
				}
			}
			return true;
		}

		/// <summary>
		/// The offset the runtime can be asked for instead of the statement's own, or null when there is
		/// none to be had. A breakpoint belongs on the statement's own start, which is what a stop is
		/// reported at; the point in front of it is only a substitute when it runs straight into it.
		/// </summary>
		internal int? AcceptedPointOffset(Workspace? workspace, CodeStatementDto statement) {
			if (statement.SequencePointIlOffset >= statement.IlOffset)
				return null;
			if (FindModule(workspace, statement.ModulePath)?.Module.ResolveToken(statement.MetadataToken) is not MethodDef body)
				return null;
			return RunsInto(body, statement.SequencePointIlOffset, statement.IlOffset) ? statement.SequencePointIlOffset : null;
		}

		/// <summary>
		/// True when the method branches back over <paramref name="ilOffset"/>, which means the location can
		/// run again: the last statement of a loop has nothing after it, yet the loop is not finished.
		/// </summary>
		static bool HasBackEdge(MethodDef method, int ilOffset) {
			if (method.Body is not { } body)
				return false;
			foreach (var instruction in body.Instructions) {
				if (instruction.Offset < ilOffset)
					continue;
				switch (instruction.Operand) {
				case Instruction target when target.Offset <= ilOffset:
				case IList<Instruction> targets when targets.Any(target => target.Offset <= ilOffset):
					return true;
				}
			}
			return false;
		}

		/// <summary>
		/// A step into a call lands on the first statement of what the call runs. Calls the workspace
		/// cannot decompile — the framework, an extern — are not targets, so "step into" degrades to
		/// "step over" there rather than walking into code with nothing to show.
		/// </summary>
		void AddCalleeTargets(List<SteppingTarget> targets, Workspace? workspace, Workspace.ModuleEntry entry, MethodDef method, int ilOffset, CancellationToken cancellationToken) {
			if (method.Body is not { } body)
				return;
			// The stop is on a statement's first instruction, but a call site pushes its arguments first,
			// so the call is rarely at the location itself: the next call the thread reaches is the one a
			// step into enters. A call the thread branches past is not a problem — the caller's own
			// statements are armed too, so the step completes there instead of running on unobserved.
			MethodDef? callee = null;
			foreach (var instruction in body.Instructions) {
				if (instruction.Offset < ilOffset)
					continue;
				if (instruction.OpCode.Code is not (Code.Call or Code.Callvirt or Code.Newobj))
					continue;
				callee = (instruction.Operand as IMethod)?.ResolveMethodDef();
				break;
			}
			if (callee is null || !callee.HasBody)
				return;
			// Stepping into a call is only worth offering where there is decompiled source to land in:
			// the same module, or another module of this workspace. A framework or native callee has no
			// document to show, so there "step into" degrades to "step over" instead of walking into
			// code the client cannot display — and, for the framework, into a module that would have to
			// be decompiled in full to find out.
			var calleePath = string.IsNullOrEmpty(callee.Module.Location) ? entry.Path : Path.GetFullPath(callee.Module.Location);
			var calleeEntry = string.Equals(calleePath, entry.Path, StringComparison.Ordinal)
				? entry
				: workspace?.FindModuleEntry(calleePath);
			if (calleeEntry is null)
				return;
			// Like the caller's own statements, the whole callee is armed: the runtime reports the statement
			// it reaches first, which is the one the call runs.
			foreach (var offset in GetMethodStatements(workspace?.SymbolScope ?? string.Empty, calleeEntry, FindSourceMethod(callee), cancellationToken)
				.Where(statement => statement.MetadataToken == callee.MDToken.Raw && !statement.IsHidden)
				.SelectMany(statement => ArmStatement(callee, statement))
				.Distinct()
				.OrderBy(offset => offset))
				targets.Add(new SteppingTarget(calleeEntry.Path, unchecked((int)callee.MDToken.Raw), offset));
		}

		/// <summary>True when the module is one of the workspace's own files rather than a dependency.</summary>
		public bool IsWorkspaceModule(Workspace? workspace, string modulePath) =>
			!string.IsNullOrEmpty(modulePath) && workspace?.FindModuleEntry(modulePath) is not null;

		public IReadOnlyList<MethodIlInfoResponse> FindMethods(Workspace? workspace, string name, CancellationToken cancellationToken) {
			const int MaxResults = 64;
			if (string.IsNullOrWhiteSpace(name))
				return Array.Empty<MethodIlInfoResponse>();
			var results = new List<MethodIlInfoResponse>();
			foreach (var entry in EnumerateModules(workspace)) {
				foreach (var type in entry.Module.GetTypes()) {
					cancellationToken.ThrowIfCancellationRequested();
					foreach (var method in type.Methods) {
						if (!method.HasBody || !Matches(method, type, name))
							continue;
						results.Add(CreateMethodInfo(workspace, entry, method, cancellationToken));
						if (results.Count >= MaxResults)
							return results;
					}
				}
			}
			return results;
		}

		static bool Matches(MethodDef method, TypeDef type, string name) =>
			method.Name == name ||
			method.FullName == name ||
			$"{type.Name}.{method.Name}" == name ||
			$"{type.FullName}.{method.Name}" == name;

		IEnumerable<Workspace.ModuleEntry> EnumerateModules(Workspace? workspace) {
			if (workspace is not null) {
				foreach (var entry in workspace.OpenModules)
					yield return entry;
			}
			lock (gate) {
				foreach (var entry in externalModules.Values)
					yield return entry;
			}
		}

		MethodIlInfoResponse CreateMethodInfo(Workspace? workspace, Workspace.ModuleEntry entry, MethodDef method, CancellationToken cancellationToken) {
			var source = FindSourceMethod(method);
			var bodyToken = method.MDToken.Raw;
			var statements = method.HasBody
				? GetMethodStatements(workspace?.SymbolScope ?? string.Empty, entry, source, cancellationToken)
				: Array.Empty<CodeStatementDto>();
			// A method breakpoint goes on the first statement's sequence point rather than on the offset its
			// own code starts at: the runtime will not accept a breakpoint at the latter wherever the point
			// covering it begins earlier, which is the rule in a state machine's MoveNext.
			CodeStatementDto? first = null;
			foreach (var statement in statements) {
				if (statement.MetadataToken == bodyToken && !statement.IsHidden && (first is null || statement.IlOffset < first.IlOffset))
					first = statement;
			}
			return new MethodIlInfoResponse(
				workspace?.TryGetMemberNodeId(entry, source),
				source.FullName,
				entry.Path,
				unchecked((int)source.MDToken.Raw),
				unchecked((int)bodyToken),
				first?.SequencePointIlOffset ?? 0,
				GetCodeSize(method),
				method.HasBody);
		}

		static int GetCodeSize(MethodDef method) {
			if (!method.HasBody || method.Body.Instructions.Count == 0)
				return 0;
			var last = method.Body.Instructions[^1];
			return (int)last.Offset + last.GetSize();
		}

		/// <summary>
		/// The statement table of one method body. An async or iterator method compiles into a generated
		/// <c>MoveNext</c>, which is the token the engine reports, so the IL offsets are the state
		/// machine's while the lines belong to the method the user wrote; decompiling the source method
		/// and keeping the statements whose body token is the <c>MoveNext</c> lines both up.
		/// </summary>
		IReadOnlyList<CodeStatementDto> GetMethodStatements(string scope, Workspace.ModuleEntry entry, MethodDef method, CancellationToken cancellationToken) {
			if (!method.HasBody)
				return Array.Empty<CodeStatementDto>();
			var key = $"{scope}|{entry.Path}|{method.MDToken.Raw:X8}";
			lock (gate) {
				ObjectDisposedException.ThrowIf(disposed, this);
				if (methodStatements.TryGetValue(key, out var cached))
					return cached;
			}
			var statements = BuildMethodStatements(entry, method, cancellationToken);
			lock (gate) {
				if (methodStatements.Count >= MaxCachedMethods)
					methodStatements.Clear();
				methodStatements[key] = statements;
			}
			return statements;
		}

		static IReadOnlyList<CodeStatementDto> BuildMethodStatements(Workspace.ModuleEntry entry, MethodDef method, CancellationToken cancellationToken) {
			var settings = new DecompilerSettings();
			using var session = Workspace.CreateCSharpDecompilerSession(entry, settings, cancellationToken);
			var decompiler = session.Decompiler;
			var syntaxTree = decompiler.Decompile([Workspace.ToEntityHandle(method)]);
			var output = new Workspace.SpanTextOutput(_ => null);
			Workspace.RenderWithLocations(syntaxTree, output, settings);
			// Keyed on the source method rather than the body: an async method's statements live in a
			// generated MoveNext, and they are what a frame stopped inside that state machine needs.
			var sourceToken = unchecked((int)method.MDToken.Raw);
			return Workspace.BuildCodeStatements(syntaxTree, decompiler, entry, cancellationToken)
				.Where(statement => statement.SourceMethodToken == sourceToken)
				.ToArray();
		}

		/// <summary>
		/// The names the decompiler gives a method body's locals and arguments. A debuggee without a
		/// PDB carries no symbol names of its own, so the engine maps ICorDebug slots onto these —
		/// which is how a slot reads as <c>sum</c> instead of <c>local2</c>.
		/// </summary>
		static IReadOnlyList<DebugVariableNameDto> BuildVariableNames(Workspace.ModuleEntry entry, MethodDef method, CancellationToken cancellationToken) {
			try {
				var settings = new DecompilerSettings();
				using var session = Workspace.CreateCSharpDecompilerSession(entry, settings, cancellationToken);
				var syntaxTree = session.Decompiler.Decompile([Workspace.ToEntityHandle(method)]);
				var token = method.MDToken.Raw;
				var localNames = ReadLocalNamesFromPdb(entry.Path, method);
				var names = new List<DebugVariableNameDto>();
				// The ILFunction keys of a sequence-point map are the bodies this tree printed, which is
				// exactly the body whose slots the engine is looking at.
				foreach (var function in session.Decompiler.CreateSequencePoints(syntaxTree).Keys) {
					cancellationToken.ThrowIfCancellationRequested();
					if (Workspace.GetSourceMethodToken(function) != token && Workspace.GetBodyMethodToken(function) != token)
						continue;
					foreach (var variable in function.Variables)
						AddVariableName(names, method, variable, localNames);
				}
				return names
					.OrderByDescending(name => name.IsArgument)
					.ThenBy(name => name.Index)
					.ToArray();
			}
			catch (OperationCanceledException) {
				throw;
			}
			catch (Exception) {
				// Names are a convenience: without them the engine falls back to slot numbers.
				return Array.Empty<DebugVariableNameDto>();
			}
		}

		/// <summary>
		/// Local names slot by slot. The metadata records parameter names but says nothing about locals,
		/// so a release build — which ships no PDB — genuinely has none, and ILSpy invents <c>num</c>-
		/// style names instead. Reading the portable PDB when one sits next to the module is what turns
		/// those back into the names the user wrote.
		/// </summary>
		static Dictionary<int, string> ReadLocalNamesFromPdb(string modulePath, MethodDef method) {
			var names = new Dictionary<int, string>();
			var pdbPath = Path.ChangeExtension(modulePath, ".pdb");
			if (!File.Exists(pdbPath))
				return names;
			try {
				using var stream = File.OpenRead(pdbPath);
				using var provider = PdbReaderProvider.FromPortablePdbStream(stream);
				var pdb = provider.GetMetadataReader();
				// PDB rows are numbered like the metadata rows they describe, so the method's row
				// number is the handle the debug metadata is keyed by.
				var handle = MetadataTokens.MethodDefinitionHandle(method.MDToken.ToInt32() & 0x00FFFFFF);
				foreach (var scopeHandle in pdb.GetLocalScopes(handle)) {
					foreach (var variableHandle in pdb.GetLocalScope(scopeHandle).GetLocalVariables()) {
						var variable = pdb.GetLocalVariable(variableHandle);
						var name = pdb.GetString(variable.Name);
						if (!string.IsNullOrEmpty(name))
							names[variable.Index] = name;
					}
				}
			}
			catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or BadImageFormatException or ArgumentException) {
				// An unreadable PDB costs the locals their names and nothing else.
			}
			return names;
		}

		static void AddVariableName(List<DebugVariableNameDto> names, MethodDef method, DecompilerILVariable variable, Dictionary<int, string> localNames) {
			// Stack slots and exception slots are not variables anyone can name, and a variable without
			// a slot has nothing the engine could match it against.
			if (variable.Kind is not (DecompilerVariableKind.Parameter or DecompilerVariableKind.Local) || variable.Index is not { } variableIndex)
				return;
			var isArgument = variable.Kind == DecompilerVariableKind.Parameter;
			// ILSpy indexes the signature's parameters, while the engine counts the receiver as
			// argument 0 of an instance method — and calls it "this", like the decompiler does.
			var index = isArgument ? variableIndex + (method.IsStatic ? 0 : 1) : variableIndex;
			// The PDB is the better authority on locals: ILSpy's names are its own invention once the
			// method is inlined into a caller, and a slot's real name never changes.
			var name = isArgument ? null : localNames.GetValueOrDefault(index);
			if (string.IsNullOrEmpty(name))
				name = string.IsNullOrEmpty(variable.Name) ? null : variable.Name;
			name ??= isArgument ? $"arg{index}" : $"local{index}";
			names.Add(new DebugVariableNameDto(name, variable.Type?.ToString() ?? string.Empty, index, isArgument));
		}

		/// <summary>
		/// Maps a generated state machine method back to the method that produced it, so a frame inside
		/// <c>MoveNext</c> is reported at the line of the <c>await</c> the user actually wrote.
		/// </summary>
		static MethodDef FindSourceMethod(MethodDef method) {
			if (method.Name != "MoveNext" || method.DeclaringType is not { } stateMachine || stateMachine.DeclaringType is not { } owner)
				return method;
			if (!IsCompilerGenerated(stateMachine))
				return method;
			foreach (var candidate in owner.Methods) {
				foreach (var attribute in candidate.CustomAttributes) {
					if (!attribute.TypeFullName.EndsWith("StateMachineAttribute", StringComparison.Ordinal))
						continue;
					if (attribute.ConstructorArguments.Count != 1)
						continue;
					if (ResolveType(attribute.ConstructorArguments[0].Value) == stateMachine)
						return candidate;
				}
			}
			return method;
		}

		static TypeDef? ResolveType(object? value) => value switch {
			ITypeDefOrRef reference => reference.ResolveTypeDef(),
			TypeSig signature => signature.ToTypeDefOrRef().ResolveTypeDef(),
			_ => null,
		};

		static bool IsCompilerGenerated(TypeDef type) => type.CustomAttributes.Any(
			attribute => attribute.TypeFullName == "System.Runtime.CompilerServices.CompilerGeneratedAttribute");

		public void Dispose() {
			lock (gate) {
				if (disposed)
					return;
				disposed = true;
				foreach (var entry in externalModules.Values)
					entry.Module.Dispose();
				externalModules.Clear();
				externalOrder.Clear();
				methodStatements.Clear();
			}
		}
	}

	sealed class Workspace : IDisposable {
		readonly SemaphoreSlim gate = new(1, 1);
		readonly SymbolResolver symbols;
		readonly Dictionary<string, ModuleEntry> modules = new(StringComparer.Ordinal);
		readonly Dictionary<string, NodeEntry> nodes = new(StringComparer.Ordinal);
		readonly Dictionary<string, string> nodeIdsByKey = new(StringComparer.Ordinal);
		readonly Dictionary<string, EditTransaction> transactions = new(StringComparer.Ordinal);
		readonly Stack<EditHistoryEntry> undoHistory = new();
		readonly Stack<EditHistoryEntry> redoHistory = new();
		readonly Dictionary<string, IReadOnlyList<CodeStatementDto>> codeStatementsByNode = new(StringComparer.Ordinal);
		int nextNodeId;
		int version;
		string stateId = Guid.NewGuid().ToString("N");
		string cachedStatementsStateId = string.Empty;
		bool disposed;

		public Workspace(SymbolResolver symbols) {
			this.symbols = symbols;
			Id = Guid.NewGuid().ToString("N");
		}

		public string Id { get; }

		public async Task OpenAsync(IReadOnlyList<string> paths, CancellationToken cancellationToken) {
			foreach (var path in paths) {
				cancellationToken.ThrowIfCancellationRequested();
				ModuleDefMD module;
				try {
					module = await Task.Run(() => ModuleDefMD.Load(path), cancellationToken).ConfigureAwait(false);
				}
				catch (BadImageFormatException) when (paths.Count > 1) {
					continue;
				}
				var entry = new ModuleEntry(path, module);
				var root = GetOrAddNode($"module:{path}", NodeKind.Module, module, entry);
				entry.Id = root.Id;
				modules.Add(entry.Id, entry);
			}
			if (modules.Count == 0)
				throw new RpcException(ErrorCodes.InvalidParams, "None of the selected files is a managed assembly.");
		}

		public OpenWorkspaceResponse CreateOpenResponse() => new(
			Id,
			modules.Values.Select(m => new OpenedModule(
				m.Id,
				m.Module.Assembly?.Name.String ?? m.Module.Name.String,
				m.Path,
				File.Exists(Path.ChangeExtension(m.Path, ".pdb")))).ToArray(),
			stateId);

		public TreeNodesResponse GetRoots() => new(modules.Values.Select(m => ToDto(nodes[m.Id])).ToArray());

		public TreeNodesResponse GetChildren(string nodeId) {
			var node = GetNode(nodeId);
			var children = node.Kind switch {
				NodeKind.Module => GetModuleChildren(node),
				NodeKind.Namespace => GetNamespaceChildren(node),
				NodeKind.ReferencesGroup => GetReferenceChildren(node),
				NodeKind.ResourcesGroup => GetResourceChildren(node),
				NodeKind.Resource => GetEmbeddedResourceChildren(node),
				NodeKind.Type => GetTypeChildren(node),
				_ => Array.Empty<NodeEntry>(),
			};
			return new TreeNodesResponse(children.Select(ToDto).ToArray());
		}

		public TreeNodeDto GetNodeDto(string nodeId) => ToDto(GetNode(nodeId));

		IReadOnlyList<NodeEntry> GetModuleChildren(NodeEntry node) {
			var module = (ModuleDefMD)node.Value;
			var result = new List<NodeEntry>();
			if (module.GetAssemblyRefs().Any())
				result.Add(GetOrAddNode($"{node.Key}:references", NodeKind.ReferencesGroup, module, node.Module));
			if (module.Resources.Count != 0)
				result.Add(GetOrAddNode($"{node.Key}:resources", NodeKind.ResourcesGroup, module, node.Module));

			foreach (var group in module.Types
				.Where(t => t.DeclaringType is null && !t.IsGlobalModuleType)
				.GroupBy(t => t.Namespace.String ?? string.Empty, StringComparer.Ordinal)
				.OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)) {
				result.Add(GetOrAddNode(
					$"{node.Key}:namespace:{group.Key}",
					NodeKind.Namespace,
					new NamespaceValue(group.Key, group.ToArray()),
					node.Module));
			}
			return result;
		}

		IReadOnlyList<NodeEntry> GetNamespaceChildren(NodeEntry node) {
			// Derived live from the module rather than from the node's NamespaceValue snapshot: a delete
			// or a namespace rename mutates the module while this node stays cached, so a snapshot would
			// keep listing types that no longer belong here.
			var name = ((NamespaceValue)node.Value).Name;
			return node.Module.Module.Types
				.Where(t => t.DeclaringType is null && !t.IsGlobalModuleType && (t.Namespace.String ?? string.Empty) == name)
				.OrderBy(t => t.Name.String, StringComparer.OrdinalIgnoreCase)
				.Select(t => GetMemberNode(t, node.Module))
				.ToArray();
		}

		IReadOnlyList<NodeEntry> GetReferenceChildren(NodeEntry node) => ((ModuleDefMD)node.Value)
			.GetAssemblyRefs()
			.OrderBy(r => r.Name.String, StringComparer.OrdinalIgnoreCase)
			.Select(r => GetOrAddNode(MemberKey(node.Module, "reference", r.MDToken.Raw), NodeKind.AssemblyReference, r, node.Module))
			.ToArray();

		IReadOnlyList<NodeEntry> GetResourceChildren(NodeEntry node) => ((ModuleDefMD)node.Value)
			.Resources
			.OrderBy(r => r.Name.String, StringComparer.OrdinalIgnoreCase)
			.Select((r, index) => GetOrAddNode($"resource:{node.Module.Id}:{index}:{r.Name}", NodeKind.Resource, r, node.Module))
			.ToArray();

		IReadOnlyList<NodeEntry> GetEmbeddedResourceChildren(NodeEntry node) {
			if (node.Value is not EmbeddedResource embedded || !embedded.Name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase))
				return Array.Empty<NodeEntry>();
			var values = new List<ResourceEntryValue>();
			using var stream = embedded.CreateReader().AsStream();
			using var reader = new ResourceReader(stream);
			var enumerator = reader.GetEnumerator();
			while (enumerator.MoveNext()) {
				var name = enumerator.Key?.ToString() ?? string.Empty;
				reader.GetResourceData(name, out var typeName, out var data);
				values.Add(new ResourceEntryValue(name, DecodeResourceData(typeName, data), typeName));
			}
			return values
				.OrderBy(value => value.Name, StringComparer.OrdinalIgnoreCase)
				.Select(value => GetOrAddNode($"resource-entry:{node.Module.Id}:{embedded.Name}:{value.Name}", NodeKind.ResourceEntry, value, node.Module))
				.ToArray();
		}

		static object? DecodeResourceData(string typeName, byte[] data) {
			if (typeName == "ResourceTypeCode.Null")
				return null;
			using var stream = new MemoryStream(data, writable: false);
			using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: false);
			if (typeName == "ResourceTypeCode.String")
				return reader.ReadString();
			if (typeName is "ResourceTypeCode.ByteArray" or "ResourceTypeCode.Stream") {
				var length = reader.ReadInt32();
				if (length < 0 || length > stream.Length - stream.Position)
					throw new BadImageFormatException($"Resource entry has an invalid byte length: {length}");
				return reader.ReadBytes(length);
			}
			return data;
		}

		IReadOnlyList<NodeEntry> GetTypeChildren(NodeEntry node) {
			var type = (TypeDef)node.Value;
			var result = new List<NodeEntry>();
			result.AddRange(type.NestedTypes.OrderBy(t => t.Name.String, StringComparer.OrdinalIgnoreCase).Select(t => GetMemberNode(t, node.Module)));
			result.AddRange(type.Fields.OrderBy(f => f.Name.String, StringComparer.OrdinalIgnoreCase).Select(f => GetMemberNode(f, node.Module)));
			result.AddRange(type.Properties.OrderBy(p => p.Name.String, StringComparer.OrdinalIgnoreCase).Select(p => GetMemberNode(p, node.Module)));
			result.AddRange(type.Events.OrderBy(e => e.Name.String, StringComparer.OrdinalIgnoreCase).Select(e => GetMemberNode(e, node.Module)));
			result.AddRange(type.Methods.OrderBy(m => m.Name.String, StringComparer.OrdinalIgnoreCase).ThenBy(m => m.MethodSig?.Params.Count ?? 0).Select(m => GetMemberNode(m, node.Module)));
			return result;
		}

		public async Task<DecompileResponse> DecompileAsync(DecompileRequest request, CancellationToken cancellationToken) {
			var node = GetNode(request.NodeId);
			cancellationToken.ThrowIfCancellationRequested();
			if (node.Kind == NodeKind.ResourceEntry)
				return DecompileResourceEntry(node, cancellationToken);
			return request.Language switch {
				DecompilerLanguage.CSharp => DecompileCSharp(node, cancellationToken),
				DecompilerLanguage.IL => DecompileIL(node),
				DecompilerLanguage.ILWithCSharp => DecompileILWithCSharp(node, cancellationToken),
				DecompilerLanguage.VisualBasic => await DecompileVisualBasicAsync(node, cancellationToken).ConfigureAwait(false),
				_ => throw new RpcException(ErrorCodes.InvalidParams, "Unknown decompiler language."),
			};
		}

		DecompileResponse DecompileResourceEntry(NodeEntry node, CancellationToken cancellationToken) {
			var resource = (ResourceEntryValue)node.Value;
			if (resource.Name.EndsWith(".baml", StringComparison.OrdinalIgnoreCase) && resource.Value is byte[] baml) {
				try {
					var decompiler = new XamlDecompiler(node.Module.Path, new BamlDecompilerSettings {
						ThrowOnAssemblyResolveErrors = false,
					}) {
						CancellationToken = cancellationToken,
					};
					using var stream = new MemoryStream(baml, writable: false);
					var result = decompiler.Decompile(stream);
					return new DecompileResponse(resource.Name, "xml", result.Xaml.ToString(), Array.Empty<TextSpanDto>(), Array.Empty<DiagnosticDto>());
				}
				catch (Exception ex) when (ex is not OperationCanceledException) {
					return new DecompileResponse(resource.Name, "xml", string.Empty, Array.Empty<TextSpanDto>(), [new DiagnosticDto("error", ex.Message)]);
				}
			}
			if (resource.Value is string text)
				return new DecompileResponse(resource.Name, GuessResourceLanguage(resource.Name), text, Array.Empty<TextSpanDto>(), Array.Empty<DiagnosticDto>());
			if (resource.Value is byte[] bytes)
				return new DecompileResponse(resource.Name, "plaintext", Convert.ToHexString(bytes), Array.Empty<TextSpanDto>(), [new DiagnosticDto("info", $"Binary resource, {bytes.Length:N0} bytes")]);
			return new DecompileResponse(resource.Name, "plaintext", resource.Value?.ToString() ?? string.Empty, Array.Empty<TextSpanDto>(), Array.Empty<DiagnosticDto>());
		}

		static string GuessResourceLanguage(string name) => Path.GetExtension(name).ToLowerInvariant() switch {
			".xaml" or ".xml" => "xml",
			".json" => "json",
			".cs" => "csharp",
			".vb" => "visual-basic",
			_ => "plaintext",
		};

		DecompileResponse DecompileCSharp(NodeEntry node, CancellationToken cancellationToken) {
			var settings = new DecompilerSettings();
			try {
				using var session = CreateCSharpDecompilerSession(node.Module, settings, cancellationToken);
				var decompiler = session.Decompiler;

				string text;
				IReadOnlyList<TextSpanDto> spans = Array.Empty<TextSpanDto>();
				IReadOnlyList<CodeStatementDto>? codeStatements = null;
				if (node.Kind == NodeKind.AssemblyReference)
					text = ((AssemblyRef)node.Value).FullName;
				else if (node.Kind == NodeKind.Resource)
					text = DescribeResource((Resource)node.Value);
				else {
					var syntaxTree = node.Kind switch {
						NodeKind.Module => decompiler.DecompileWholeModuleAsSingleFile(),
						NodeKind.Namespace => decompiler.Decompile(((NamespaceValue)node.Value).Types.Select(ToEntityHandle)),
						NodeKind.Type or NodeKind.Method or NodeKind.Field or NodeKind.Property or NodeKind.Event =>
							decompiler.Decompile([ToEntityHandle((IMDTokenProvider)node.Value)]),
						_ => throw new RpcException(ErrorCodes.UnsupportedDocument, "This tree node cannot be decompiled."),
					};
					var output = new SpanTextOutput(reference => ResolveDecompilerReference(reference, node.Module));
					RenderWithLocations(syntaxTree, output, settings);
					text = output.ToString();
					spans = output.Spans;
					codeStatements = BuildCodeStatements(syntaxTree, decompiler, node.Module, cancellationToken);
				}
				var diagnostics = decompiler.Errors
					.Select(e => new DiagnosticDto("warning", e.ToString()))
					.ToArray();
				if (codeStatements is not null) {
					RefreshStatementCache();
					codeStatementsByNode[$"{node.Id}:{stateId}"] = codeStatements;
				}
				return new DecompileResponse(GetLabel(node), "csharp", text, spans, diagnostics) { CodeStatements = codeStatements };
			}
			catch (OperationCanceledException) {
				throw;
			}
			catch (Exception ex) {
				throw new RpcException(ErrorCodes.UnsupportedDocument, "The selected item could not be decompiled.", null, ex);
			}
		}

		// A gutter click has to land on an exact IL offset, not on "the method that owns this line": the engine
		// refuses an offset that is not a sequence point. CreateSequencePoints over the tree that was just printed
		// gives the IL range of every statement together with the line(s) it was printed on, and the ILFunction
		// annotation names both the body the IL lives in and the source method the user sees.
		internal static IReadOnlyList<CodeStatementDto> BuildCodeStatements(SyntaxTree syntaxTree, CSharpDecompiler decompiler, ModuleEntry module, CancellationToken cancellationToken) {
			try {
				var statements = new List<CodeStatementDto>();
				// The points tile the method's IL and so start a statement where the IL before it ends up, which is
				// not where the statement's own code starts. StatementIlRanges recovers the latter from the tree.
				var statementStarts = StatementIlRanges.Collect(syntaxTree);
				foreach (var (function, points) in decompiler.CreateSequencePoints(syntaxTree)) {
					cancellationToken.ThrowIfCancellationRequested();
					if (GetBodyMethodToken(function) is not { } bodyToken)
						continue;
					var sourceToken = GetSourceMethodToken(function) ?? bodyToken;
					var description = DescribeMethod(module, sourceToken);
					statementStarts.TryGetValue(function, out var starts);
					foreach (var point in points) {
						if (point.EndOffset <= point.Offset)
							continue;
						statements.Add(new CodeStatementDto(
							point.StartLine,
							point.EndLine,
							point.StartColumn,
							point.EndColumn,
							StatementIlRanges.StartWithin(starts, point.Offset, point.EndOffset),
							point.EndOffset,
							point.Offset,
							module.Path,
							unchecked((int)bodyToken),
							unchecked((int)sourceToken),
							description,
							point.IsHidden));
					}
				}
				statements.Sort(static (left, right) => {
					var result = left.StartLine.CompareTo(right.StartLine);
					if (result != 0)
						return result;
					result = left.StartColumn.CompareTo(right.StartColumn);
					return result != 0 ? result : left.IlOffset.CompareTo(right.IlOffset);
				});
				return statements;
			}
			catch (OperationCanceledException) {
				throw;
			}
			catch (Exception) {
				// Losing the statement map only costs the editor its gutter markers, so never fail the decompilation over it.
				return Array.Empty<CodeStatementDto>();
			}
		}

		static string DescribeMethod(ModuleEntry module, uint token) =>
			module.Module.ResolveToken(token) is MethodDef method
				? method.FullName
				: $"0x{token:X8}";

		/// <summary>Prints the tree so ILSpy records the line and column of every node.</summary>
		internal static void RenderWithLocations(SyntaxTree syntaxTree, SpanTextOutput output, DecompilerSettings settings) {
			var tokenWriter = TokenWriter.WrapInWriterThatSetsLocationsInAST(new LocationTokenWriter(output, settings));
			syntaxTree.AcceptVisitor(new CSharpOutputVisitor(tokenWriter, settings.CSharpFormattingOptions));
		}

		// Prefer the source level method over the state machine or lambda implementation so the derived breakpoint
		// name matches the tree node (and the name the debug adapter is given). GetBodyMethodToken() below is the
		// opposite choice: it asks where the IL actually lives, which is what the IL/C# interleaving view needs.
		internal static uint? GetSourceMethodToken(ICSharpCode.Decompiler.IL.ILFunction function) {
			var method = function.Method ?? function.MoveNextMethod;
			if (method is null || method.MetadataToken.IsNil)
				return null;
			return unchecked((uint)MetadataTokens.GetToken(method.MetadataToken));
		}

		internal static uint? GetBodyMethodToken(ICSharpCode.Decompiler.IL.ILFunction function) {
			var method = function.MoveNextMethod ?? function.Method;
			if (method is null || method.MetadataToken.IsNil)
				return null;
			return unchecked((uint)MetadataTokens.GetToken(method.MetadataToken));
		}

		internal static CSharpDecompilerSession CreateCSharpDecompilerSession(ModuleEntry module, DecompilerSettings settings, CancellationToken cancellationToken) {
			if (!module.IsModified) {
				var decompiler = new CSharpDecompiler(module.Path, settings) { CancellationToken = cancellationToken };
				return new CSharpDecompilerSession(decompiler);
			}

			var snapshotStream = new MemoryStream();
			try {
				module.Module.Write(snapshotStream);
				snapshotStream.Position = 0;
				var snapshotFile = new ICSharpCode.Decompiler.Metadata.PEFile(
					module.Path,
					snapshotStream,
					PEStreamOptions.PrefetchEntireImage);
				try {
					var resolver = new ICSharpCode.Decompiler.Metadata.UniversalAssemblyResolver(
						module.Path,
						throwOnError: false,
						targetFramework: ICSharpCode.Decompiler.Metadata.DotNetCorePathFinderExtensions.DetectTargetFrameworkId(snapshotFile),
						runtimePack: ICSharpCode.Decompiler.Metadata.DotNetCorePathFinderExtensions.DetectRuntimePack(snapshotFile));
					var decompiler = new CSharpDecompiler(snapshotFile, resolver, settings) { CancellationToken = cancellationToken };
					return new CSharpDecompilerSession(decompiler, snapshotFile, snapshotStream);
				}
				catch {
					snapshotFile.Dispose();
					throw;
				}
			}
			catch {
				snapshotStream.Dispose();
				throw;
			}
		}

		string? ResolveDecompilerReference(object reference, ModuleEntry defaultModule) {
			if (reference is MetadataReference metadataReference)
				return ResolveMetadataHandle(metadataReference.Metadata, metadataReference.Handle, defaultModule);
			System.Reflection.Metadata.EntityHandle handle;
			DecompilerMetadataFile? metadataFile;
			switch (reference) {
				case DecompilerIMember member:
					handle = member.MetadataToken;
					metadataFile = member.ParentModule?.MetadataFile;
					break;
				case DecompilerIType type when type.GetDefinition() is { } definition:
					handle = definition.MetadataToken;
					metadataFile = definition.ParentModule?.MetadataFile;
					break;
				default:
					return null;
			}
			return ResolveMetadataHandle(metadataFile, handle, defaultModule);
		}

		string? ResolveMetadataHandle(DecompilerMetadataFile? metadataFile, System.Reflection.Metadata.Handle handle, ModuleEntry defaultModule) {
			if (handle.IsNil)
				return null;
			var module = defaultModule;
			if (!string.IsNullOrEmpty(metadataFile?.FileName)) {
				var matchingModule = modules.Values.FirstOrDefault(candidate => Path.GetFullPath(candidate.Path).Equals(Path.GetFullPath(metadataFile.FileName), StringComparison.Ordinal));
				if (matchingModule is not null)
					module = matchingModule;
			}
			var token = unchecked((uint)MetadataTokens.GetToken(handle));
			if (module.Module.ResolveToken(token) is not IMDTokenProvider provider || provider is not (TypeDef or MethodDef or FieldDef or PropertyDef or EventDef))
				return null;
			return GetMemberNode(provider, module).Id;
		}

		internal static System.Reflection.Metadata.EntityHandle ToEntityHandle(IMDTokenProvider provider) =>
			MetadataTokens.EntityHandle(unchecked((int)provider.MDToken.Raw));

		DecompileResponse DecompileIL(NodeEntry node) => new(
			GetLabel(node),
			"il",
			ILFormatter.Format(node),
			Array.Empty<TextSpanDto>(),
			Array.Empty<DiagnosticDto>());

		DecompileResponse DecompileILWithCSharp(NodeEntry node, CancellationToken cancellationToken) {
			var settings = new DecompilerSettings {
				UsingDeclarations = false,
			};
			try {
				using var session = CreateCSharpDecompilerSession(node.Module, settings, cancellationToken);
				var sourceProvider = new DecompiledSourceProvider(session.Decompiler, settings, cancellationToken);
				var text = ILFormatter.Format(node, sourceProvider.GetStatements);
				var diagnostics = session.Decompiler.Errors
					.Select(error => new DiagnosticDto("warning", error.ToString()))
					.ToArray();
				return new DecompileResponse(GetLabel(node), "il", text, Array.Empty<TextSpanDto>(), diagnostics);
			}
			catch (OperationCanceledException) {
				throw;
			}
			catch (Exception ex) {
				throw new RpcException(ErrorCodes.UnsupportedDocument, "The selected item could not be decompiled as IL with C#.", null, ex);
			}
		}

		async Task<DecompileResponse> DecompileVisualBasicAsync(NodeEntry node, CancellationToken cancellationToken) {
			var csharp = DecompileCSharp(node, cancellationToken);
			var conversion = await CodeConverter.ConvertAsync(
				new CodeWithOptions(csharp.Text).WithTypeReferences(),
				cancellationToken).ConfigureAwait(false);
			if (!conversion.Success) {
				var message = conversion.GetExceptionsAsString();
				return new DecompileResponse(
					csharp.Title,
					"visual-basic",
					$"' Visual Basic conversion failed.\n' {message.Replace(Environment.NewLine, Environment.NewLine + "' ", StringComparison.Ordinal)}",
					Array.Empty<TextSpanDto>(),
					[new DiagnosticDto("error", message)]);
			}
			var diagnostics = csharp.Diagnostics
				.Concat(conversion.Exceptions?.Select(exception => new DiagnosticDto("warning", exception)) ?? [])
				.ToArray();
			return new DecompileResponse(csharp.Title, "visual-basic", conversion.ConvertedCode, Array.Empty<TextSpanDto>(), diagnostics);
		}

		public SearchResponse Search(SearchRequest request, CancellationToken cancellationToken) {
			if (string.IsNullOrWhiteSpace(request.Query))
				return new SearchResponse(Array.Empty<SearchResultDto>(), false);
			var maxResults = Math.Clamp(request.MaxResults, 1, 10_000);
			var comparison = request.MatchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
			var requestedKinds = request.Kinds is null ? null : new HashSet<string>(request.Kinds, StringComparer.OrdinalIgnoreCase);
			var results = new List<SearchResultDto>();

			bool Add(NodeEntry node, string kind, string name, string location, string? preview = null) {
				if (requestedKinds is not null && !requestedKinds.Contains(kind))
					return false;
				if (!name.Contains(request.Query, comparison) && (preview is null || !preview.Contains(request.Query, comparison)))
					return false;
				results.Add(new SearchResultDto(node.Id, kind, name, location, preview));
				return results.Count >= maxResults;
			}

			foreach (var moduleEntry in modules.Values) {
				foreach (var type in moduleEntry.Module.GetTypes()) {
					cancellationToken.ThrowIfCancellationRequested();
					var typeNode = GetMemberNode(type, moduleEntry);
					if (Add(typeNode, "type", type.FullName, moduleEntry.Module.Name.String))
						return new SearchResponse(results, true);
					foreach (var member in EnumerateMembers(type)) {
						var memberNode = GetMemberNode(member, moduleEntry);
						if (Add(memberNode, GetKind(member).ToString().ToLowerInvariant(), GetMemberDisplayName(member), type.FullName))
							return new SearchResponse(results, true);
					}
					foreach (var method in type.Methods.Where(m => m.HasBody)) {
						foreach (var instruction in method.Body.Instructions) {
							if (instruction.Operand is not string value)
								continue;
							var methodNode = GetMemberNode(method, moduleEntry);
							if (Add(methodNode, "string", value, method.FullName, value))
								return new SearchResponse(results, true);
						}
					}
				}
			}
			return new SearchResponse(results, false);
		}

		public AnalyzeReferencesResponse AnalyzeReferences(AnalyzeReferencesRequest request, CancellationToken cancellationToken) {
			var target = GetNode(request.NodeId);
			var targetName = GetReferenceIdentity(target.Value);
			if (targetName is null)
				throw new RpcException(ErrorCodes.InvalidParams, "References can only be analyzed for types and members.");
			var maxResults = Math.Clamp(request.MaxResults, 1, 10_000);
			var results = new List<ReferenceResultDto>();

			foreach (var module in modules.Values) {
				foreach (var type in module.Module.GetTypes()) {
					cancellationToken.ThrowIfCancellationRequested();
					if (type.BaseType is not null && GetReferenceIdentity(type.BaseType) == targetName) {
						var source = GetMemberNode(type, module);
						results.Add(new ReferenceResultDto(source.Id, type.FullName, "base-type", module.Module.Name.String));
					}
					foreach (var method in type.Methods.Where(m => m.HasBody)) {
						foreach (var instruction in method.Body.Instructions) {
							if (!ReferencesTarget(instruction.Operand, targetName))
								continue;
							var source = GetMemberNode(method, module);
							results.Add(new ReferenceResultDto(source.Id, method.FullName, "instruction", $"IL_{instruction.Offset:X4}"));
							if (results.Count >= maxResults)
								return new AnalyzeReferencesResponse(results, true);
						}
					}
				}
			}
			return new AnalyzeReferencesResponse(results, false);
		}

		public HexLengthResponse GetHexLength(string moduleId) => new(GetModule(moduleId).FileLength);

		public async Task<HexReadResponse> ReadHexAsync(string moduleId, long offset, int count, CancellationToken cancellationToken) {
			var module = GetModule(moduleId);
			if (offset > module.FileLength)
				throw new RpcException(ErrorCodes.InvalidParams, "Offset is beyond the end of the file.");
			var actualCount = (int)Math.Min(count, module.FileLength - offset);
			var buffer = new byte[actualCount];
			await using var stream = new FileStream(module.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.RandomAccess);
			stream.Position = offset;
			await stream.ReadExactlyAsync(buffer, cancellationToken).ConfigureAwait(false);
			return new HexReadResponse(offset, Convert.ToBase64String(buffer), offset + actualCount >= module.FileLength);
		}

		public ModuleInfoResponse GetModuleInfo(string moduleId) {
			var entry = GetModule(moduleId);
			var module = entry.Module;
			var (peHeaders, metadataTables) = ReadPortableExecutableInfo(entry.Path);
			return new ModuleInfoResponse(
				module.Assembly?.FullName ?? module.Name.String,
				entry.Path,
				module.RuntimeVersion ?? string.Empty,
				module.Machine.ToString(),
				module.Kind.ToString(),
				module.Mvid ?? Guid.Empty,
				module.EntryPoint?.FullName,
				module.GetTypes().Count(),
				module.Resources.Count,
				module.GetAssemblyRefs().Select(a => a.FullName).ToArray(),
				peHeaders,
				metadataTables);
		}

		static (IReadOnlyDictionary<string, string> PeHeaders, IReadOnlyDictionary<string, int> MetadataTables) ReadPortableExecutableInfo(string path) {
			using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
			using var peReader = new PEReader(stream, PEStreamOptions.PrefetchMetadata);
			var headers = peReader.PEHeaders;
			var peHeader = headers.PEHeader;
			var peValues = new Dictionary<string, string>(StringComparer.Ordinal) {
				["Machine"] = headers.CoffHeader.Machine.ToString(),
				["Characteristics"] = headers.CoffHeader.Characteristics.ToString(),
				["Sections"] = headers.SectionHeaders.Length.ToString(CultureInfo.InvariantCulture),
				["PE magic"] = peHeader?.Magic.ToString() ?? string.Empty,
				["Subsystem"] = peHeader?.Subsystem.ToString() ?? string.Empty,
				["Image base"] = peHeader is null ? string.Empty : $"0x{peHeader.ImageBase:X}",
				["Entry point RVA"] = peHeader is null ? string.Empty : $"0x{peHeader.AddressOfEntryPoint:X8}",
				["Cor flags"] = headers.CorHeader?.Flags.ToString() ?? string.Empty,
			};
			var tableValues = new Dictionary<string, int>(StringComparer.Ordinal);
			if (peReader.HasMetadata) {
				var metadata = System.Reflection.Metadata.PEReaderExtensions.GetMetadataReader(peReader);
				foreach (var table in Enum.GetValues<TableIndex>()) {
					var count = metadata.GetTableRowCount(table);
					if (count > 0)
						tableValues[table.ToString()] = count;
				}
			}
			return (peValues, tableValues);
		}

		public BeginEditResponse BeginEdit() {
			var transaction = new EditTransaction(version);
			transactions.Add(transaction.Id, transaction);
			return new BeginEditResponse(transaction.Id, transaction.BaseVersion);
		}

		public MethodBodyResponse GetMethodBody(string methodNodeId) {
			var node = GetNode(methodNodeId);
			if (node.Value is not MethodDef method || !method.HasBody)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The selected method has no managed IL body.");
			var labels = method.Body.Instructions.ToDictionary(instruction => instruction, instruction => $"IL_{instruction.Offset:X4}");
			var instructions = method.Body.Instructions.Select(instruction => SerializeInstruction(method, instruction, labels)).ToArray();
			return new MethodBodyResponse(
				method.Body.MaxStack,
				method.Body.InitLocals,
				method.Body.Variables.Select(local => local.Type.FullName).ToArray(),
				instructions,
				method.Body.ExceptionHandlers.Count > 0);
		}

		IlInstructionDto SerializeInstruction(MethodDef method, Instruction instruction, IReadOnlyDictionary<Instruction, string> labels) {
			var label = labels[instruction];
			return instruction.Operand switch {
				null => new IlInstructionDto(label, instruction.OpCode.Name),
				string text => new IlInstructionDto(label, instruction.OpCode.Name, "string", text, text),
				Instruction target => new IlInstructionDto(label, instruction.OpCode.Name, "branch", labels[target], labels[target]),
				IList<Instruction> targets => new IlInstructionDto(label, instruction.OpCode.Name, "switch", string.Join(',', targets.Select(target => labels[target])), string.Join(", ", targets.Select(target => labels[target]))),
				Local local => new IlInstructionDto(label, instruction.OpCode.Name, "local", local.Index.ToString(CultureInfo.InvariantCulture), $"V_{local.Index}"),
				Parameter parameter => new IlInstructionDto(label, instruction.OpCode.Name, "argument", method.Parameters.IndexOf(parameter).ToString(CultureInfo.InvariantCulture), parameter.Name ?? $"A_{parameter.Index}"),
				IMDTokenProvider token => new IlInstructionDto(label, instruction.OpCode.Name, "token", token.MDToken.Raw.ToString("X8", CultureInfo.InvariantCulture), token.ToString()),
				float value => new IlInstructionDto(label, instruction.OpCode.Name, "number", value.ToString("R", CultureInfo.InvariantCulture)),
				double value => new IlInstructionDto(label, instruction.OpCode.Name, "number", value.ToString("R", CultureInfo.InvariantCulture)),
				IFormattable value => new IlInstructionDto(label, instruction.OpCode.Name, "number", value.ToString(null, CultureInfo.InvariantCulture)),
				_ => throw new RpcException(ErrorCodes.EditValidationFailed, $"Operand type {instruction.Operand.GetType().Name} cannot be edited."),
			};
		}

		public void QueueRename(RenameEditRequest request) {
			if (string.IsNullOrWhiteSpace(request.NewName) || request.NewName.Contains('\0'))
				throw new RpcException(ErrorCodes.EditValidationFailed, "The new name is invalid.");
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.NodeId);
			if (node.Value is not IMDTokenProvider)
				throw new RpcException(ErrorCodes.EditValidationFailed, "Only types and members can be renamed.");
			var oldName = GetEditableName(node.Value)
				?? throw new RpcException(ErrorCodes.EditValidationFailed, "The selected item cannot be renamed.");
			transaction.Add(node.Id, node.Module, () => {
				SetEditableName(node.Value, request.NewName);
				return () => SetEditableName(node.Value, oldName);
			});
		}

		public void QueueDelete(DeleteEditRequest request) {
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.NodeId);
			var undo = new List<Action>();
			transaction.Add(node.Id, node.Module, () => {
				// Validation happens before any list is touched, so a rejected delete cannot leave the
				// module half-modified when CommitEdit rolls this operation back.
				PlanDelete(node, out var remove);
				foreach (var step in remove)
					step(undo);
				return () => {
					// The steps recorded their undo in removal order; reversing replays them and restores
					// every list index exactly, including the descending-index bulk delete of a namespace.
					for (var i = undo.Count - 1; i >= 0; i--)
						undo[i]();
				};
			});
		}

		/// <summary>
		/// Works out how to remove <paramref name="node"/> without mutating anything yet. Each step both
		/// performs the removal when handed the undo list and records how to put the item back.
		/// </summary>
		static void PlanDelete(NodeEntry node, out IReadOnlyList<Action<List<Action>>> remove) {
			switch (node.Value) {
			case TypeDef type: {
				var owner = type.DeclaringType is null ? node.Module.Module.Types : type.DeclaringType.NestedTypes;
				var index = owner.IndexOf(type);
				if (index < 0)
					throw new RpcException(ErrorCodes.EditValidationFailed, "The type no longer belongs to its owner.");
				var steps = new List<Action<List<Action>>> {
					undo => {
						owner.RemoveAt(index);
						undo.Add(() => owner.Insert(index, type));
					},
				};
				remove = steps;
				break;
			}
			case MethodDef method: {
				var owner = method.DeclaringType?.Methods;
				var index = owner?.IndexOf(method) ?? -1;
				if (owner is null || index < 0)
					throw new RpcException(ErrorCodes.EditValidationFailed, "The method no longer belongs to its type.");
				remove = new List<Action<List<Action>>> {
					undo => {
						owner.RemoveAt(index);
						undo.Add(() => owner.Insert(index, method));
					},
				};
				break;
			}
			case FieldDef field: {
				var owner = field.DeclaringType?.Fields;
				var index = owner?.IndexOf(field) ?? -1;
				if (owner is null || index < 0)
					throw new RpcException(ErrorCodes.EditValidationFailed, "The field no longer belongs to its type.");
				remove = new List<Action<List<Action>>> {
					undo => {
						owner.RemoveAt(index);
						undo.Add(() => owner.Insert(index, field));
					},
				};
				break;
			}
			case PropertyDef property: {
				var declaringType = property.DeclaringType
					?? throw new RpcException(ErrorCodes.EditValidationFailed, "The property no longer belongs to its type.");
				var index = declaringType.Properties.IndexOf(property);
				if (index < 0)
					throw new RpcException(ErrorCodes.EditValidationFailed, "The property no longer belongs to its type.");
				remove = PlanDeleteWithAccessors(declaringType, () => {
					declaringType.Properties.RemoveAt(index);
					return () => declaringType.Properties.Insert(index, property);
				}, GetAccessorMethods(property));
				break;
			}
			case EventDef @event: {
				var declaringType = @event.DeclaringType
					?? throw new RpcException(ErrorCodes.EditValidationFailed, "The event no longer belongs to its type.");
				var index = declaringType.Events.IndexOf(@event);
				if (index < 0)
					throw new RpcException(ErrorCodes.EditValidationFailed, "The event no longer belongs to its type.");
				remove = PlanDeleteWithAccessors(declaringType, () => {
					declaringType.Events.RemoveAt(index);
					return () => declaringType.Events.Insert(index, @event);
				}, GetAccessorMethods(@event));
				break;
			}
			case NamespaceValue ns: {
				var types = node.Module.Module.Types
					.Select((type, index) => (Type: type, Index: index))
					.Where(entry => entry.Type.DeclaringType is null && !entry.Type.IsGlobalModuleType &&
						(entry.Type.Namespace.String ?? string.Empty) == ns.Name)
					.OrderByDescending(entry => entry.Index)
					.ToArray();
				// Removing every type of the namespace, and removing an empty namespace, are the same
				// command in dnSpy — the latter just ends up with nothing to remove.
				remove = types.Select(entry => (Action<List<Action>>)(undo => {
					node.Module.Module.Types.RemoveAt(entry.Index);
					undo.Add(() => node.Module.Module.Types.Insert(entry.Index, entry.Type));
				})).ToArray();
				break;
			}
			case Resource resource: {
				var owner = node.Module.Module.Resources;
				var index = owner.IndexOf(resource);
				if (index < 0)
					throw new RpcException(ErrorCodes.EditValidationFailed, "The resource no longer belongs to the module.");
				remove = new List<Action<List<Action>>> {
					undo => {
						owner.RemoveAt(index);
						undo.Add(() => owner.Insert(index, resource));
					},
				};
				break;
			}
			default:
				throw new RpcException(ErrorCodes.EditValidationFailed, "This item cannot be deleted.");
			}
		}

		/// <summary>
		/// Removes a property or an event together with its accessor methods, the way dnSpy does: leaving
		/// the getter/setter or add/remove methods behind would keep them in the type's method list.
		/// </summary>
		static IReadOnlyList<Action<List<Action>>> PlanDeleteWithAccessors(
			TypeDef declaringType,
			Func<Action> removeMembers,
			IEnumerable<MethodDef> accessors) {
			var methods = declaringType.Methods;
			var accessorIndexes = accessors
				.Select(method => (Method: method, Index: methods.IndexOf(method)))
				.Where(entry => entry.Index >= 0)
				.OrderByDescending(entry => entry.Index)
				.ToArray();
			return new List<Action<List<Action>>> {
				undo => {
					foreach (var entry in accessorIndexes) {
						methods.RemoveAt(entry.Index);
						undo.Add(() => methods.Insert(entry.Index, entry.Method));
					}
					undo.Add(removeMembers());
				},
			};
		}

		static IEnumerable<MethodDef> GetAccessorMethods(PropertyDef property) {
			foreach (var method in property.GetMethods)
				yield return method;
			foreach (var method in property.SetMethods)
				yield return method;
			foreach (var method in property.OtherMethods)
				yield return method;
		}

		static IEnumerable<MethodDef> GetAccessorMethods(EventDef @event) {
			if (@event.AddMethod is not null)
				yield return @event.AddMethod;
			if (@event.RemoveMethod is not null)
				yield return @event.RemoveMethod;
			if (@event.InvokeMethod is not null)
				yield return @event.InvokeMethod;
			foreach (var method in @event.OtherMethods)
				yield return method;
		}

		public void QueueSetNamespace(SetNamespaceEditRequest request) {
			if (request.NewName.Contains('\0'))
				throw new RpcException(ErrorCodes.EditValidationFailed, "The namespace name is invalid.");
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.NodeId);
			if (node.Value is not NamespaceValue ns)
				throw new RpcException(ErrorCodes.EditValidationFailed, "Only a namespace can be renamed.");

			var oldName = ns.Name;
			var newName = request.NewName;
			var types = node.Module.Module.Types
				.Where(t => t.DeclaringType is null && !t.IsGlobalModuleType && (t.Namespace.String ?? string.Empty) == oldName)
				.ToArray();
			if (types.Length == 0)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The namespace has no types to move.");

			// A type moved to another namespace is still named by its TypeRefs, so references in the other
			// workspace modules have to be rewritten too or the saved assembly would point at a name that
			// no longer exists. Matching on the full name catches them without resolving, which would load
			// a second copy of the module from disk and never compare equal to the in-memory type.
			var movedNames = types.Select(t => t.FullName).ToHashSet(StringComparer.Ordinal);
			var typeRefs = modules.Values
				.SelectMany(module => module.Module.GetTypeRefs())
				.Where(typeRef => movedNames.Contains(typeRef.FullName))
				.ToArray();

			transaction.Add(node.Id, node.Module, () => {
				foreach (var typeRef in typeRefs)
					typeRef.Namespace = newName;
				foreach (var type in types)
					type.Namespace = newName;
				return () => {
					foreach (var type in types)
						type.Namespace = oldName;
					foreach (var typeRef in typeRefs)
						typeRef.Namespace = oldName;
				};
			});
		}

		public void QueueMethodBody(ReplaceMethodBodyRequest request) {
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.MethodNodeId);
			if (node.Value is not MethodDef method)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The selected item is not a method.");
			if (method.HasBody && method.Body.ExceptionHandlers.Count > 0 && !request.ClearExceptionHandlers)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The method contains exception handlers. Explicitly clear them or use an exception-handler aware editor.");

			var body = BuildMethodBody(method, request);
			transaction.Add(node.Id, node.Module, () => {
				var oldBody = method.Body;
				method.Body = body;
				return () => method.Body = oldBody;
			});
		}

		public void QueueMethodBodyStub(ReplaceMethodBodyWithStubRequest request) {
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.MethodNodeId);
			if (node.Value is not MethodDef method)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The selected item is not a method.");

			var body = MethodBodyStub.Create(method);
			transaction.Add(node.Id, node.Module, () => {
				var oldBody = method.Body;
				var oldCodeType = method.CodeType;
				// dnSpy's MethodBodyOptions.CopyTo writes the code type back as IL; a method that was
				// previously native or runtime would otherwise keep a flag that contradicts its body.
				method.CodeType = dnlib.DotNet.MethodImplAttributes.IL;
				method.Body = body;
				return () => {
					method.Body = oldBody;
					method.CodeType = oldCodeType;
				};
			});
		}

		public void QueueResource(ReplaceResourceRequest request) {
			var transaction = GetTransaction(request.TransactionId);
			var node = GetNode(request.ResourceNodeId);
			if (node.Value is not EmbeddedResource oldResource)
				throw new RpcException(ErrorCodes.EditValidationFailed, "Only embedded resources can be replaced.");
			byte[] data;
			try {
				data = Convert.FromBase64String(request.Base64Data);
			}
			catch (FormatException ex) {
				throw new RpcException(ErrorCodes.EditValidationFailed, "The resource data is not valid base64.", null, ex);
			}
			var index = node.Module.Module.Resources.IndexOf(oldResource);
			if (index < 0)
				throw new RpcException(ErrorCodes.EditValidationFailed, "The resource no longer belongs to the module.");
			var replacement = new EmbeddedResource(oldResource.Name, data, oldResource.Attributes);
			transaction.Add(node.Id, node.Module, () => {
				node.Module.Module.Resources[index] = replacement;
				node.Value = replacement;
				return () => {
					node.Module.Module.Resources[index] = oldResource;
					node.Value = oldResource;
				};
			});
		}

		public EditCommitResponse CommitEdit(string transactionId) {
			var transaction = GetTransaction(transactionId);
			if (transaction.BaseVersion != version)
				throw new RpcException(ErrorCodes.EditConflict, "The workspace changed after this edit transaction began.");
			var undo = new Stack<Action>();
			try {
				foreach (var operation in transaction.Operations)
					undo.Push(operation.Apply());
			}
			catch (Exception ex) {
				while (undo.TryPop(out var rollback))
					rollback();
				throw new RpcException(ErrorCodes.EditValidationFailed, "The edit transaction could not be applied.", null, ex);
			}
			transactions.Remove(transactionId);
			foreach (var module in transaction.Operations.Select(operation => operation.Module).Distinct())
				module.IsModified = true;
			var previousStateId = stateId;
			stateId = Guid.NewGuid().ToString("N");
			undoHistory.Push(new EditHistoryEntry(transaction.Operations.ToArray(), undo.ToArray(), previousStateId, stateId));
			redoHistory.Clear();
			version++;
			return CreateHistoryResponse(transaction.Operations);
		}

		public void RollbackEdit(string transactionId) {
			if (!transactions.Remove(transactionId))
				throw new RpcException(ErrorCodes.EditTransactionNotFound, "The edit transaction no longer exists.");
		}

		public EditCommitResponse Undo() {
			if (!undoHistory.TryPop(out var history))
				throw new RpcException(ErrorCodes.EditValidationFailed, "There is no edit to undo.");
			foreach (var undo in history.UndoActions)
				undo();
			stateId = history.BeforeStateId;
			redoHistory.Push(history);
			version++;
			return CreateHistoryResponse(history.Operations);
		}

		public EditCommitResponse Redo() {
			if (!redoHistory.TryPop(out var history))
				throw new RpcException(ErrorCodes.EditValidationFailed, "There is no edit to redo.");
			var undo = new Stack<Action>();
			try {
				foreach (var operation in history.Operations)
					undo.Push(operation.Apply());
			}
			catch (Exception ex) {
				while (undo.TryPop(out var rollback))
					rollback();
				redoHistory.Push(history);
				throw new RpcException(ErrorCodes.EditValidationFailed, "The edit could not be reapplied.", null, ex);
			}
			stateId = history.AfterStateId;
			var reapplied = new EditHistoryEntry(history.Operations, undo.ToArray(), history.BeforeStateId, history.AfterStateId);
			undoHistory.Push(reapplied);
			version++;
			return CreateHistoryResponse(history.Operations);
		}

		EditCommitResponse CreateHistoryResponse(IReadOnlyList<EditOperation> operations) => new(
			version,
			stateId,
			operations.Select(operation => operation.NodeId).Distinct(StringComparer.Ordinal).ToArray(),
			undoHistory.Count > 0,
			redoHistory.Count > 0);

		public async Task<SaveModuleResponse> SaveModuleAsync(SaveModuleRequest request, CancellationToken cancellationToken) {
			var module = GetModule(request.ModuleId);
			var destination = Path.GetFullPath(request.DestinationPath);
			var directory = Path.GetDirectoryName(destination);
			if (string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
				throw new RpcException(ErrorCodes.SaveFailed, "The destination directory does not exist.");
			if (File.Exists(destination) && !request.Overwrite)
				throw new RpcException(ErrorCodes.SaveFailed, "The destination already exists.");

			var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(destination)}.{Guid.NewGuid():N}.tmp");
			try {
				await Task.Run(() => module.Module.Write(temporaryPath), cancellationToken).ConfigureAwait(false);
				cancellationToken.ThrowIfCancellationRequested();
				using (var verificationModule = ModuleDefMD.Load(temporaryPath)) {
					_ = verificationModule.Mvid;
					_ = verificationModule.Types.Count;
				}
				File.Move(temporaryPath, destination, request.Overwrite);
				await using var savedFile = new FileStream(destination, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
				var hash = await SHA256.HashDataAsync(savedFile, cancellationToken).ConfigureAwait(false);
				return new SaveModuleResponse(destination, savedFile.Length, Convert.ToHexString(hash).ToLowerInvariant());
			}
			catch (OperationCanceledException) {
				throw;
			}
			catch (Exception ex) when (ex is not RpcException) {
				throw new RpcException(ErrorCodes.SaveFailed, "The module could not be saved.", null, ex);
			}
			finally {
				try {
					if (File.Exists(temporaryPath))
						File.Delete(temporaryPath);
				}
				catch (IOException) {
				}
			}
		}

		EditTransaction GetTransaction(string id) => transactions.TryGetValue(id, out var transaction)
			? transaction
			: throw new RpcException(ErrorCodes.EditTransactionNotFound, "The edit transaction no longer exists.");

		CilBody BuildMethodBody(MethodDef method, ReplaceMethodBodyRequest request) {
			if (request.Instructions.Count == 0 || request.Instructions.Count > 100_000)
				throw new RpcException(ErrorCodes.EditValidationFailed, "A method body must contain between 1 and 100,000 instructions.");
			var body = new CilBody {
				InitLocals = request.InitLocals ?? method.Body?.InitLocals ?? false,
				MaxStack = (ushort)Math.Clamp(request.MaxStack ?? method.Body?.MaxStack ?? 8, 0, ushort.MaxValue),
				KeepOldMaxStack = request.MaxStack is not null,
			};
			if (method.Body is not null) {
				foreach (var local in method.Body.Variables)
					body.Variables.Add(new Local(local.Type));
			}

			var instructions = new Dictionary<string, Instruction>(StringComparer.Ordinal);
			foreach (var source in request.Instructions) {
				if (string.IsNullOrWhiteSpace(source.Label) || instructions.ContainsKey(source.Label))
					throw new RpcException(ErrorCodes.EditValidationFailed, $"Instruction label is empty or duplicated: {source.Label}");
				var opCode = GetOpCode(source.OpCode);
				var instruction = new Instruction(opCode);
				instructions.Add(source.Label, instruction);
				body.Instructions.Add(instruction);
			}

			for (var index = 0; index < request.Instructions.Count; index++) {
				var source = request.Instructions[index];
				body.Instructions[index].Operand = ParseOperand(method, body, body.Instructions[index].OpCode, source, instructions);
			}
			body.UpdateInstructionOffsets();
			return body;
		}

		object? ParseOperand(MethodDef method, CilBody body, OpCode opCode, IlInstructionDto source, IReadOnlyDictionary<string, Instruction> instructions) {
			string RequiredOperand() => source.Operand ?? throw new RpcException(ErrorCodes.EditValidationFailed, $"{opCode.Name} requires an operand.");
			try {
				return opCode.OperandType switch {
					OperandType.InlineNone => null,
					OperandType.ShortInlineI => sbyte.Parse(RequiredOperand(), NumberStyles.Integer, CultureInfo.InvariantCulture),
					OperandType.InlineI => int.Parse(RequiredOperand(), NumberStyles.Integer, CultureInfo.InvariantCulture),
					OperandType.InlineI8 => long.Parse(RequiredOperand(), NumberStyles.Integer, CultureInfo.InvariantCulture),
					OperandType.ShortInlineR => float.Parse(RequiredOperand(), NumberStyles.Float, CultureInfo.InvariantCulture),
					OperandType.InlineR => double.Parse(RequiredOperand(), NumberStyles.Float, CultureInfo.InvariantCulture),
					OperandType.InlineString => RequiredOperand(),
					OperandType.ShortInlineBrTarget or OperandType.InlineBrTarget => GetTarget(RequiredOperand(), instructions),
					OperandType.InlineSwitch => RequiredOperand().Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(label => GetTarget(label, instructions)).ToArray(),
					OperandType.ShortInlineVar or OperandType.InlineVar => GetVariableOperand(method, body, source),
					OperandType.InlineType or OperandType.InlineField or OperandType.InlineMethod or OperandType.InlineTok => GetTokenOperand(method.Module, opCode.OperandType, source),
					_ => throw new RpcException(ErrorCodes.EditValidationFailed, $"Operand type {opCode.OperandType} is not supported by the structured IL editor."),
				};
			}
			catch (RpcException) {
				throw;
			}
			catch (Exception ex) when (ex is FormatException or OverflowException or ArgumentOutOfRangeException) {
				throw new RpcException(ErrorCodes.EditValidationFailed, $"The operand for {opCode.Name} is invalid.", null, ex);
			}
		}

		object GetTokenOperand(ModuleDef module, OperandType operandType, IlInstructionDto source) {
			object value;
			if (source.OperandKind?.Equals("token", StringComparison.OrdinalIgnoreCase) == true) {
				if (!uint.TryParse(source.Operand, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var rawToken))
					throw new RpcException(ErrorCodes.EditValidationFailed, "The metadata token operand is invalid.");
				value = module.ResolveToken(rawToken)
					?? throw new RpcException(ErrorCodes.EditValidationFailed, "The metadata token operand could not be resolved.");
			}
			else {
				var nodeId = source.Operand ?? throw new RpcException(ErrorCodes.EditValidationFailed, "The token node ID is missing.");
				value = GetNode(nodeId).Value;
			}
			return operandType switch {
				OperandType.InlineType when value is ITypeDefOrRef type => type,
				OperandType.InlineField when value is IField field => field,
				OperandType.InlineMethod when value is IMethod method => method,
				OperandType.InlineTok when value is ITokenOperand token => token,
				_ => throw new RpcException(ErrorCodes.EditValidationFailed, "The selected node is incompatible with the IL token operand."),
			};
		}

		static object GetVariableOperand(MethodDef method, CilBody body, IlInstructionDto source) {
			var index = int.Parse(source.Operand ?? string.Empty, NumberStyles.None, CultureInfo.InvariantCulture);
			return source.OperandKind?.ToLowerInvariant() switch {
				"local" when index < body.Variables.Count => body.Variables[index],
				"argument" when index < method.Parameters.Count => method.Parameters[index],
				_ => throw new RpcException(ErrorCodes.EditValidationFailed, "Variable operands require a valid local or argument index."),
			};
		}

		static Instruction GetTarget(string label, IReadOnlyDictionary<string, Instruction> instructions) =>
			instructions.TryGetValue(label, out var target)
				? target
				: throw new RpcException(ErrorCodes.EditValidationFailed, $"Branch target does not exist: {label}");

		static readonly IReadOnlyDictionary<string, OpCode> OpCodesByName = typeof(OpCodes)
			.GetFields(BindingFlags.Public | BindingFlags.Static)
			.Where(field => field.FieldType == typeof(OpCode))
			.Select(field => (OpCode)field.GetValue(null)!)
			.ToDictionary(opCode => opCode.Name, StringComparer.OrdinalIgnoreCase);

		static OpCode GetOpCode(string name) => OpCodesByName.TryGetValue(name, out var opCode)
			? opCode
			: throw new RpcException(ErrorCodes.EditValidationFailed, $"Unknown IL opcode: {name}");

		static string? GetEditableName(object value) => value switch {
			TypeDef type => type.Name.String,
			MethodDef method => method.Name.String,
			FieldDef field => field.Name.String,
			PropertyDef property => property.Name.String,
			EventDef @event => @event.Name.String,
			_ => null,
		};

		static void SetEditableName(object value, string name) {
			switch (value) {
				case TypeDef type: type.Name = name; break;
				case MethodDef method: method.Name = name; break;
				case FieldDef field: field.Name = name; break;
				case PropertyDef property: property.Name = name; break;
				case EventDef @event: @event.Name = name; break;
				default: throw new RpcException(ErrorCodes.EditValidationFailed, "The selected item cannot be renamed.");
			}
		}

		ModuleEntry GetModule(string moduleId) => modules.TryGetValue(moduleId, out var module)
			? module
			: throw new RpcException(ErrorCodes.NodeNotFound, "The module no longer exists.");

		NodeEntry GetNode(string nodeId) => nodes.TryGetValue(nodeId, out var node)
			? node
			: throw new RpcException(ErrorCodes.NodeNotFound, "The selected tree node no longer exists.");

		NodeEntry GetMemberNode(IMDTokenProvider member, ModuleEntry module) => GetOrAddNode(
			MemberKey(module, GetKind(member).ToString(), member.MDToken.Raw),
			GetKind(member),
			member,
			module);

		NodeEntry GetOrAddNode(string key, NodeKind kind, object value, ModuleEntry module) {
			if (nodeIdsByKey.TryGetValue(key, out var id))
				return nodes[id];
			id = $"n{(++nextNodeId).ToString(CultureInfo.InvariantCulture)}";
			var entry = new NodeEntry(id, key, kind, value, module);
			nodes.Add(id, entry);
			nodeIdsByKey.Add(key, id);
			return entry;
		}

		static string MemberKey(ModuleEntry module, string kind, uint token) => $"{module.Path}:{kind}:{token:X8}";

		static NodeKind GetKind(IMDTokenProvider provider) => provider switch {
			TypeDef => NodeKind.Type,
			MethodDef => NodeKind.Method,
			FieldDef => NodeKind.Field,
			PropertyDef => NodeKind.Property,
			EventDef => NodeKind.Event,
			_ => throw new ArgumentOutOfRangeException(nameof(provider)),
		};

		static IEnumerable<IMDTokenProvider> EnumerateMembers(TypeDef type) {
			foreach (var field in type.Fields)
				yield return field;
			foreach (var property in type.Properties)
				yield return property;
			foreach (var @event in type.Events)
				yield return @event;
			foreach (var method in type.Methods)
				yield return method;
		}

		static string? GetReferenceIdentity(object? value) => value switch {
			ITypeDefOrRef type => $"T:{type.FullName}",
			IField field => $"F:{field.FullName}",
			IMethod method => $"M:{method.FullName}",
			PropertyDef property => $"P:{property.FullName}",
			EventDef @event => $"E:{@event.FullName}",
			_ => null,
		};

		static bool ReferencesTarget(object? value, string targetIdentity) {
			if (GetReferenceIdentity(value) == targetIdentity)
				return true;
			if (!targetIdentity.StartsWith("T:", StringComparison.Ordinal))
				return false;
			var declaringType = value switch {
				IMethod method => method.DeclaringType,
				IField field => field.DeclaringType,
				_ => null,
			};
			return declaringType is not null && $"T:{declaringType.FullName}" == targetIdentity;
		}

		static string GetMemberDisplayName(IMDTokenProvider member) => member switch {
			TypeDef type => type.FullName,
			MethodDef method => $"{method.Name}{FormatParameterList(method)}",
			FieldDef field => field.Name.String,
			PropertyDef property => property.Name.String,
			EventDef @event => @event.Name.String,
			_ => member.ToString() ?? string.Empty,
		};

		static string FormatParameterList(MethodDef method) => $"({string.Join(", ", method.Parameters.Where(p => !p.IsHiddenThisParameter).Select(p => p.Type.TypeName))})";

		static TreeNodeDto ToDto(NodeEntry node) => new(
			node.Id,
			GetLabel(node),
			node.Kind.ToString().ToLowerInvariant(),
			HasChildren(node),
			GetDescription(node),
			GetIcon(node));

		static string GetLabel(NodeEntry node) => node.Kind switch {
			NodeKind.Module => ((ModuleDefMD)node.Value).Assembly?.Name.String ?? ((ModuleDefMD)node.Value).Name.String,
			NodeKind.Namespace => string.IsNullOrEmpty(((NamespaceValue)node.Value).Name) ? "-" : ((NamespaceValue)node.Value).Name,
			NodeKind.ReferencesGroup => "Assembly References",
			NodeKind.ResourcesGroup => "Resources",
			NodeKind.AssemblyReference => ((AssemblyRef)node.Value).Name.String,
			NodeKind.Resource => ((Resource)node.Value).Name,
			NodeKind.ResourceEntry => ((ResourceEntryValue)node.Value).Name,
			NodeKind.Type or NodeKind.Method or NodeKind.Field or NodeKind.Property or NodeKind.Event => GetMemberDisplayName((IMDTokenProvider)node.Value),
			_ => node.Kind.ToString(),
		};

		static string? GetDescription(NodeEntry node) => node.Kind switch {
			NodeKind.Module => node.Module.Path,
			NodeKind.AssemblyReference => ((AssemblyRef)node.Value).FullName,
			NodeKind.Resource => DescribeResource((Resource)node.Value),
			NodeKind.ResourceEntry => DescribeResourceEntry((ResourceEntryValue)node.Value),
			NodeKind.Type => ((TypeDef)node.Value).FullName,
			NodeKind.Method => ((MethodDef)node.Value).FullName,
			NodeKind.Field => ((FieldDef)node.Value).FullName,
			_ => null,
		};

		static bool HasChildren(NodeEntry node) => node.Kind switch {
			NodeKind.Module or NodeKind.Namespace or NodeKind.ReferencesGroup or NodeKind.ResourcesGroup => true,
			NodeKind.Resource => node.Value is EmbeddedResource resource && resource.Name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase),
			NodeKind.Type => ((TypeDef)node.Value).NestedTypes.Count + ((TypeDef)node.Value).Fields.Count + ((TypeDef)node.Value).Properties.Count + ((TypeDef)node.Value).Events.Count + ((TypeDef)node.Value).Methods.Count != 0,
			_ => false,
		};

		static string GetIcon(NodeEntry node) => node.Kind switch {
			NodeKind.Module => "assembly",
			NodeKind.Namespace => "namespace",
			NodeKind.ReferencesGroup or NodeKind.AssemblyReference => "reference",
			NodeKind.ResourcesGroup or NodeKind.Resource or NodeKind.ResourceEntry => "resource",
			NodeKind.Type => ((TypeDef)node.Value).IsInterface ? "interface" : ((TypeDef)node.Value).IsEnum ? "enum" : "class",
			NodeKind.Method => "method",
			NodeKind.Field => "field",
			NodeKind.Property => "property",
			NodeKind.Event => "event",
			_ => "item",
		};

		static string DescribeResource(Resource resource) => resource switch {
			EmbeddedResource embedded => $"Embedded resource, {embedded.Length:N0} bytes",
			AssemblyLinkedResource linked => $"Assembly-linked resource: {linked.Assembly?.FullName}",
			LinkedResource linked => $"Linked resource: {linked.File}",
			_ => resource.ResourceType.ToString(),
		};

		static string DescribeResourceEntry(ResourceEntryValue value) => value.Value switch {
			byte[] bytes => $"{Path.GetExtension(value.Name).TrimStart('.').ToUpperInvariant()} resource, {bytes.Length:N0} bytes",
			string text => $"Text resource, {text.Length:N0} characters",
			null => "Null resource",
			_ => value.Value.GetType().FullName ?? "Resource",
		};

		// The statement map is derived from the decompiled text, so an edit invalidates every entry at once.
		void RefreshStatementCache() {
			if (stateId == cachedStatementsStateId)
				return;
			codeStatementsByNode.Clear();
			symbols.Invalidate();
			cachedStatementsStateId = stateId;
		}

		// ---------------------------------------------------------------- debug symbols

		internal ResolveBreakpointsResponse ResolveBreakpoints(IReadOnlyList<BreakpointQuery> queries, CancellationToken cancellationToken) {
			var resolved = new List<ResolvedBreakpoint>(queries.Count);
			foreach (var query in queries) {
				cancellationToken.ThrowIfCancellationRequested();
				resolved.Add(ResolveBreakpoint(query, cancellationToken));
			}
			return new ResolveBreakpointsResponse(resolved);
		}

		ResolvedBreakpoint ResolveBreakpoint(BreakpointQuery query, CancellationToken cancellationToken) {
			IReadOnlyList<CodeStatementDto> statements;
			try {
				statements = GetCodeStatements(query.NodeId, cancellationToken);
			}
			catch (RpcException ex) {
				return Unbound(query, ex.Message);
			}
			var statement = FindStatement(statements, query.Line, query.Column);
			if (statement is null)
				return Unbound(query, "No sequence point on this line.");
			return new ResolvedBreakpoint(
				query.Id,
				true,
				null,
				statement.ModulePath,
				statement.MetadataToken,
				statement.SourceMethodToken,
				statement.IlOffset,
				// The engine arms the statement's own start first and falls back to this; without one it
				// reports the breakpoint dead, which beats a breakpoint that stops on another line.
				symbols.AcceptedPointOffset(this, statement),
				statement.StartLine,
				statement.EndLine,
				statement.StartColumn,
				statement.EndColumn,
				statement.Description);
		}

		static ResolvedBreakpoint Unbound(BreakpointQuery query, string reason) => new(
			query.Id, false, reason, null, null, null, null, null, query.Line, query.Line, 0, 0, null);

		/// <summary>
		/// Snaps a requested line to the statement that owns it, or to the closest one below it. A click on a
		/// blank line, a brace or a comment still has to land on something the engine can bind.
		/// </summary>
		internal static CodeStatementDto? FindStatement(IReadOnlyList<CodeStatementDto> statements, int line, int? column) {
			CodeStatementDto? covering = null;
			foreach (var statement in statements) {
				if (statement.IsHidden || line < statement.StartLine || line > statement.EndLine)
					continue;
				if (column is int requested && statement.StartLine == statement.EndLine &&
					(requested < statement.StartColumn - 1 || requested > statement.EndColumn))
					continue;
				if (covering is null || statement.StartColumn < covering.StartColumn)
					covering = statement;
			}
			if (covering is not null)
				return covering;

			CodeStatementDto? nearest = null;
			foreach (var statement in statements) {
				if (statement.IsHidden)
					continue;
				if (nearest is null || IsCloser(statement, nearest, line))
					nearest = statement;
			}
			return nearest;
		}

		// Distance first; on a tie the statement after the requested line wins, matching what a user expects
		// from clicking just above a statement.
		static bool IsCloser(CodeStatementDto candidate, CodeStatementDto current, int line) {
			var candidateDistance = Distance(candidate.StartLine, line);
			var currentDistance = Distance(current.StartLine, line);
			if (candidateDistance != currentDistance)
				return candidateDistance < currentDistance;
			return candidate.StartLine > current.StartLine;
		}

		static int Distance(int startLine, int line) => startLine >= line ? startLine - line : line - startLine;

		IReadOnlyList<CodeStatementDto> GetCodeStatements(string nodeId, CancellationToken cancellationToken) {
			RefreshStatementCache();
			var key = $"{nodeId}:{stateId}";
			if (codeStatementsByNode.TryGetValue(key, out var cached))
				return cached;
			var node = GetNode(nodeId);
			var statements = DecompileCSharp(node, cancellationToken).CodeStatements ?? Array.Empty<CodeStatementDto>();
			codeStatementsByNode[key] = statements;
			return statements;
		}

		internal ResolvedIlLocation? ResolveIlLocation(string modulePath, int metadataToken, int ilOffset, CancellationToken cancellationToken) =>
			symbols.ResolveIlLocation(this, modulePath, metadataToken, ilOffset, cancellationToken);

		internal MethodIlInfoResponse? GetMethodIlInfo(string modulePath, int metadataToken, CancellationToken cancellationToken) =>
			symbols.GetMethodIlInfo(this, modulePath, metadataToken, cancellationToken);

		internal IReadOnlyList<MethodIlInfoResponse> FindMethods(string name, CancellationToken cancellationToken) =>
			symbols.FindMethods(this, name, cancellationToken);

		/// <summary>The module node id for a member, or null when the module is only loaded, not opened.</summary>
		internal string? TryGetMemberNodeId(ModuleEntry module, IMDTokenProvider member) =>
			module.IsExternal ? null : GetMemberNode(member, module).Id;

		/// <summary>
		/// Resolves the identity a persisted bookmark was saved with — module path plus metadata token —
		/// back to a node. The member is materialised on demand, so a bookmark stays navigable after a
		/// restart even though node ids are only unique within one workspace.
		/// </summary>
		internal FindMemberResponse FindMember(string modulePath, int metadataToken) {
			if (metadataToken == 0 || FindModuleEntry(modulePath) is not ModuleEntry module || module.IsExternal)
				return new FindMemberResponse(null, null, null);
			IMDTokenProvider? member;
			try {
				member = module.Module.ResolveToken(unchecked((uint)metadataToken));
			}
			catch (Exception) {
				// A token that no longer resolves is a bookmark whose assembly changed underneath it.
				return new FindMemberResponse(null, null, null);
			}
			// Only members the tree can show have a document to navigate to.
			if (member is not (TypeDef or MethodDef or FieldDef or PropertyDef or EventDef))
				return new FindMemberResponse(null, null, null);
			var dto = ToDto(GetMemberNode(member, module));
			return new FindMemberResponse(dto.Id, dto.Label, dto.Description);
		}

		internal ModuleEntry? FindModuleEntry(string path) {
			foreach (var entry in modules.Values) {
				if (Path.GetFullPath(entry.Path).Equals(Path.GetFullPath(path), StringComparison.Ordinal))
					return entry;
			}
			return null;
		}

		internal IEnumerable<ModuleEntry> OpenModules => modules.Values;

		internal string SymbolScope => stateId;

		public async Task<T> RunAsync<T>(Func<Workspace, T> action, CancellationToken cancellationToken) {
			await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
			try {
				ObjectDisposedException.ThrowIf(disposed, this);
				return action(this);
			}
			finally {
				gate.Release();
			}
		}

		public async Task<T> RunAsync<T>(Func<Workspace, Task<T>> action, CancellationToken cancellationToken) {
			await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
			try {
				ObjectDisposedException.ThrowIf(disposed, this);
				return await action(this).ConfigureAwait(false);
			}
			finally {
				gate.Release();
			}
		}

		public void Dispose() {
			if (disposed)
				return;
			disposed = true;
			foreach (var module in modules.Values)
				module.Module.Dispose();
			modules.Clear();
			nodes.Clear();
			nodeIdsByKey.Clear();
			codeStatementsByNode.Clear();
			transactions.Clear();
			undoHistory.Clear();
			redoHistory.Clear();
			gate.Dispose();
		}

		internal sealed class CSharpDecompilerSession : IDisposable {
			readonly ICSharpCode.Decompiler.Metadata.PEFile? snapshotFile;
			readonly MemoryStream? snapshotStream;

			public CSharpDecompilerSession(
				CSharpDecompiler decompiler,
				ICSharpCode.Decompiler.Metadata.PEFile? snapshotFile = null,
				MemoryStream? snapshotStream = null) {
				Decompiler = decompiler;
				this.snapshotFile = snapshotFile;
				this.snapshotStream = snapshotStream;
			}

			public CSharpDecompiler Decompiler { get; }

			public void Dispose() {
				snapshotFile?.Dispose();
				snapshotStream?.Dispose();
			}
		}

		sealed class DecompiledSourceProvider(
			CSharpDecompiler decompiler,
			DecompilerSettings settings,
			CancellationToken cancellationToken) {
			public IReadOnlyList<ILSourceStatement> GetStatements(MethodDef method) {
				if (!method.HasBody)
					return Array.Empty<ILSourceStatement>();
				cancellationToken.ThrowIfCancellationRequested();
				var syntaxTree = decompiler.Decompile([ToEntityHandle(method)]);
				var output = new SpanTextOutput(_ => null);
				syntaxTree.AcceptVisitor(new CSharpOutputVisitor(new TextTokenWriter(output, settings), settings.CSharpFormattingOptions));
				var source = output.ToString();
				var methodToken = method.MDToken.Raw;
				var statements = decompiler.CreateSequencePoints(syntaxTree)
					.Where(pair => Workspace.GetBodyMethodToken(pair.Key) == methodToken)
					.SelectMany(pair => pair.Value)
					.Where(point => !point.IsHidden && point.EndOffset > point.Offset)
					.Select(point => new ILSourceStatement(point.Offset, point.EndOffset, ExtractSource(source, point.StartLine, point.StartColumn, point.EndLine, point.EndColumn)))
					.Where(statement => !string.IsNullOrWhiteSpace(statement.Text))
					.Distinct()
					.OrderBy(statement => statement.Offset)
					.ThenBy(statement => statement.EndOffset)
					.ToArray();
				if (statements.Length != 0)
					return statements;

				var fallback = source.Trim();
				return fallback.Length == 0
					? Array.Empty<ILSourceStatement>()
					: [new ILSourceStatement(0, int.MaxValue, fallback)];
			}

			static string ExtractSource(string source, int startLine, int startColumn, int endLine, int endColumn) {
				var lines = source.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n');
				if (startLine <= 0 || endLine < startLine || startLine > lines.Length)
					return string.Empty;
				endLine = Math.Min(endLine, lines.Length);
				var firstLine = startLine - 1;
				var lastLine = endLine - 1;
				var firstColumn = Math.Clamp(startColumn - 1, 0, lines[firstLine].Length);
				var lastColumn = Math.Clamp(endColumn - 1, 0, lines[lastLine].Length);
				if (firstLine == lastLine)
					return lines[firstLine][firstColumn..Math.Max(firstColumn, lastColumn)].Trim();

				var result = new List<string> { lines[firstLine][firstColumn..] };
				for (var line = firstLine + 1; line < lastLine; line++)
					result.Add(lines[line]);
				result.Add(lines[lastLine][..lastColumn]);
				return string.Join('\n', result).Trim();
			}
		}

		internal sealed class ModuleEntry(string path, ModuleDefMD module) {
			public string Id { get; set; } = string.Empty;
			public string Path { get; } = path;
			public ModuleDefMD Module { get; } = module;
			public long FileLength { get; } = new FileInfo(path).Length;
			public bool IsModified { get; set; }

			/// <summary>
			/// True for a module the debuggee loaded but the user never opened. It has no tree node, so
			/// the client can show a frame's file and line but cannot navigate to it.
			/// </summary>
			public bool IsExternal { get; init; }
		}

		/// <summary>
		sealed record NamespaceValue(string Name, IReadOnlyList<TypeDef> Types);
		sealed record ResourceEntryValue(string Name, object? Value, string TypeName);
		sealed record MetadataReference(DecompilerMetadataFile Metadata, System.Reflection.Metadata.Handle Handle);
		readonly record struct ILSourceStatement(int Offset, int EndOffset, string Text);
		sealed class NodeEntry(string id, string key, NodeKind kind, object value, ModuleEntry module) {
			public string Id { get; } = id;
			public string Key { get; } = key;
			public NodeKind Kind { get; } = kind;
			public object Value { get; set; } = value;
			public ModuleEntry Module { get; } = module;
		}

		sealed class EditTransaction(int baseVersion) {
			public string Id { get; } = Guid.NewGuid().ToString("N");
			public int BaseVersion { get; } = baseVersion;
			public List<EditOperation> Operations { get; } = [];

			public void Add(string nodeId, ModuleEntry module, Func<Action> apply) => Operations.Add(new EditOperation(nodeId, module, apply));
		}

		sealed record EditOperation(string NodeId, ModuleEntry Module, Func<Action> Apply);
		sealed record EditHistoryEntry(IReadOnlyList<EditOperation> Operations, IReadOnlyList<Action> UndoActions, string BeforeStateId, string AfterStateId);

		internal sealed class SpanTextOutput(Func<object, string?> resolveTarget) : ITextOutput {
			readonly StringBuilder builder = new();
			readonly List<TextSpanDto> spans = [];
			int indentation;
			int line = 1;
			int column = 1;
			bool needsIndentation = true;

			public string IndentationString { get; set; } = "\t";
			public IReadOnlyList<TextSpanDto> Spans => spans;
			public int Position => builder.Length;

			/// <summary>Where the next character will land. ILSpy reads this to label the syntax tree.</summary>
			public TextLocation Location => new(line, column);

			public void Indent() => indentation++;
			public void Unindent() => indentation = Math.Max(0, indentation - 1);
			public void Write(char ch) => Write(ch.ToString());
			public void Write(string text) {
				EnsureIndentation();
				Append(text);
			}
			public void WriteLine() {
				Append(Environment.NewLine);
				needsIndentation = true;
			}
			public void WriteReference(OpCodeInfo opCode, bool omitSuffix = false) => Write(omitSuffix ? opCode.Name ?? string.Empty : opCode.ToString() ?? string.Empty);
			public void WriteReference(DecompilerMetadataFile metadata, System.Reflection.Metadata.Handle handle, string text, string protocol = "decompile", bool isDefinition = false) =>
				WriteReferenceCore(new MetadataReference(metadata, handle), text, isDefinition);
			public void WriteReference(DecompilerIType type, string text, bool isDefinition = false) => WriteReferenceCore(type, text, isDefinition);
			public void WriteReference(DecompilerIMember member, string text, bool isDefinition = false) => WriteReferenceCore(member, text, isDefinition);
			public void WriteLocalReference(string text, object reference, bool isDefinition = false, bool isHoverOnly = false) => Write(text);
			public void MarkFoldStart(string collapsedText = "...", bool defaultCollapsed = false, bool isDefinition = false) { }
			public void MarkDefinitionStart() { }
			public void MarkFoldEnd() { }

			void WriteReferenceCore(object reference, string text, bool isDefinition) {
				EnsureIndentation();
				var start = builder.Length;
				Append(text);
				var target = resolveTarget(reference);
				if (target is not null && text.Length > 0)
					spans.Add(new TextSpanDto(start, text.Length, isDefinition ? "definition" : "reference", target));
			}

			// Every append goes through here so the line/column the syntax tree is labelled with stays in step
			// with the text the editor will show.
			void Append(string text) {
				for (var i = 0; i < text.Length; i++) {
					var ch = text[i];
					if (ch == '\r') {
						if (i + 1 < text.Length && text[i + 1] == '\n')
							i++;
					}
					else if (ch != '\n') {
						column++;
						continue;
					}
					line++;
					column = 1;
				}
				builder.Append(text);
			}

			void EnsureIndentation() {
				if (!needsIndentation)
					return;
				for (var i = 0; i < indentation; i++)
					Append(IndentationString);
				needsIndentation = false;
			}

			public override string ToString() => builder.ToString();
		}

		// ILSpy only writes line/column information into the syntax tree while a writer that reports its own
		// position (ILocatable) prints it; CreateSequencePoints has nothing to work with otherwise. The writer
		// that turns identifiers into the reference spans the editor navigates with — TextTokenWriter — is not
		// ILocatable, so this one reports the position of the output buffer instead of tracking its own.
		internal sealed class LocationTokenWriter(SpanTextOutput output, DecompilerSettings settings) : TextTokenWriter(output, settings), ILocatable {
			public TextLocation Location => output.Location;

			public int Length => output.Position;
		}

		enum NodeKind {
			Module,
			Namespace,
			ReferencesGroup,
			ResourcesGroup,
			AssemblyReference,
			Resource,
			ResourceEntry,
			Type,
			Method,
			Field,
			Property,
			Event,
		}

		static class ILFormatter {
			public static string Format(NodeEntry node, Func<MethodDef, IReadOnlyList<ILSourceStatement>>? sourceProvider = null) {
				var builder = new StringBuilder();
				switch (node.Value) {
					case ModuleDef module:
						builder.AppendLine($"// {module.Assembly?.FullName ?? module.Name.String}");
						builder.AppendLine($".module {module.Name}");
						foreach (var type in module.Types.Where(t => !t.IsGlobalModuleType))
							FormatTypeHeader(builder, type);
						break;
					case NamespaceValue ns:
						builder.AppendLine($"// namespace {ns.Name}");
						foreach (var type in ns.Types)
							FormatType(builder, type, sourceProvider);
						break;
					case TypeDef type:
						FormatType(builder, type, sourceProvider);
						break;
					case MethodDef method:
						FormatMethod(builder, method, sourceProvider: sourceProvider);
						break;
					case FieldDef field:
						builder.AppendLine($".field {field.Attributes} {field.FieldType.FullName} {field.Name}");
						break;
					case PropertyDef property:
						FormatProperty(builder, property, sourceProvider);
						break;
					case EventDef @event:
						FormatEvent(builder, @event, sourceProvider);
						break;
					case AssemblyRef reference:
						builder.AppendLine($".assembly extern {reference.Name}");
						builder.AppendLine("{");
						builder.AppendLine($"  .ver {reference.Version}");
						builder.AppendLine("}");
						break;
					case Resource resource:
						builder.AppendLine($".mresource {resource.Attributes} '{resource.Name}'");
						break;
					default:
						throw new RpcException(ErrorCodes.UnsupportedDocument, "This tree node has no IL representation.");
				}
				return builder.ToString();
			}

			static void FormatTypeHeader(StringBuilder builder, TypeDef type) => builder.AppendLine($".class {type.Attributes} {type.FullName}");

			static void FormatType(StringBuilder builder, TypeDef type, Func<MethodDef, IReadOnlyList<ILSourceStatement>>? sourceProvider) {
				FormatTypeHeader(builder, type);
				builder.AppendLine("{");
				foreach (var field in type.Fields)
					builder.AppendLine($"  .field {field.Attributes} {field.FieldType.FullName} {field.Name}");
				foreach (var method in type.Methods) {
					builder.AppendLine();
					FormatMethod(builder, method, "  ", sourceProvider);
				}
				builder.AppendLine("}");
			}

			static void FormatProperty(StringBuilder builder, PropertyDef property, Func<MethodDef, IReadOnlyList<ILSourceStatement>>? sourceProvider) {
				builder.AppendLine($".property {property.PropertySig?.RetType.FullName ?? "<unknown>"} {property.Name}");
				foreach (var method in new[] { property.GetMethod, property.SetMethod }.Concat(property.OtherMethods).OfType<MethodDef>().Distinct()) {
					builder.AppendLine();
					FormatMethod(builder, method, sourceProvider: sourceProvider);
				}
			}

			static void FormatEvent(StringBuilder builder, EventDef @event, Func<MethodDef, IReadOnlyList<ILSourceStatement>>? sourceProvider) {
				builder.AppendLine($".event {@event.EventType.FullName} {@event.Name}");
				foreach (var method in new[] { @event.AddMethod, @event.RemoveMethod, @event.InvokeMethod }.Concat(@event.OtherMethods).OfType<MethodDef>().Distinct()) {
					builder.AppendLine();
					FormatMethod(builder, method, sourceProvider: sourceProvider);
				}
			}

			static void FormatMethod(
				StringBuilder builder,
				MethodDef method,
				string indent = "",
				Func<MethodDef, IReadOnlyList<ILSourceStatement>>? sourceProvider = null) {
				builder.AppendLine($"{indent}.method {method.Attributes} {method.ReturnType.FullName} {method.Name}{FormatParameterList(method)}");
				builder.AppendLine($"{indent}{{");
				if (method.HasBody) {
					builder.AppendLine($"{indent}  .maxstack {method.Body.MaxStack}");
					if (method.Body.HasVariables) {
						builder.AppendLine($"{indent}  .locals {string.Join(", ", method.Body.Variables.Select(v => $"[{v.Index}] {v.Type.FullName}"))}");
					}
					var statements = sourceProvider?.Invoke(method) ?? Array.Empty<ILSourceStatement>();
					var statementIndex = 0;
					foreach (var instruction in method.Body.Instructions) {
						while (statementIndex < statements.Count && statements[statementIndex].Offset <= instruction.Offset) {
							if (instruction.Offset < statements[statementIndex].EndOffset)
								AppendSourceComment(builder, indent + "  ", statements[statementIndex].Text);
							statementIndex++;
						}
						builder.AppendLine($"{indent}  IL_{instruction.Offset:X4}: {instruction.OpCode.Name,-12} {FormatOperand(instruction.Operand)}".TrimEnd());
					}
				}
				builder.AppendLine($"{indent}}}");
			}

			static void AppendSourceComment(StringBuilder builder, string indent, string source) {
				builder.AppendLine();
				foreach (var line in source.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n'))
					builder.Append(indent).Append("// ").AppendLine(line.TrimEnd());
				builder.AppendLine();
			}

			static string FormatOperand(object? operand) => operand switch {
				null => string.Empty,
				string text => $"\"{text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal)}\"",
				Instruction instruction => $"IL_{instruction.Offset:X4}",
				IList<Instruction> instructions => string.Join(", ", instructions.Select(i => $"IL_{i.Offset:X4}")),
				IMemberRef member => member.FullName,
				IType type => type.FullName,
				Local local => $"V_{local.Index}",
				Parameter parameter => parameter.Name ?? $"A_{parameter.Index}",
				float value => value.ToString("R", CultureInfo.InvariantCulture),
				double value => value.ToString("R", CultureInfo.InvariantCulture),
				IFormattable value => value.ToString(null, CultureInfo.InvariantCulture),
				_ => operand.ToString() ?? string.Empty,
			};
		}
	}
}
