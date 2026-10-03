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
	public const string EditDelete = "edit/delete";
	public const string EditSetNamespace = "edit/setNamespace";
	public const string EditReplaceMethodBody = "edit/replaceMethodBody";
	public const string EditReplaceMethodBodyWithStub = "edit/replaceMethodBodyWithStub";
	public const string EditReplaceResource = "edit/replaceResource";
	public const string EditGetOptions = "edit/getOptions";
	public const string EditCreate = "edit/create";
	public const string EditSetOptions = "edit/setOptions";
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

/// <summary>Removes one node from its owner: a type, a member, a resource, or every type of a namespace.</summary>
public sealed record DeleteEditRequest(string WorkspaceId, string TransactionId, string NodeId);

/// <summary>
/// Moves every top-level type of a namespace node to <paramref name="NewName"/>. An empty name is dnSpy's
/// "Move Types to Empty Namespace"; any other name is "Rename Namespace".
/// </summary>
public sealed record SetNamespaceEditRequest(string WorkspaceId, string TransactionId, string NodeId, string NewName);

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

/// <summary>
/// Replaces a method body with dnSpy's generated stub. The body is built from the method's own
/// signature — a base-constructor call, defaults for <c>out</c> parameters and the return value — so
/// it cannot be expressed as a fixed instruction list the client sends.
/// </summary>
public sealed record ReplaceMethodBodyWithStubRequest(string WorkspaceId, string TransactionId, string MethodNodeId);

public sealed record ReplaceResourceRequest(
	string WorkspaceId,
	string TransactionId,
	string ResourceNodeId,
	string Base64Data);

public sealed record EditTransactionRequest(string WorkspaceId, string TransactionId);

public sealed record EditCommitResponse(int Version, string StateId, IReadOnlyList<string> ChangedNodeIds, bool CanUndo, bool CanRedo);

public sealed record SaveModuleRequest(string WorkspaceId, string ModuleId, string DestinationPath, bool Overwrite = false);

// ---------------------------------------------------------------------------------------------
// AsmEditor option DTOs.
//
// These mirror dnSpy's `*Options` classes (Extensions/dnSpy.AsmEditor/{Types,Method,Field,Property,
// Event}/*DefOptions.cs) field for field, so each codec can be read against the WPF original. Two
// conventions run through all of them:
//
//  * Enum-valued fields travel as the raw dnlib integer. The WPF dialogs render them from named-flag
//    lists built off the enums, and this port does the same, so neither side has to agree on the
//    casing of an enum member's name.
//  * `Display` fields are filled in by the backend. They are what the dialogs show in read-only
//    previews and list rows — the same strings WPF's `FullName`-style properties produce — so the
//    client never formats a type or a signature itself.
// ---------------------------------------------------------------------------------------------

/// <summary>
/// A type as it is written into metadata: the assembly that declares it, its namespace, and its name.
/// An empty <paramref name="Scope"/> means "this module"; the codecs resolve that against the module
/// being edited before falling back to a reference.
/// </summary>
/// <remarks>
/// <paramref name="NodeId"/> is set when the type was picked out of the assembly explorer, and is what
/// the codecs try first: it names a type the workspace has already resolved, including one that lives in
/// a referenced assembly and would be expensive — or impossible — to look up by name. The three name
/// fields are the fallback and are always filled in, so the name alone is enough to rebuild the type.
/// </remarks>
public sealed record TypeRefDto(
	string Scope,
	string Namespace,
	string Name,
	string? NodeId = null);

/// <summary>
/// A method used by something other than itself — a property or event accessor. A node id names the row
/// the user picked and is preferred; the token is what the model itself can always answer with, which is
/// what lets a value the server produced be read back without asking the workspace again. A method that
/// has neither — one created by this very transaction and never assigned a row — is matched by name,
/// which two methods of one type can share, so it is only the last resort.
/// </summary>
public sealed record AccessorRefDto(
	string Name,
	uint Token = 0,
	string? NodeId = null,
	string Display = "");

public static class TypeSigKinds {
	public const string Type = "type";
	public const string GenericInst = "genericInst";
	public const string SzArray = "szarray";
	public const string Array = "array";
	public const string Pointer = "ptr";
	public const string ByRef = "byref";
	public const string Pinned = "pinned";
	public const string CModReqd = "cmodreqd";
	public const string CModOpt = "cmodopt";
	public const string GenericVar = "genericvar";
	public const string GenericMVar = "genericmvar";
	public const string FnPtr = "fnptr";

