export const protocolVersion = 1

export interface HelloResponse {
  protocolVersion: number
  backendVersion: string
  nonce: string
  platform: string
  architecture: string
  capabilities: Record<string, boolean>
}

export interface OpenedModule {
  id: string
  name: string
  path: string
  hasPdb: boolean
}

export interface OpenWorkspaceResponse {
  workspaceId: string
  modules: OpenedModule[]
  stateId: string
}

export interface TreeNode {
  id: string
  label: string
  kind: string
  hasChildren: boolean
  description?: string
  icon?: string
}

export interface TreeNodesResponse {
  nodes: TreeNode[]
}

export type DecompilerLanguage = 'cSharp' | 'visualBasic' | 'il' | 'ilWithCSharp'

export interface TextSpan {
  start: number
  length: number
  kind: string
  targetNodeId?: string
}

export interface Diagnostic {
  severity: string
  message: string
  start?: number
  length?: number
}

/**
 * One sequence point of a decompiled document: the line(s) it covers and the IL range it maps to.
 * The IL range is what the in-process debug engine turns into an IL-offset breakpoint, so a gutter
 * click can pick the statement under the cursor instead of only its owning method.
 */
export interface CodeStatement {
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  ilOffset: number
  ilEndOffset: number
  /**
   * The start of the sequence point tiling the IL at `ilOffset`. The runtime only accepts a
   * breakpoint on a point boundary, so this is where the engine falls back to when the statement's
   * own start is refused — the two differ inside a state machine's field store, say.
   */
  sequencePointIlOffset: number
  modulePath: string
  metadataToken: number
  sourceMethodToken: number
  description: string
  isHidden: boolean
}

export interface DecompileResponse {
  title: string
  language: string
  text: string
  spans: TextSpan[]
  diagnostics: Diagnostic[]
  codeStatements?: CodeStatement[]
}

/**
 * A member looked up by the identity a bookmark keeps across sessions: node ids are handed out per
 * workspace, so a restored bookmark names its target by module path and metadata token instead.
 * Every field is null when the module is not open in the current workspace or the token no longer
 * resolves.
 */
export interface FindMemberResponse {
  nodeId?: string
  label?: string
  description?: string
}

export interface SearchResult {
  nodeId: string
  kind: string
  name: string
  location: string
  preview?: string
}

export interface SearchResponse {
  results: SearchResult[]
  truncated: boolean
}

export interface ReferenceResult {
  sourceNodeId: string
  sourceName: string
  kind: string
  location: string
}

export interface AnalyzeReferencesResponse {
  results: ReferenceResult[]
  truncated: boolean
}

export interface HexLengthResponse {
  length: number
}

export interface HexReadResponse {
  offset: number
  base64Data: string
  endOfFile: boolean
}

export interface ModuleInfoResponse {
  name: string
  path: string
  runtimeVersion: string
  architecture: string
  moduleKind: string
  mvid: string
  entryPoint?: string
  typeCount: number
  resourceCount: number
  assemblyReferences: string[]
  peHeaders: Record<string, string>
  metadataTables: Record<string, number>
}

export interface BeginEditResponse {
  transactionId: string
  baseVersion: number
}

export interface IlInstruction {
  label: string
  opCode: string
  operandKind?: string
  operand?: string
  operandDisplay?: string
}

export interface MethodBodyResponse {
  maxStack: number
  initLocals: boolean
  locals: string[]
  instructions: IlInstruction[]
  hasExceptionHandlers: boolean
}

export interface EditCommitResponse {
  version: number
  stateId: string
  changedNodeIds: string[]
  canUndo: boolean
  canRedo: boolean
}

export interface SaveModuleResponse {
  path: string
  length: number
  sha256: string
}

export interface BackendStatus {
  state: 'starting' | 'ready' | 'stopped' | 'error'
  message?: string
  capabilities?: Record<string, boolean>
}

