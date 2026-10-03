using System.Text.Json;
using System.Text.Json.Serialization;

namespace dnSpy.Backend.Contracts;

public static class ProtocolInfo {
	public const int Version = 1;
}

public static class RpcMethods {
	public const string Hello = "system/hello";
	public const string Shutdown = "system/shutdown";
	public const string Cancel = "system/cancel";
	public const string WorkspaceOpen = "workspace/open";
	public const string WorkspaceClose = "workspace/close";
	public const string TreeGetRoots = "tree/getRoots";
	public const string TreeGetChildren = "tree/getChildren";
	public const string TreeGetNode = "tree/getNode";
	public const string DocumentDecompile = "document/decompile";
	public const string DocumentFindMember = "document/findMember";
	public const string Search = "search/run";
	public const string AnalyzeReferences = "analyze/references";
	public const string HexGetLength = "hex/getLength";
	public const string HexReadRange = "hex/readRange";
	public const string ModuleGetInfo = "module/getInfo";
	public const string EditBegin = "edit/begin";
	public const string EditGetMethodBody = "edit/getMethodBody";
	public const string EditRename = "edit/rename";
	public const string EditReplaceMethodBody = "edit/replaceMethodBody";
	public const string EditReplaceResource = "edit/replaceResource";
	public const string EditCommit = "edit/commit";
	public const string EditRollback = "edit/rollback";
	public const string EditUndo = "edit/undo";
	public const string EditRedo = "edit/redo";
	public const string ModuleSaveAs = "module/saveAs";
	public const string DebugLaunch = "debug/launch";
	public const string DebugListProcesses = "debug/listProcesses";
	public const string DebugAttach = "debug/attach";
	public const string DebugRequest = "debug/request";
	public const string DebugDisconnect = "debug/disconnect";
	public const string DebugEvent = "debug/event";
	public const string ScriptEvaluate = "script/evaluate";
	public const string ScriptReset = "script/reset";
}

public static class ErrorCodes {
	public const int ParseError = -32700;
	public const int InvalidRequest = -32600;
	public const int MethodNotFound = -32601;
	public const int InvalidParams = -32602;
	public const int InternalError = -32603;
	public const int WorkspaceNotFound = 1001;
	public const int NodeNotFound = 1002;
	public const int FileNotFound = 1003;
	public const int UnsupportedDocument = 1004;
	public const int RequestCanceled = 1005;
	public const int RangeTooLarge = 1006;
	public const int EditConflict = 1007;
	public const int EditTransactionNotFound = 1008;
	public const int EditValidationFailed = 1009;
	public const int SaveFailed = 1010;
}

public sealed record HelloRequest(int ProtocolVersion, string ClientVersion, string Nonce);

public sealed record HelloResponse(
	int ProtocolVersion,
	string BackendVersion,
	string Nonce,
	string Platform,
	string Architecture,
	IReadOnlyDictionary<string, bool> Capabilities);

public sealed record OpenWorkspaceRequest(IReadOnlyList<string> Paths);

public sealed record OpenWorkspaceResponse(string WorkspaceId, IReadOnlyList<OpenedModule> Modules, string StateId);

public sealed record OpenedModule(string Id, string Name, string Path, bool HasPdb);

public sealed record WorkspaceRequest(string WorkspaceId);

public sealed record NodeRequest(string WorkspaceId, string NodeId);

public sealed record TreeNodesResponse(IReadOnlyList<TreeNodeDto> Nodes);

public sealed record TreeNodeDto(
	string Id,
	string Label,
	string Kind,
	bool HasChildren,
	string? Description = null,
	string? Icon = null);

public enum DecompilerLanguage {
	CSharp,
	VisualBasic,
	IL,
	ILWithCSharp,
}

public sealed record DecompileRequest(string WorkspaceId, string NodeId, DecompilerLanguage Language);

public sealed record TextSpanDto(int Start, int Length, string Kind, string? TargetNodeId = null);