	/// <summary>
	/// A slot a dialog has opened but not filled — a generic argument the user has not picked a type for
	/// yet. Nothing produces one when reading, and one that is written back is rejected rather than
	/// written: dnSpy's creator likewise refuses to hand over an array of type signatures that is short
	/// of the count it asked for.
	/// </summary>
	public const string Empty = "empty";
}

/// <summary>
/// One node of a type signature, covering everything dnSpy's <c>TypeSigCreator</c> can build. The
/// wrapper kinds — <c>szarray</c>, <c>ptr</c>, <c>byref</c>, <c>pinned</c>, <c>array</c> — carry the
/// type they wrap in <paramref name="Element"/>; the two custom-modifier kinds put the modifier in
/// <paramref name="Modifier"/> and the type it modifies in <paramref name="Element"/>, which is the
/// order dnlib's <c>CModOptSig</c>/<c>CModReqdSig</c> take them in.
/// </summary>
/// <param name="ValueType">
/// Whether the type is a value type. A signature that was read says so; a dialog that has nothing but a
/// name to go on leaves it unset, and the type's own definition decides. Unset is not the same as false,
/// which is why this is not a plain <see cref="bool"/>.
/// </param>
public sealed record TypeSigDto(
	string Kind,
	TypeRefDto? Type = null,
	bool? ValueType = null,
	TypeSigDto? Element = null,
	TypeSigDto? Modifier = null,
	IReadOnlyList<TypeSigDto>? Arguments = null,
	int Rank = 0,
	IReadOnlyList<int>? Sizes = null,
	IReadOnlyList<int>? LowerBounds = null,
	int GenericParameterNumber = 0,
	MethodSigDto? FunctionPointer = null,
	string Display = "");

/// <summary>
/// A method signature. <paramref name="CallingConvention"/> is dnlib's <c>CallingConvention</c> as a
/// raw value: the low nibble is the calling convention and bits 4-6 carry Generic/HasThis/ExplicitThis,
/// which is exactly how <c>MethodSigCreatorVM</c> models it.
/// </summary>
public sealed record MethodSigDto(
	int CallingConvention,
	TypeSigDto ReturnType,
	IReadOnlyList<TypeSigDto> Parameters,
	IReadOnlyList<TypeSigDto>? VarArgParameters = null,
	int GenericParameterCount = 0,
	string Display = "");

/// <summary>A property signature: dnlib's <c>PropertySig</c>, whose return type is the property's type.</summary>
public sealed record PropertySigDto(
	bool HasThis,
	TypeSigDto PropertyType,
	IReadOnlyList<TypeSigDto> Parameters,
	string Display = "");

/// <summary>A call target: the declaring type, the name, and the signature, which together identify it.</summary>
public sealed record MethodRefDto(
	TypeSigDto DeclaringType,
	string Name,
	MethodSigDto Signature,
	string Display = "");

public static class CaValueKinds {
	public const string Null = "null";
	public const string Primitive = "primitive";
	public const string String = "string";
	public const string Type = "type";
	public const string Array = "array";
	public const string Struct = "struct";
}

/// <summary>
/// A custom-attribute argument value. dnlib types the value by the argument's own <c>Type</c>, so a
/// primitive only has to carry its digits — <paramref name="Primitive"/> holds them as invariant
/// text, which keeps every numeric width intact through JSON.
/// </summary>
/// <param name="ElementType">
/// For a <see cref="CaValueKinds.Primitive"/> value, dnlib's <c>ElementType</c> of the boxed value
/// itself. An enum argument is declared as the enum but holds a primitive, and a boxed one is declared
/// as <c>System.Object</c> and holds whatever was boxed, so the declared type alone does not say how to
/// read the digits back.
/// </param>
public sealed record CaValueDto(
	string Kind,
	string? Primitive = null,
	string? Text = null,
	TypeSigDto? ReferencedType = null,
	IReadOnlyList<CaArgumentDto>? Elements = null,
	int ElementType = 0);

public sealed record CaArgumentDto(TypeSigDto Type, CaValueDto Value);

public sealed record CaNamedArgumentDto(bool IsField, string Name, CaArgumentDto Argument);

/// <summary>
/// A custom attribute. The constructor's signature decides how many constructor arguments there are
/// and what type each one is — dnSpy's <c>CustomAttributeVM</c> rebuilds that list whenever the
/// constructor changes — so only the values are carried.
/// </summary>
public sealed record CustomAttributeDto(
	MethodRefDto Constructor,
	IReadOnlyList<CaArgumentDto> ConstructorArguments,
	IReadOnlyList<CaNamedArgumentDto> NamedArguments,
	string Display = "");