// ---------------------------------------------------------------------------------------------
// The create/edit dialogs' models.
//
// These mirror the backend's DTO records (backend/dnSpy.Backend.Contracts/Protocol.cs) field for
// field, so a dialog can be read against the WPF options class it was ported from. Only what the
// port reads so far is declared — the member models arrive with their dialogs — and an interface
// that is a subset of what travels is safe here, because these values only ever come off the wire.
// ---------------------------------------------------------------------------------------------

/** A type as it is written into metadata: the assembly that declares it, then its namespace and name.
 * A nested type's name is its path from the outermost declaring type, written with `/`. */
export interface TypeRefDto {
  scope: string
  namespace: string
  name: string
  /** The explorer node it was picked from, which is what the backend resolves first. */
  nodeId?: string
}

export type TypeSigKind =
  | 'type' | 'genericInst' | 'szarray' | 'array' | 'ptr' | 'byref' | 'pinned'
  | 'cmodreqd' | 'cmodopt' | 'genericvar' | 'genericmvar' | 'fnptr' | 'empty'

/**
 * One node of a type signature. The wrapper kinds — `szarray`, `ptr`, `byref`, `pinned`, `array` —
 * carry the type they wrap in `element`; the two custom-modifier kinds put the modifier in `modifier`
 * and the type it modifies in `element`, which is the order dnlib's `CModReqdSig`/`CModOptSig` take.
 * `empty` is a slot a dialog has opened and not filled yet, which nothing writes.
 */
export interface TypeSigDto {
  kind: TypeSigKind
  type?: TypeRefDto
  /** Whether the type is a value type, when the DTO knows; unset leaves it to the definition. */
  valueType?: boolean
  element?: TypeSigDto
  modifier?: TypeSigDto
  arguments?: TypeSigDto[]
  rank?: number
  sizes?: number[]
  lowerBounds?: number[]
  genericParameterNumber?: number
  functionPointer?: MethodSigDto
  /** How the backend renders this signature. Kept for round-tripping; the editor shows its own text. */
  display?: string
}

/** `callingConvention` is dnlib's raw value: the low nibble is the convention and bits 4-6 carry
 * Generic/HasThis/ExplicitThis, which is exactly how dnSpy's method-signature dialog models it. */
export interface MethodSigDto {
  callingConvention: number
  returnType: TypeSigDto
  parameters: TypeSigDto[]
  varArgParameters?: TypeSigDto[]
  genericParameterCount?: number
  display?: string
}

export interface GenericParamDto {
  number: number
  flags: number
  name: string
  display?: string
}

/** A type's dialog model. Only the generic parameters are read so far — they say how many arguments
 * an instance of the type takes. The attributes, base type, interfaces, custom attributes and
 * security declarations travel with it too and are declared with the type dialog. */
export interface TypeOptionsDto {
  namespace: string
  name: string
  genericParameters: GenericParamDto[]
}

/** What a create or edit dialog opens with, for the kind it was opened for. */
export interface NodeOptionsResponse {
  kind: string
  type?: TypeOptionsDto
}

export interface DebugProcess {
  processId: number
  name: string
  executablePath?: string
}

export interface DebugStartResponse {
  sessionId: string
  capabilities: Record<string, unknown>
}

export interface DebugThread {
  id: number
  name: string
}

export interface DebugSource {
  name?: string
  path?: string
  sourceReference?: number
}

export interface DebugStackFrame {
  id: number
  name: string
  line: number
  column: number
  source?: DebugSource
  /** The tree node the frame's location decompiles to, when the module is in the workspace. */
  nodeId?: string
}

/** A breakpoint the client asked for, before or after the engine snapped it to a sequence point. */
export interface DebugBreakpointRequest {
  id: string
  nodeId: string
  line: number
  column?: number
  enabled: boolean
}

