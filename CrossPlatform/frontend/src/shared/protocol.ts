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

/** Lines of a decompiled document that belong to one method body, so a gutter click can be mapped to that method. */
export interface BreakpointLocation {
  startLine: number
  endLine: number
  description: string
}

export interface DecompileResponse {
  title: string
  language: string
  text: string
  spans: TextSpan[]
  diagnostics: Diagnostic[]
  breakpointLocations?: BreakpointLocation[]
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

export type UiLocale = 'en' | 'zh-CN'

export interface DnSpyApi {
  openAssemblies(): Promise<string[]>
  openWorkspace(paths: string[]): Promise<OpenWorkspaceResponse>
  closeWorkspace(workspaceId: string): Promise<void>
  getRoots(workspaceId: string): Promise<TreeNodesResponse>
  getChildren(workspaceId: string, nodeId: string): Promise<TreeNodesResponse>
  getNode(workspaceId: string, nodeId: string): Promise<TreeNode>
  decompile(workspaceId: string, nodeId: string, language: DecompilerLanguage): Promise<DecompileResponse>
  search(workspaceId: string, query: string, kinds?: string[]): Promise<SearchResponse>
  analyzeReferences(workspaceId: string, nodeId: string): Promise<AnalyzeReferencesResponse>
  getHexLength(workspaceId: string, moduleId: string): Promise<HexLengthResponse>
  readHex(workspaceId: string, moduleId: string, offset: number, count: number): Promise<HexReadResponse>
  getModuleInfo(workspaceId: string, moduleId: string): Promise<ModuleInfoResponse>
  beginEdit(workspaceId: string): Promise<BeginEditResponse>
  getMethodBody(workspaceId: string, methodNodeId: string): Promise<MethodBodyResponse>
  queueRename(workspaceId: string, transactionId: string, nodeId: string, newName: string): Promise<void>
  queueMethodBody(workspaceId: string, transactionId: string, methodNodeId: string, body: MethodBodyResponse, clearExceptionHandlers: boolean): Promise<void>
  replaceResourceFromFile(workspaceId: string, transactionId: string, resourceNodeId: string): Promise<boolean>
  commitEdit(workspaceId: string, transactionId: string): Promise<EditCommitResponse>
  rollbackEdit(workspaceId: string, transactionId: string): Promise<void>
  undoEdit(workspaceId: string): Promise<EditCommitResponse>
  redoEdit(workspaceId: string): Promise<EditCommitResponse>
  saveModuleAs(workspaceId: string, moduleId: string, suggestedName: string): Promise<SaveModuleResponse | undefined>
  saveCode(suggestedName: string, text: string): Promise<string | undefined>
  chooseDebugTarget(): Promise<string | undefined>
  listDebugProcesses(): Promise<DebugProcess[]>
  launchDebug(program: string, args: string[], stopAtEntry: boolean): Promise<DebugStartResponse>
  attachDebug(processId: number): Promise<DebugStartResponse>
  setFunctionBreakpoints(sessionId: string, names: string[]): Promise<Record<string, unknown>>
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