/// <summary>A Constant row. <paramref name="ElementType"/> is dnlib's <c>ElementType</c> as an int.</summary>
public sealed record ConstantDto(int ElementType, string? Value, string Display = "");

public sealed record GenericParamConstraintDto(
	TypeSigDto Constraint,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	string Display = "");

public sealed record GenericParamDto(
	int Number,
	int Flags,
	string Name,
	TypeSigDto? Kind,
	IReadOnlyList<GenericParamConstraintDto> Constraints,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	string Display = "");

/// <summary>
/// A security attribute as a <c>DeclSecurity</c> row stores it. Unlike a custom attribute it has no
/// constructor: the type is the attribute itself and every value is a named field or property.
/// </summary>
public sealed record SecurityAttributeDto(
	TypeSigDto AttributeType,
	IReadOnlyList<CaNamedArgumentDto> NamedArguments,
	string Display = "");

/// <summary>A DeclSecurity row: the action plus either the parsed attributes or the raw .NET 1.x XML.</summary>
public sealed record DeclSecurityDto(
	int Action,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	IReadOnlyList<SecurityAttributeDto> SecurityAttributes,
	string? V1XmlString = null,
	string Display = "");

public sealed record ImplMapDto(
	int Attributes,
	string Name,
	string? ModuleName,
	string Display = "");

/// <summary>
/// A MarshalType. <paramref name="NativeType"/> is dnlib's <c>NativeType</c> and picks which of the
/// payload fields apply — the same eight cases <c>MarshalTypeVM</c> switches over. A null
/// <paramref name="Size"/>, <paramref name="ParamNumber"/>, <paramref name="NumberOfElements"/>,
/// <paramref name="Flags"/>, <paramref name="IidParamIndex"/> or <paramref name="VariantType"/> is the
/// field's own "not present" state, which dnlib reports through the matching <c>Is…Valid</c> property.
/// </summary>
public sealed record MarshalTypeDto(
	int NativeType,
	string? RawData = null,
	int? Size = null,
	int? VariantType = null,
	TypeSigDto? UserDefinedSubType = null,
	int? ElementType = null,
	int? ParamNumber = null,
	int? NumberOfElements = null,
	int? Flags = null,
	string? Guid = null,
	string? NativeTypeName = null,
	TypeSigDto? CustomMarshaler = null,
	string? Cookie = null,
	int? IidParamIndex = null,
	string Display = "");

/// <summary>
/// A <c>MethodImpl</c> row. The body may be left out: a dialog that adds one only knows which method is
/// being overridden, and the row's body is by construction the method being edited.
/// </summary>
public sealed record MethodOverrideDto(
	MethodRefDto? MethodBody,
	MethodRefDto MethodDeclaration,
	string Display = "");

public sealed record ParamDefDto(
	string Name,
	int Sequence,
	int Attributes,
	ConstantDto? Constant,
	MarshalTypeDto? MarshalType,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	string Display = "");

public sealed record TypeDefOrRefAndCaDto(
	TypeSigDto TypeDefOrRef,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	string Display = "");

public static class NodeOptionKinds {
	public const string Type = "type";
	public const string Method = "method";
	public const string Field = "field";
	public const string Property = "property";
	public const string Event = "event";
}

public sealed record TypeOptionsDto(
	int Attributes,
	string Namespace,
	string Name,
	uint? PackingSize,
	uint? ClassSize,
	TypeSigDto? BaseType,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	IReadOnlyList<DeclSecurityDto> DeclSecurities,
	IReadOnlyList<GenericParamDto> GenericParameters,
	IReadOnlyList<TypeDefOrRefAndCaDto> Interfaces,
	// How many generic parameters the type has itself. No page edits it; it is read-only context the base
	// type's editor gates its Var button on — dnSpy hands the type being edited over as the signature
	// creator's OwnerType — and it is absent while creating one, where dnSpy hands over nothing and every
	// Var is allowed.
	int? TypeGenericParameterCount = null,
	// The simple name of the module's corlib, which is the scope a base type carries when it comes from
	// there. dnSpy's Kind combo reads the base type back to tell a class from a struct, an enum and a
	// delegate, and it asks whether that type's assembly is the corlib as it does so: a type that merely
	// happens to be called System.Object is a plain class, not a static one. The dialog cannot ask that
	// on its own, so the answer travels with the model.
	string? CorLibScope = null);