/** The engine's answer: where the breakpoint really is, and whether it is armed. */
export interface DebugBreakpoint {
  id: string
  verified: boolean
  state: 'bound' | 'pending' | 'unbound'
  line: number
  endLine: number
  column: number
  message?: string
  modulePath?: string
  metadataToken: number
  ilOffset: number
  description?: string
  enabled: boolean
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type?: string
  variablesReference: number
  evaluateName?: string
}

export interface DebugModule {
  id: number | string
  name: string
  path?: string
  version?: string
  symbolStatus?: string
}

export interface DebugEvent {
  sessionId: string
  event: string
  body?: Record<string, unknown>
}

/**
 * Start parameters collected by the "Debug Program" dialog. Mirrors the CoreCLR page of the
 * upstream `DebugProgramDlg` (executable, arguments, working directory, environment, break-at);
 * the backend's `DebugLaunchRequest` accepts every field.
 */
export interface DebugLaunchOptions {
  program: string
  arguments?: string[]
  workingDirectory?: string
  environment?: Record<string, string>
  /** `true` arms a breakpoint on the entry point, matching `PredefinedBreakKinds.EntryPoint`. */
  stopAtEntry?: boolean
  workspaceId?: string
}

/**
 * One line of the C# Interactive log. Mirrors the backend's `ScriptOutputEntry`; `echo` and `help`
 * are the kinds the window itself produces, the rest come from the host.
 */
export type ScriptOutputKind = 'output' | 'result' | 'error' | 'banner' | 'echo' | 'help'

export interface ScriptOutputEntry {
  kind: ScriptOutputKind
  text: string
}

export interface ScriptEvaluateResponse {
  entries: ScriptOutputEntry[]
}

export type UiLocale = 'en' | 'zh-CN'