/// <summary>
/// One sequence point of the decompiled text: the line(s) it covers and the IL range it maps to.
/// The IL range is what the in-process debug engine turns into an IL-offset breakpoint, so a
/// gutter click can select the statement under the cursor instead of only its owning method.
/// </summary>
/// <summary>
/// One statement of a decompiled body, in the IL terms a debug engine speaks. <paramref name="IlOffset"/>
/// is where the statement's own code starts, which is where a breakpoint on its line belongs;
/// <paramref name="SequencePointIlOffset"/> is the start of the point that tiles the IL there, which is
/// the offset the runtime is able to place a breakpoint on. They differ where the decompiler's own
/// statement begins inside code the sequence points charge to it.
/// </summary>
public sealed record CodeStatementDto(
	int StartLine,
	int EndLine,
	int StartColumn,
	int EndColumn,
	int IlOffset,
	int IlEndOffset,
	int SequencePointIlOffset,
	string ModulePath,
	int MetadataToken,
	int SourceMethodToken,
	string Description,
	bool IsHidden);

public sealed record DecompileResponse(
	string Title,
	string Language,
	string Text,
	IReadOnlyList<TextSpanDto> Spans,
	IReadOnlyList<DiagnosticDto> Diagnostics) {
	/// <summary>Per-statement IL mapping for languages whose decompiled text we can map (currently C# only).</summary>
	public IReadOnlyList<CodeStatementDto>? CodeStatements { get; init; }
}

public sealed record DiagnosticDto(string Severity, string Message, int? Start = null, int? Length = null);

/// <summary>
/// Looks a member up by the identity a client can keep across sessions. Node ids are handed out per
/// workspace and change on every open, so a persisted bookmark has to name its target by module path
/// and metadata token instead.
/// </summary>
public sealed record FindMemberRequest(string WorkspaceId, string ModulePath, int MetadataToken);

public sealed record FindMemberResponse(string? NodeId, string? Label, string? Description);

public sealed record SearchRequest(
	string WorkspaceId,
	string Query,
	IReadOnlyList<string>? Kinds = null,
	bool MatchCase = false,
	int MaxResults = 1000);

public sealed record SearchResponse(IReadOnlyList<SearchResultDto> Results, bool Truncated);

public sealed record SearchResultDto(
	string NodeId,
	string Kind,
	string Name,
	string Location,
	string? Preview = null);

public sealed record AnalyzeReferencesRequest(string WorkspaceId, string NodeId, int MaxResults = 1000);

public sealed record AnalyzeReferencesResponse(IReadOnlyList<ReferenceResultDto> Results, bool Truncated);

public sealed record ReferenceResultDto(string SourceNodeId, string SourceName, string Kind, string Location);

public sealed record HexLengthRequest(string WorkspaceId, string ModuleId);

public sealed record HexLengthResponse(long Length);

public sealed record HexReadRequest(string WorkspaceId, string ModuleId, long Offset, int Count);

public sealed record HexReadResponse(long Offset, string Base64Data, bool EndOfFile);

public sealed record ModuleInfoRequest(string WorkspaceId, string ModuleId);

public sealed record ModuleInfoResponse(
	string Name,
	string Path,
	string RuntimeVersion,
	string Architecture,
	string ModuleKind,
	Guid Mvid,
	string? EntryPoint,
	int TypeCount,
	int ResourceCount,
	IReadOnlyList<string> AssemblyReferences,
	IReadOnlyDictionary<string, string> PeHeaders,
	IReadOnlyDictionary<string, int> MetadataTables);

public sealed record BeginEditRequest(string WorkspaceId);

public sealed record BeginEditResponse(string TransactionId, int BaseVersion);

public sealed record RenameEditRequest(string WorkspaceId, string TransactionId, string NodeId, string NewName);

public sealed record IlInstructionDto(
	string Label,
	string OpCode,
	string? OperandKind = null,
	string? Operand = null,
	string? OperandDisplay = null);

public sealed record MethodBodyRequest(string WorkspaceId, string MethodNodeId);

public sealed record MethodBodyResponse(
	int MaxStack,
	bool InitLocals,
	IReadOnlyList<string> Locals,
	IReadOnlyList<IlInstructionDto> Instructions,
	bool HasExceptionHandlers);

public sealed record ReplaceMethodBodyRequest(
	string WorkspaceId,
	string TransactionId,
	string MethodNodeId,
	IReadOnlyList<IlInstructionDto> Instructions,
	int? MaxStack = null,
	bool? InitLocals = null,
	bool ClearExceptionHandlers = false);

public sealed record ReplaceResourceRequest(
	string WorkspaceId,
	string TransactionId,
	string ResourceNodeId,
	string Base64Data);

public sealed record EditTransactionRequest(string WorkspaceId, string TransactionId);