public sealed record MethodOptionsDto(
	int ImplAttributes,
	int Attributes,
	int SemanticsAttributes,
	string Name,
	MethodSigDto? MethodSig,
	ImplMapDto? ImplMap,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	IReadOnlyList<DeclSecurityDto> DeclSecurities,
	IReadOnlyList<ParamDefDto> ParamDefs,
	IReadOnlyList<GenericParamDto> GenericParameters,
	IReadOnlyList<MethodOverrideDto> Overrides,
	uint Rva = 0,
	// How many generic parameters the declaring type has. No page edits it; it is read-only context the
	// signature editor needs, and dnSpy takes it from the live type rather than from its options class.
	int OwnerGenericParameterCount = 0);

public sealed record FieldOptionsDto(
	int Attributes,
	string Name,
	TypeSigDto? FieldSig,
	uint? FieldOffset,
	MarshalTypeDto? MarshalType,
	string? InitialValue,
	ImplMapDto? ImplMap,
	ConstantDto? Constant,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	uint Rva = 0,
	// How many generic parameters the declaring type has. Read-only context for the signature editor, and
	// read off the live type the way the method dialog's copy of it is.
	int OwnerGenericParameterCount = 0);

public sealed record PropertyOptionsDto(
	int Attributes,
	string Name,
	PropertySigDto? PropertySig,
	ConstantDto? Constant,
	IReadOnlyList<AccessorRefDto> GetMethods,
	IReadOnlyList<AccessorRefDto> SetMethods,
	IReadOnlyList<AccessorRefDto> OtherMethods,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	// How many generic parameters the declaring type has. Read-only context for the signature editor, and
	// read off the live type the way the method and field dialogs' copies of it are.
	int OwnerGenericParameterCount = 0);

public sealed record EventOptionsDto(
	int Attributes,
	string Name,
	TypeSigDto? EventType,
	AccessorRefDto? AddMethod,
	AccessorRefDto? InvokeMethod,
	AccessorRefDto? RemoveMethod,
	IReadOnlyList<AccessorRefDto> OtherMethods,
	IReadOnlyList<CustomAttributeDto> CustomAttributes,
	// How many generic parameters the declaring type has, read off the live type the way the method and
	// field dialogs' copies of it are: the event type's editor gates its Var button on it.
	int OwnerGenericParameterCount = 0);

/// <summary>
/// Every dialog's model, discriminated by <paramref name="Kind"/>. Only the member matching the kind
/// is set; the others are null.
/// </summary>
public sealed record NodeOptionsDto(
	string Kind,
	TypeOptionsDto? Type = null,
	MethodOptionsDto? Method = null,
	FieldOptionsDto? Field = null,
	PropertyOptionsDto? Property = null,
	EventOptionsDto? Event = null)
{
	public static NodeOptionsDto OfType(TypeOptionsDto options) => new(NodeOptionKinds.Type, Type: options);
	public static NodeOptionsDto OfMethod(MethodOptionsDto options) => new(NodeOptionKinds.Method, Method: options);
	public static NodeOptionsDto OfField(FieldOptionsDto options) => new(NodeOptionKinds.Field, Field: options);
	public static NodeOptionsDto OfProperty(PropertyOptionsDto options) => new(NodeOptionKinds.Property, Property: options);
	public static NodeOptionsDto OfEvent(EventOptionsDto options) => new(NodeOptionKinds.Event, Event: options);
}

public sealed record GetNodeOptionsRequest(
	string WorkspaceId,
	string Kind,
	string? NodeId = null,
	string? OwnerNodeId = null,
	bool IsNew = false,
	// Whether the type is being created inside another one, which only the type kind reads. dnSpy has a
	// command for each: Create Type puts a type at the top level whatever is selected, while Create Nested
	// Type puts it in the selected type — or in the type the selected member belongs to — and gives it no
	// namespace of its own.
	bool Nested = false);

public sealed record CreateNodeRequest(
	string WorkspaceId,
	string TransactionId,
	string OwnerNodeId,
	NodeOptionsDto Options,
	// The same flag the dialog was opened with: it is what says which list the new type joins.
	bool Nested = false);

public sealed record SetNodeOptionsRequest(
	string WorkspaceId,
	string TransactionId,
	string NodeId,
	NodeOptionsDto Options);

/// <summary>
/// The node a create- or edit-command was queued for, and the name it will have. Sent back by the
/// queue calls so the client can reveal the node it just created once the commit lands.
/// </summary>
public sealed record EditNodeResponse(string NodeId, string Label, string Kind);

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