export interface DnSpyApi {
  openAssemblies(): Promise<string[]>
  openWorkspace(paths: string[]): Promise<OpenWorkspaceResponse>
  closeWorkspace(workspaceId: string): Promise<void>
  getRoots(workspaceId: string): Promise<TreeNodesResponse>
  getChildren(workspaceId: string, nodeId: string): Promise<TreeNodesResponse>
  getNode(workspaceId: string, nodeId: string): Promise<TreeNode>
  decompile(workspaceId: string, nodeId: string, language: DecompilerLanguage): Promise<DecompileResponse>
  /** Resolves a persisted bookmark's target by module path and token, since node ids are session-local. */
  findMember(workspaceId: string, modulePath: string, metadataToken: number): Promise<FindMemberResponse>
  search(workspaceId: string, query: string, kinds?: string[]): Promise<SearchResponse>
  analyzeReferences(workspaceId: string, nodeId: string): Promise<AnalyzeReferencesResponse>
  getHexLength(workspaceId: string, moduleId: string): Promise<HexLengthResponse>
  readHex(workspaceId: string, moduleId: string, offset: number, count: number): Promise<HexReadResponse>
  getModuleInfo(workspaceId: string, moduleId: string): Promise<ModuleInfoResponse>
  beginEdit(workspaceId: string): Promise<BeginEditResponse>
  getMethodBody(workspaceId: string, methodNodeId: string): Promise<MethodBodyResponse>
  /** The dialog model behind a node, which is what an Edit dialog opens with. Read-only: nothing about
   * it is queued until the dialog is accepted. */
  getNodeOptions(workspaceId: string, kind: string, nodeId: string): Promise<NodeOptionsResponse>
  queueRename(workspaceId: string, transactionId: string, nodeId: string, newName: string): Promise<void>
  /** Removes a type, member, resource, or every type of a namespace from its owner. */
  queueDelete(workspaceId: string, transactionId: string, nodeId: string): Promise<void>
  /** Renames a namespace, or moves its types to the empty namespace when `newName` is empty. */
  queueSetNamespace(workspaceId: string, transactionId: string, nodeId: string, newName: string): Promise<void>
  queueMethodBody(workspaceId: string, transactionId: string, methodNodeId: string, body: MethodBodyResponse, clearExceptionHandlers: boolean): Promise<void>
  /** Replaces a method body with the stub the backend derives from the method's signature. */
  queueMethodBodyStub(workspaceId: string, transactionId: string, methodNodeId: string): Promise<void>
  replaceResourceFromFile(workspaceId: string, transactionId: string, resourceNodeId: string): Promise<boolean>
  commitEdit(workspaceId: string, transactionId: string): Promise<EditCommitResponse>
  rollbackEdit(workspaceId: string, transactionId: string): Promise<void>
  undoEdit(workspaceId: string): Promise<EditCommitResponse>
  redoEdit(workspaceId: string): Promise<EditCommitResponse>
  saveModuleAs(workspaceId: string, moduleId: string, suggestedName: string): Promise<SaveModuleResponse | undefined>
  saveCode(suggestedName: string, text: string): Promise<string | undefined>
  /** Picks a text file and returns its contents, or undefined when the picker was dismissed. Used to import bookmarks. */
  readTextFile(): Promise<string | undefined>
  chooseDebugTarget(): Promise<string | undefined>
  chooseDebugDirectory(): Promise<string | undefined>
  listDebugProcesses(): Promise<DebugProcess[]>
  launchDebug(options: DebugLaunchOptions): Promise<DebugStartResponse>
  attachDebug(processId: number, workspaceId?: string): Promise<DebugStartResponse>
  setBreakpoints(sessionId: string, breakpoints: DebugBreakpointRequest[]): Promise<DebugBreakpoint[]>
  setFunctionBreakpoints(sessionId: string, names: string[]): Promise<Record<string, unknown>>
  /** Releases a launch the engine held back until the client had armed its breakpoints. */
  configurationDone(sessionId: string): Promise<void>
  debugContinue(sessionId: string, threadId: number): Promise<Record<string, unknown>>
  debugPause(sessionId: string, threadId: number): Promise<Record<string, unknown>>
  debugNext(sessionId: string, threadId: number): Promise<Record<string, unknown>>
  debugStepIn(sessionId: string, threadId: number): Promise<Record<string, unknown>>
  debugStepOut(sessionId: string, threadId: number): Promise<Record<string, unknown>>
  getDebugThreads(sessionId: string): Promise<DebugThread[]>
  getDebugStackTrace(sessionId: string, threadId: number): Promise<DebugStackFrame[]>
  getDebugScopes(sessionId: string, frameId: number): Promise<DebugScope[]>
  getDebugVariables(sessionId: string, variablesReference: number): Promise<DebugVariable[]>
  getDebugModules(sessionId: string): Promise<DebugModule[]>
  setExceptionBreakpoints(sessionId: string, filters: string[]): Promise<Record<string, unknown>>
  evaluateDebugExpression(sessionId: string, frameId: number, expression: string): Promise<DebugVariable>
  disconnectDebug(sessionId: string, terminateDebuggee: boolean): Promise<void>
  /** Runs one submission in the C# Interactive session and returns the lines it produced. */
  evaluateScript(code: string): Promise<ScriptEvaluateResponse>
  /** Drops the C# Interactive session and builds a fresh one, reporting the engine banner. */
  resetScript(): Promise<ScriptEvaluateResponse>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<boolean>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>
  setFullScreen(fullScreen: boolean): Promise<boolean>
  toggleFullScreen(): Promise<boolean>
  isFullScreen(): Promise<boolean>
  quit(): Promise<void>
  getBackendStatus(): Promise<BackendStatus>
  getInitialPaths(): Promise<string[]>
  getProcessId(): Promise<number>
  setLocale(locale: UiLocale): Promise<void>
  onWindowMaximizedChange(callback: (isMaximized: boolean) => void): () => void
  onFullScreenChange(callback: (isFullScreen: boolean) => void): () => void
  onBackendStatus(callback: (status: BackendStatus) => void): () => void
  onDebugEvent(callback: (event: DebugEvent) => void): () => void
}