public sealed record EditCommitResponse(int Version, string StateId, IReadOnlyList<string> ChangedNodeIds, bool CanUndo, bool CanRedo);

public sealed record SaveModuleRequest(string WorkspaceId, string ModuleId, string DestinationPath, bool Overwrite = false);

public sealed record SaveModuleResponse(string Path, long Length, string Sha256);

public sealed record DebugLaunchRequest(
	string Program,
	IReadOnlyList<string>? Arguments = null,
	string? WorkingDirectory = null,
	bool StopAtEntry = false,
	IReadOnlyDictionary<string, string>? Environment = null,
	string? WorkspaceId = null);

public sealed record DebugProcessDto(int ProcessId, string Name, string? ExecutablePath);

public sealed record DebugModuleDto(string Id, string Name, string Path, string? Version = null, string? SymbolStatus = null);

public sealed record DebugAttachRequest(int ProcessId, string? WorkspaceId = null);

public sealed record DebugStartResponse(string SessionId, JsonElement Capabilities);

public sealed record DebugAdapterRequest(string SessionId, string Command, JsonElement? Arguments = null);

public sealed record DebugAdapterResponse(JsonElement? Body);

public sealed record DebugDisconnectRequest(string SessionId, bool TerminateDebuggee = false);

public sealed record DebugEventNotification(string SessionId, string Event, JsonElement? Body);

public sealed record ScriptEvaluateRequest(string Code);

/// <summary>
/// One line of the C# Interactive window. <paramref name="Kind"/> is one of the
/// <see cref="ScriptOutputEntry"/> constants and picks the colour the client paints it in.
/// </summary>
public sealed record ScriptOutputEntry(string Kind, string Text) {
	/// <summary>Something the script printed — <c>PrintLine</c>, or the script's own <c>Console</c>.</summary>
	public const string Output = "output";

	/// <summary>The value a submission evaluated to, formatted by the C# object formatter.</summary>
	public const string Result = "result";

	/// <summary>A compiler diagnostic or a runtime exception.</summary>
	public const string Error = "error";

	/// <summary>The engine banner shown when the session is built or rebuilt.</summary>
	public const string Banner = "banner";
}

public sealed record ScriptEvaluateResponse(IReadOnlyList<ScriptOutputEntry> Entries);

/// <summary>A breakpoint the client asked for, expressed in decompiled-source coordinates.</summary>
public sealed record BreakpointQuery(string Id, string NodeId, int Line, int? Column = null);

/// <summary>The IL identity of a breakpoint, after snapping the requested line to a sequence point.</summary>
public sealed record ResolvedBreakpoint(
	string Id,
	bool Bound,
	string? Reason,
	string? ModulePath,
	int? MetadataToken,
	int? SourceMethodToken,
	int? IlOffset,
	int? SequencePointIlOffset,
	int StartLine,
	int EndLine,
	int StartColumn,
	int EndColumn,
	string? Description);

public sealed record ResolveBreakpointsRequest(string WorkspaceId, IReadOnlyList<BreakpointQuery> Queries);

public sealed record ResolveBreakpointsResponse(IReadOnlyList<ResolvedBreakpoint> Breakpoints);

/// <summary>The decompiled line(s) a stopped IL location maps to, so the client can reveal it.</summary>
public sealed record ResolvedIlLocation(
	string? NodeId,
	string? Description,
	string ModulePath,
	int MetadataToken,
	int StartLine,
	int EndLine,
	int StartColumn,
	int EndColumn,
	int IlOffset,
	int IlEndOffset,
	bool IsHidden,
	bool IsExternalModule);

/// <summary>The IL identity of a method, used for method-level (function) breakpoints.</summary>
public sealed record MethodIlInfoResponse(
	string? NodeId,
	string Description,
	string ModulePath,
	int SourceMethodToken,
	int BodyMetadataToken,
	int FirstIlOffset,
	int CodeSize,
	bool HasBody);

/// <summary>
/// One local or argument of a method body, named the way the decompiler prints it. Debuggees without
/// a PDB carry no names at all, so the engine matches these by slot instead of by symbol.
/// </summary>
/// <param name="Index">
/// The index the engine uses: a local slot for a local, an argument index for an argument — where 0
/// is the first argument and, in an instance method, <c>this</c>.
/// </param>
public sealed record DebugVariableNameDto(string Name, string TypeName, int Index, bool IsArgument);

