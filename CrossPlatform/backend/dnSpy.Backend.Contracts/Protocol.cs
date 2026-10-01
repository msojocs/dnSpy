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
}

public sealed record DecompileRequest(string WorkspaceId, string NodeId, DecompilerLanguage Language);

public sealed record TextSpanDto(int Start, int Length, string Kind, string? TargetNodeId = null);

public sealed record DecompileResponse(
	string Title,
	string Language,
	string Text,
	IReadOnlyList<TextSpanDto> Spans,
	IReadOnlyList<DiagnosticDto> Diagnostics);

public sealed record DiagnosticDto(string Severity, string Message, int? Start = null, int? Length = null);

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
	IReadOnlyDictionary<string, string>? Environment = null);

public sealed record DebugProcessDto(int ProcessId, string Name, string? ExecutablePath);

public sealed record DebugModuleDto(string Id, string Name, string Path, string? Version = null, string? SymbolStatus = null);

public sealed record DebugAttachRequest(int ProcessId);

public sealed record DebugStartResponse(string SessionId, JsonElement Capabilities);

public sealed record DebugAdapterRequest(string SessionId, string Command, JsonElement? Arguments = null);

public sealed record DebugAdapterResponse(JsonElement? Body);

public sealed record DebugDisconnectRequest(string SessionId, bool TerminateDebuggee = false);

public sealed record DebugEventNotification(string SessionId, string Event, JsonElement? Body);

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