/// <summary>An IL location a step can land on, spelled the way the engine arms a breakpoint.</summary>
public sealed record SteppingTarget(string ModulePath, int MetadataToken, int IlOffset);

/// <summary>
/// Where a step out of a given location can land: the statements of the body it is in, and — for a
/// step into — the statements of each method the location calls. Stepping is driven by breakpoints on
/// these locations rather than by stepping one IL instruction at a time, because without symbols the
/// runtime stops inside statements rather than between them.
/// </summary>
/// <param name="Targets">
/// Every statement a step may land on, whether it is ahead of the location in IL or behind it: the
/// runtime reports the one the thread reaches first, which is the only order a loop obeys.
/// </param>
/// <param name="LeavesMethod">
/// Set when no statement of the body can run again before the method returns, so the step has to
/// leave it — the statements a caller resumes at are not the ones a body maps to.
/// </param>
public sealed record SteppingTargetsResponse(IReadOnlyList<SteppingTarget> Targets, bool LeavesMethod = false);

/// <summary>
/// Bridges the debug engine to the decompiler: the engine speaks IL offsets and metadata tokens,
/// the client speaks tree node IDs and decompiled line numbers.
/// </summary>
public interface IDebugSymbolResolver {
	/// <summary>Snaps requested source lines to the sequence point that owns them.</summary>
	Task<ResolveBreakpointsResponse> ResolveBreakpointsAsync(string workspaceId, IReadOnlyList<BreakpointQuery> queries, CancellationToken cancellationToken);

	/// <summary>Maps a stopped <c>(module, token, IL offset)</c> back to decompiled coordinates for highlighting.</summary>
	Task<ResolvedIlLocation?> ResolveIlLocationAsync(string? workspaceId, string modulePath, int metadataToken, int ilOffset, CancellationToken cancellationToken);

	/// <summary>Returns the IL identity of a method when the module is known.</summary>
	Task<MethodIlInfoResponse?> GetMethodIlInfoAsync(string workspaceId, string modulePath, int metadataToken, CancellationToken cancellationToken);

	/// <summary>Finds methods by decompiled name, for method-level (function) breakpoints.</summary>
	Task<IReadOnlyList<MethodIlInfoResponse>> FindMethodsAsync(string? workspaceId, string name, CancellationToken cancellationToken);

	/// <summary>The local and argument names of a method body, so a value can be shown by name.</summary>
	Task<IReadOnlyList<DebugVariableNameDto>> GetVariableNamesAsync(string? workspaceId, string modulePath, int metadataToken, CancellationToken cancellationToken);

	/// <summary>
	/// The sequence points a step from <paramref name="ilOffset"/> can land on, plus the methods that
	/// location calls when <paramref name="stepInto"/> is set. Returns <c>null</c> when the location
	/// cannot be mapped, in which case the engine falls back to asking the runtime to step.
	/// </summary>
	Task<SteppingTargetsResponse?> GetSteppingTargetsAsync(string? workspaceId, string modulePath, int metadataToken, int ilOffset, bool stepInto, CancellationToken cancellationToken);

	/// <summary>
	/// True when a module is one of the workspace's own — code the user opened. Frames elsewhere are
	/// named from their metadata, and their decompiled line is never looked up.
	/// </summary>
	Task<bool> IsWorkspaceModuleAsync(string? workspaceId, string modulePath, CancellationToken cancellationToken);
}

public sealed class RpcRequest {
	[JsonPropertyName("jsonrpc")]
	public string JsonRpc { get; init; } = "2.0";

	[JsonPropertyName("id")]
	public JsonElement? Id { get; init; }

	[JsonPropertyName("method")]
	public string Method { get; init; } = string.Empty;

	[JsonPropertyName("params")]
	public JsonElement? Params { get; init; }
}

public sealed record RpcError(int Code, string Message, object? Data = null);

public sealed class RpcResponse {
	[JsonPropertyName("jsonrpc")]
	public string JsonRpc { get; init; } = "2.0";

	[JsonPropertyName("id")]
	public JsonElement? Id { get; init; }

	[JsonPropertyName("result")]
	[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
	public object? Result { get; init; }

	[JsonPropertyName("error")]
	[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
	public RpcError? Error { get; init; }
}

public sealed class RpcException : Exception {
	public RpcException(int code, string message, object? data = null, Exception? innerException = null)
		: base(message, innerException) {
		Code = code;
		DataValue = data;
	}

	public int Code { get; }
	public object? DataValue { get; }
}
