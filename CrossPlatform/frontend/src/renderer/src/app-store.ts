import { create } from 'zustand'
import type {
  AnalyzeReferencesResponse,
  BackendStatus,
  CodeStatement,
  DecompilerLanguage,
  DecompileResponse,
  DebugBreakpoint,
  DebugEvent,
  DebugModule,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
  EditCommitResponse,
  OpenedModule,
  ReferenceResult,
  SearchResult,
  TreeNode,
} from '../../shared/protocol'
import { getActiveLocale, translate as t } from './localization'

export interface DocumentState extends DecompileResponse {
  nodeId: string
  loading: boolean
  requestedLanguage: DecompilerLanguage
}

export interface FunctionBreakpoint {
  name: string
  enabled: boolean
}

/**
 * A line breakpoint as the client tracks it. `identity` is the IL identity the click resolved to —
 * available before the first backend round trip because the decompiled document already carries the
 * IL range of every statement — and is what makes a second click on the snapped line a toggle
 * rather than a second breakpoint.
 */
export interface LineBreakpoint {
  id: string
  nodeId: string
  identity: string
  requestedLine: number
  line: number
  endLine: number
  state: 'bound' | 'pending' | 'unbound'
  message?: string
  enabled: boolean
  description?: string
  modulePath?: string
  metadataToken?: number
  ilOffset?: number
}

/**
 * Where the debugger is stopped, in decompiled-source terms. The node is the document the location has to be shown
 * in — a frame in a module the workspace does not hold has no node, and then there is nothing to navigate to.
 */
export interface StoppedLocation {
  nodeId?: string
  line: number
  column?: number
  name: string
}

interface AppState {
  backendStatus: BackendStatus
  workspaceId?: string
  modules: OpenedModule[]
  roots: TreeNode[]
  children: Record<string, TreeNode[]>
  parents: Record<string, string>
  expanded: Record<string, boolean>
  loadingNodes: Record<string, boolean>
  selectedNode?: TreeNode
  documents: Record<string, DocumentState>
  searchResults: SearchResult[]
  references: ReferenceResult[]
  output: string[]
  busy: boolean
  dirty: boolean
  workspaceStateId?: string
  savedStateId?: string
  canUndo: boolean
  canRedo: boolean
  recentWorkspaces: string[][]
  debugSessionId?: string
  debugState: 'inactive' | 'starting' | 'running' | 'stopped'
  debugThreads: DebugThread[]
  debugFrames: DebugStackFrame[]
  debugVariables: DebugVariable[]
  debugModules: DebugModule[]
  selectedDebugThreadId?: number
  selectedDebugFrameId?: number
  stoppedReason?: string
  /** The statement the selected frame is stopped at, once it has been resolved to a document line. */
  stoppedLocation?: StoppedLocation
  watches: string[]
  watchValues: DebugVariable[]
  functionBreakpoints: FunctionBreakpoint[]
  lineBreakpoints: LineBreakpoint[]
  exceptionBreakpoints: string[]
  /** What the engine says it can do; drives which debug UI stays enabled. */
  debugCapabilities: Record<string, unknown>
  error?: string
  wordWrap: boolean
  highlightCurrentLine: boolean
  setWordWrap(value: boolean): void
  setHighlightCurrentLine(value: boolean): void
  setBackendStatus(status: BackendStatus): void
  chooseAndOpen(): Promise<void>
  openPaths(paths: string[]): Promise<void>
  closeWorkspace(): Promise<void>
  toggleNode(node: TreeNode): Promise<void>
  selectNode(node: TreeNode): void
  openDocument(node: TreeNode, language?: DecompilerLanguage): Promise<string>
  changeDocumentLanguage(nodeId: string, language: DecompilerLanguage): Promise<void>
  runSearch(query: string, kinds?: string[]): Promise<void>
  analyzeNode(node: TreeNode): Promise<AnalyzeReferencesResponse | undefined>
  renameNode(node: TreeNode, newName: string): Promise<boolean>
  replaceResource(node: TreeNode): Promise<boolean>
  saveModuleAs(): Promise<boolean>
  saveCode(documentId: string): Promise<boolean>
  methodBodyChanged(node: TreeNode, result: EditCommitResponse): Promise<void>
  undoEdit(): Promise<void>
  redoEdit(): Promise<void>
  launchDebug(): Promise<void>
  attachDebug(processId: number): Promise<void>
  handleDebugEvent(event: DebugEvent): Promise<void>
  continueDebug(): Promise<void>
  pauseDebug(): Promise<void>
  stepDebug(kind: 'next' | 'stepIn' | 'stepOut'): Promise<void>
  stopDebug(): Promise<void>
  selectDebugFrame(frameId: number): Promise<void>
  selectDebugThread(threadId: number): Promise<void>
  /** Opens the document the selected frame stopped in, and marks the line it is on. */
  revealStoppedLocation(): Promise<void>
  addWatch(expression: string): Promise<void>
  removeWatch(expression: string): void
  addFunctionBreakpoint(name: string): Promise<void>
  removeFunctionBreakpoint(name: string): Promise<void>
  toggleFunctionBreakpoint(name: string): Promise<void>
  setFunctionBreakpointEnabled(name: string, enabled: boolean): Promise<void>
  deleteAllFunctionBreakpoints(): Promise<void>
  setAllFunctionBreakpointsEnabled(enabled: boolean): Promise<void>
  toggleLineBreakpoint(nodeId: string, line: number, column?: number): Promise<void>
  removeLineBreakpoint(id: string): Promise<void>
  setLineBreakpointEnabled(id: string, enabled: boolean): Promise<void>
  deleteAllBreakpoints(): Promise<void>
  setAllLineBreakpointsEnabled(enabled: boolean): Promise<void>
  setExceptionBreakpoint(filter: string, enabled: boolean): Promise<void>
  appendOutput(message: string): void
  clearError(): void
}

const timestamp = (): string => new Date().toLocaleTimeString(getActiveLocale())

const loadBool = (key: string, fallback: boolean): boolean => {
  if (typeof localStorage === 'undefined')
    return fallback
  const saved = localStorage.getItem(key)
  return saved === null ? fallback : saved === 'true'
}

export const useAppStore = create<AppState>((set, get) => ({
  backendStatus: { state: 'starting' },
  modules: [],
  roots: [],
  children: {},
  parents: {},
  expanded: {},
  loadingNodes: {},
  wordWrap: typeof localStorage === 'undefined' ? false : localStorage.getItem('dnspy.wordWrap') === 'true',
  highlightCurrentLine: typeof localStorage === 'undefined' ? true : localStorage.getItem('dnspy.highlightCurrentLine') !== 'false',
  documents: {},
  searchResults: [],
  references: [],
  output: [],
  busy: false,
  dirty: false,
  canUndo: false,
  canRedo: false,
  recentWorkspaces: loadRecentWorkspaces(),
  debugState: 'inactive',
  debugThreads: [],
  debugFrames: [],
  debugVariables: [],
  debugModules: [],
  watches: [],
  watchValues: [],
  functionBreakpoints: [],
  lineBreakpoints: [],
  exceptionBreakpoints: [],
  debugCapabilities: {},

  setBackendStatus: (status) => {
    set({ backendStatus: status })
    get().appendOutput(status.message
      ? t('Backend: {state} - {message}', { state: t(status.state), message: status.message })
      : t('Backend: {state}', { state: t(status.state) }))
  },

  chooseAndOpen: async () => {
    const paths = await window.dnSpy.openAssemblies()
    if (paths.length > 0)
      await get().openPaths(paths)
  },

  openPaths: async (paths) => {
    set({ busy: true, error: undefined })
    try {
      const previousWorkspace = get().workspaceId
      if (previousWorkspace)
        await window.dnSpy.closeWorkspace(previousWorkspace)
      const opened = await window.dnSpy.openWorkspace(paths)
      const roots = await window.dnSpy.getRoots(opened.workspaceId)
      set({
        workspaceId: opened.workspaceId,
        modules: opened.modules,
        roots: roots.nodes,
        children: {},
        parents: {},
        expanded: {},
        loadingNodes: {},
        selectedNode: roots.nodes[0],
        documents: {},
        searchResults: [],
        references: [],
        dirty: false,
        workspaceStateId: opened.stateId,
        savedStateId: opened.stateId,
        canUndo: false,
        canRedo: false,
        recentWorkspaces: rememberWorkspace(paths),
      })
      get().appendOutput(t('Opened {count} module(s).', { count: opened.modules.length }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      get().appendOutput(t('Open failed: {message}', { message }))
    } finally {
      set({ busy: false })
    }
  },

  closeWorkspace: async () => {
    const workspaceId = get().workspaceId
    if (workspaceId)
      await window.dnSpy.closeWorkspace(workspaceId)
    set({
      workspaceId: undefined,
      modules: [],
      roots: [],
      children: {},
      parents: {},
      expanded: {},
      selectedNode: undefined,
      documents: {},
      searchResults: [],
      references: [],
      dirty: false,
      workspaceStateId: undefined,
      savedStateId: undefined,
      canUndo: false,
      canRedo: false,
    })
    get().appendOutput(t('Workspace closed.'))
  },

  toggleNode: async (node) => {
    if (!node.hasChildren)
      return
    if (get().expanded[node.id]) {
      set((state) => ({ expanded: { ...state.expanded, [node.id]: false } }))
      return
    }
    set((state) => ({
      expanded: { ...state.expanded, [node.id]: true },
      loadingNodes: { ...state.loadingNodes, [node.id]: !state.children[node.id] },
    }))
    if (get().children[node.id])
      return
    const workspaceId = get().workspaceId
    if (!workspaceId)
      return
    try {
      const response = await window.dnSpy.getChildren(workspaceId, node.id)
      set((state) => ({
        children: { ...state.children, [node.id]: response.nodes },
        parents: {
          ...state.parents,
          ...Object.fromEntries(response.nodes.map((child) => [child.id, node.id])),
        },
        loadingNodes: { ...state.loadingNodes, [node.id]: false },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({
        error: message,
        loadingNodes: { ...state.loadingNodes, [node.id]: false },
      }))
      get().appendOutput(t('Tree load failed: {message}', { message }))
    }
  },

  selectNode: (node) => set({ selectedNode: node }),

  openDocument: async (node, language = 'cSharp') => {
    const workspaceId = get().workspaceId
    if (!workspaceId)
      throw new Error(t('No workspace is open.'))
    const documentId = node.id
    set((state) => ({
      selectedNode: node,
      documents: {
        ...state.documents,
        [documentId]: {
          nodeId: node.id,
          title: node.label,
          language: language === 'cSharp' ? 'csharp' : language === 'visualBasic' ? 'visual-basic' : 'il',
          text: '',
          spans: [],
          diagnostics: [],
          codeStatements: [],
          loading: true,
          requestedLanguage: language,
        },
      },
    }))
    try {
      const document = await window.dnSpy.decompile(workspaceId, node.id, language)
      if (get().documents[documentId]?.requestedLanguage === language) {
        set((state) => ({
          documents: {
            ...state.documents,
            [documentId]: {
              ...document,
              codeStatements: document.codeStatements ?? [],
              nodeId: node.id,
              loading: false,
              requestedLanguage: language,
            },
          },
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({
        error: message,
        documents: {
          ...state.documents,
          [documentId]: {
            ...state.documents[documentId],
            loading: false,
            diagnostics: [{ severity: 'error', message }],
          },
        },
      }))
      get().appendOutput(t('Decompile failed: {message}', { message }))
    }
    return documentId
  },

  changeDocumentLanguage: async (nodeId, language) => {
    const existing = get().documents[nodeId]
    const node = findNode(get(), nodeId)
    if (existing && node)
      await get().openDocument(node, language)
  },

  runSearch: async (query, kinds) => {
    const workspaceId = get().workspaceId
    if (!workspaceId || !query.trim()) {
      set({ searchResults: [] })
      return
    }
    set({ busy: true, error: undefined })
    try {
      const response = await window.dnSpy.search(workspaceId, query.trim(), kinds)
      set({ searchResults: response.results })
      get().appendOutput(t('Search returned {count} result(s).', { count: `${response.results.length}${response.truncated ? '+' : ''}` }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      get().appendOutput(t('Search failed: {message}', { message }))
    } finally {
      set({ busy: false })
    }
  },

  analyzeNode: async (node) => {
    const workspaceId = get().workspaceId
    if (!workspaceId)
      return undefined
    set({ busy: true, selectedNode: node, error: undefined })
    try {
      const response = await window.dnSpy.analyzeReferences(workspaceId, node.id)
      set({ references: response.results })
      get().appendOutput(t('Analysis returned {count} reference(s).', { count: `${response.results.length}${response.truncated ? '+' : ''}` }))
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      get().appendOutput(t('Analysis failed: {message}', { message }))
      return undefined
    } finally {
      set({ busy: false })
    }
  },

  renameNode: async (node, newName) => {
    const workspaceId = get().workspaceId
    if (!workspaceId || !newName.trim())
      return false
    set({ busy: true, error: undefined })
    let transactionId: string | undefined
    try {
      transactionId = (await window.dnSpy.beginEdit(workspaceId)).transactionId
      await window.dnSpy.queueRename(workspaceId, transactionId, node.id, newName.trim())
      const committed = await window.dnSpy.commitEdit(workspaceId, transactionId)
      const parentId = get().parents[node.id]
      if (parentId) {
        const refreshed = await window.dnSpy.getChildren(workspaceId, parentId)
        set((state) => ({ children: { ...state.children, [parentId]: refreshed.nodes } }))
      }
      set((state) => ({
        dirty: committed.stateId !== state.savedStateId,
        workspaceStateId: committed.stateId,
        canUndo: committed.canUndo,
        canRedo: committed.canRedo,
        selectedNode: state.selectedNode?.id === node.id ? { ...state.selectedNode, label: newName.trim() } : state.selectedNode,
        documents: state.documents[node.id]
          ? { ...state.documents, [node.id]: { ...state.documents[node.id], title: newName.trim() } }
          : state.documents,
      }))
      get().appendOutput(t('Renamed {oldName} to {newName}.', { oldName: node.label, newName: newName.trim() }))
      return true
    } catch (error) {
      if (transactionId) {
        try { await window.dnSpy.rollbackEdit(workspaceId, transactionId) } catch { /* already committed or invalidated */ }
      }
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      get().appendOutput(t('Rename failed: {message}', { message }))
      return false
    } finally {
      set({ busy: false })
    }
  },

  replaceResource: async (node) => {
    const workspaceId = get().workspaceId
    if (!workspaceId || node.kind !== 'resource')
      return false
    set({ busy: true, error: undefined })
    let transactionId: string | undefined
    try {
      transactionId = (await window.dnSpy.beginEdit(workspaceId)).transactionId
      const selected = await window.dnSpy.replaceResourceFromFile(workspaceId, transactionId, node.id)
      if (!selected) {
        await window.dnSpy.rollbackEdit(workspaceId, transactionId)
        return false
      }
      const committed = await window.dnSpy.commitEdit(workspaceId, transactionId)
      const parentId = get().parents[node.id]
      if (parentId) {
        const refreshed = await window.dnSpy.getChildren(workspaceId, parentId)
        set((state) => ({ children: { ...state.children, [parentId]: refreshed.nodes } }))
      }
      set((state) => ({
        dirty: committed.stateId !== state.savedStateId,
        workspaceStateId: committed.stateId,
        canUndo: committed.canUndo,
        canRedo: committed.canRedo,
      }))
      get().appendOutput(t('Replaced resource {name}.', { name: node.label }))
      return true
    } catch (error) {
      if (transactionId) {
        try { await window.dnSpy.rollbackEdit(workspaceId, transactionId) } catch { /* already committed or invalidated */ }
      }
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      get().appendOutput(t('Resource replacement failed: {message}', { message }))
      return false
    } finally {
      set({ busy: false })
    }
  },

  saveModuleAs: async () => {
    const { workspaceId, modules, selectedNode } = get()
    if (!workspaceId || modules.length === 0)
      return false
    const module = selectedNode?.kind === 'module'
      ? modules.find((candidate) => candidate.id === selectedNode.id) ?? modules[0]
      : modules[0]
    set({ busy: true, error: undefined })
    try {
      const saved = await window.dnSpy.saveModuleAs(workspaceId, module.id, module.name.endsWith('.dll') || module.name.endsWith('.exe') ? module.name : `${module.name}.dll`)
      if (!saved)
        return false
      set((state) => ({ dirty: false, savedStateId: state.workspaceStateId }))
      get().appendOutput(t('Saved {path} ({length} bytes, SHA-256 {sha256}).', { path: saved.path, length: saved.length.toLocaleString(getActiveLocale()), sha256: saved.sha256 }))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      get().appendOutput(t('Save failed: {message}', { message }))
      return false
    } finally {
      set({ busy: false })
    }
  },

  saveCode: async (documentId) => {
    const { busy, documents } = get()
    const document = documents[documentId]
    if (busy || !document || document.loading)
      return false
    set({ busy: true, error: undefined })
    try {
      const savedPath = await window.dnSpy.saveCode(suggestCodeFilename(document.title, document.language), document.text)
      if (!savedPath)
        return false
      get().appendOutput(t('Saved code to {path}.', { path: savedPath }))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      get().appendOutput(t('Save code failed: {message}', { message }))
      return false
    } finally {
      set({ busy: false })
    }
  },

  methodBodyChanged: async (node, result) => {
    set((state) => ({
      dirty: result.stateId !== state.savedStateId,
      workspaceStateId: result.stateId,
      canUndo: result.canUndo,
      canRedo: result.canRedo,
    }))
    if (get().documents[node.id])
      await get().openDocument(node, 'il')
    get().appendOutput(t('Updated IL body for {name}.', { name: node.label }))
  },

  undoEdit: async () => {
    const workspaceId = get().workspaceId
    if (!workspaceId || !get().canUndo) return
    try {
      const result = await window.dnSpy.undoEdit(workspaceId)
      await refreshAfterEdit(get, set, result)
      get().appendOutput(t('Undo completed.'))
    } catch (error) {
      get().appendOutput(t('Undo failed: {message}', { message: error instanceof Error ? error.message : String(error) }))
    }
  },

  redoEdit: async () => {
    const workspaceId = get().workspaceId
    if (!workspaceId || !get().canRedo) return
    try {
      const result = await window.dnSpy.redoEdit(workspaceId)
      await refreshAfterEdit(get, set, result)
      get().appendOutput(t('Redo completed.'))
    } catch (error) {
      get().appendOutput(t('Redo failed: {message}', { message: error instanceof Error ? error.message : String(error) }))
    }
  },

  launchDebug: async () => {
    const target = await window.dnSpy.chooseDebugTarget()
    if (!target) return
    set({ debugState: 'starting', error: undefined })
    try {
      // The workspace id travels with the launch: it is how the engine turns a decompiled line into an IL offset.
      const started = await window.dnSpy.launchDebug(target, [], true, get().workspaceId)
      set({ debugSessionId: started.sessionId, debugCapabilities: started.capabilities })
      const breakpointNames = enabledFunctionBreakpointNames(get().functionBreakpoints)
      if (breakpointNames.length > 0)
        await window.dnSpy.setFunctionBreakpoints(started.sessionId, breakpointNames)
      if (get().lineBreakpoints.length > 0)
        await syncLineBreakpoints(get, set)
      if (get().exceptionBreakpoints.length > 0)
        await window.dnSpy.setExceptionBreakpoints(started.sessionId, get().exceptionBreakpoints)
      get().appendOutput(t('Started debugging {target}.', { target }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ debugState: 'inactive', error: message })
      get().appendOutput(t('Debug launch failed: {message}', { message }))
    }
  },

  attachDebug: async (processId) => {
    set({ debugState: 'starting', error: undefined })
    try {
      const started = await window.dnSpy.attachDebug(processId, get().workspaceId)
      set({ debugSessionId: started.sessionId, debugCapabilities: started.capabilities })
      if (get().lineBreakpoints.length > 0)
        await syncLineBreakpoints(get, set)
      get().appendOutput(t('Attached to process {processId}.', { processId }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ debugState: 'inactive', error: message })
      get().appendOutput(t('Debug attach failed: {message}', { message }))
    }
  },

  handleDebugEvent: async (event) => {
    if (event.event === 'stopped') {
      const threadId = typeof event.body?.threadId === 'number' ? event.body.threadId : undefined
      set({
        debugSessionId: event.sessionId,
        debugState: 'starting',
        selectedDebugThreadId: threadId,
        stoppedReason: typeof event.body?.reason === 'string' ? event.body.reason : 'stopped',
      })
      const reason = typeof event.body?.reason === 'string' ? event.body.reason : 'unknown'
      get().appendOutput(t('Debugger stopped: {reason}.', { reason: t(reason) }))
      await refreshDebugState(get, set, threadId)
      set({ debugState: 'stopped' })
      await get().revealStoppedLocation()
    } else if (event.event === 'breakpoint') {
      // The engine binds late — a module loads, or it refuses an offset we thought was good — so a breakpoint's
      // state can change without the client asking. This is the channel that keeps the gutter honest.
      const body = event.body?.breakpoint as DebugBreakpoint | undefined
      if (body?.id)
        set((state) => ({
          lineBreakpoints: state.lineBreakpoints.map((breakpoint) => breakpoint.id === body.id ? applyBreakpointResult(breakpoint, body) : breakpoint),
        }))
    } else if (event.event === 'continued') {
      set({ debugState: 'running', debugFrames: [], debugVariables: [], watchValues: [], stoppedLocation: undefined })
    } else if (event.event === 'output') {
      const output = typeof event.body?.output === 'string' ? event.body.output.trimEnd() : ''
      if (output) get().appendOutput(output)
    } else if (event.event === 'terminated' || event.event === 'exited') {
      set({
        debugState: 'inactive',
        debugSessionId: undefined,
        debugThreads: [],
        debugFrames: [],
        debugVariables: [],
        debugModules: [],
        watchValues: [],
        stoppedLocation: undefined,
      })
      get().appendOutput(event.event === 'exited'
        ? t('Debug target exited with code {code}.', { code: String(event.body?.exitCode ?? '') })
        : t('Debug session terminated.'))
    }
  },

  continueDebug: async () => {
    const { debugSessionId, selectedDebugThreadId } = get()
    if (!debugSessionId || selectedDebugThreadId === undefined) return
    await window.dnSpy.debugContinue(debugSessionId, selectedDebugThreadId)
    set({ debugState: 'running', debugFrames: [], debugVariables: [], watchValues: [], stoppedLocation: undefined })
  },

  pauseDebug: async () => {
    const { debugSessionId, selectedDebugThreadId } = get()
    if (!debugSessionId || selectedDebugThreadId === undefined) return
    await window.dnSpy.debugPause(debugSessionId, selectedDebugThreadId)
  },

  stepDebug: async (kind) => {
    const { debugSessionId, selectedDebugThreadId } = get()
    if (!debugSessionId || selectedDebugThreadId === undefined) return
    const command = kind === 'next' ? window.dnSpy.debugNext : kind === 'stepIn' ? window.dnSpy.debugStepIn : window.dnSpy.debugStepOut
    await command(debugSessionId, selectedDebugThreadId)
    set({ debugState: 'running', debugFrames: [], debugVariables: [], watchValues: [], stoppedLocation: undefined })
  },

  stopDebug: async () => {
    const sessionId = get().debugSessionId
    if (!sessionId) return
    try { await window.dnSpy.disconnectDebug(sessionId, true) } catch { /* adapter may exit before replying */ }
    set({ debugState: 'inactive', debugSessionId: undefined, debugThreads: [], debugFrames: [], debugVariables: [], debugModules: [], watchValues: [], stoppedLocation: undefined })
  },

  selectDebugFrame: async (frameId) => {
    set({ selectedDebugFrameId: frameId })
    await refreshDebugVariables(get, set, frameId)
    // Picking a frame is a navigation as much as it is a selection: the editor follows along.
    await get().revealStoppedLocation()
  },

  revealStoppedLocation: async () => {
    const { debugFrames, selectedDebugFrameId } = get()
    const frame = debugFrames.find((candidate) => candidate.id === selectedDebugFrameId) ?? debugFrames[0]
    // A frame the decompiler could not place has no line to mark. Clearing the marker is what keeps a
    // highlight from a finished stop lingering over the next one.
    if (!frame || frame.line <= 0 || !frame.nodeId) {
      set({ stoppedLocation: undefined })
      return
    }
    set({ stoppedLocation: { nodeId: frame.nodeId, line: frame.line, column: frame.column, name: frame.name } })
    // Only decompile when the document is not already showing this source: the engine resolves a
    // frame against the C# method document, so a doc open in IL is not the one the line belongs to.
    const node = findNode(get(), frame.nodeId)
    if (node && get().workspaceId && get().documents[frame.nodeId]?.language !== 'csharp')
      await get().openDocument(node, 'cSharp')
  },

  selectDebugThread: async (threadId) => {
    set({ selectedDebugThreadId: threadId })
    await refreshDebugState(get, set, threadId)
  },

  addWatch: async (expression) => {
    const trimmed = expression.trim()
    if (!trimmed || get().watches.includes(trimmed)) return
    set((state) => ({ watches: [...state.watches, trimmed] }))
    await refreshWatches(get, set)
  },

  removeWatch: (expression) => set((state) => ({
    watches: state.watches.filter((watch) => watch !== expression),
    watchValues: state.watchValues.filter((watch) => watch.name !== expression),
  })),

  addFunctionBreakpoint: async (name) => {
    const trimmed = name.trim()
    if (!trimmed || get().functionBreakpoints.some((breakpoint) => breakpoint.name === trimmed)) return
    set((state) => ({ functionBreakpoints: [...state.functionBreakpoints, { name: trimmed, enabled: true }] }))
    await syncFunctionBreakpoints(get)
  },

  removeFunctionBreakpoint: async (name) => {
    set((state) => ({ functionBreakpoints: state.functionBreakpoints.filter((breakpoint) => breakpoint.name !== name) }))
    await syncFunctionBreakpoints(get)
  },

  toggleFunctionBreakpoint: async (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (get().functionBreakpoints.some((breakpoint) => breakpoint.name === trimmed))
      await get().removeFunctionBreakpoint(trimmed)
    else
      await get().addFunctionBreakpoint(trimmed)
  },

  setFunctionBreakpointEnabled: async (name, enabled) => {
    if (!get().functionBreakpoints.some((breakpoint) => breakpoint.name === name && breakpoint.enabled !== enabled)) return
    set((state) => ({
      functionBreakpoints: state.functionBreakpoints.map((breakpoint) => breakpoint.name === name ? { ...breakpoint, enabled } : breakpoint),
    }))
    await syncFunctionBreakpoints(get)
  },

  deleteAllFunctionBreakpoints: async () => {
    if (get().functionBreakpoints.length === 0) return
    set({ functionBreakpoints: [] })
    await syncFunctionBreakpoints(get)
  },

  setAllFunctionBreakpointsEnabled: async (enabled) => {
    if (!get().functionBreakpoints.some((breakpoint) => breakpoint.enabled !== enabled)) return
    set((state) => ({ functionBreakpoints: state.functionBreakpoints.map((breakpoint) => ({ ...breakpoint, enabled })) }))
    await syncFunctionBreakpoints(get)
  },

  toggleLineBreakpoint: async (nodeId, line, column) => {
    const statement = codeStatementAt(get().documents[nodeId]?.codeStatements, line, column)
    // The document already carries the IL range of every statement, so the identity is known before the backend
    // confirms it — which is what lets a second click on the snapped line remove the breakpoint it just created.
    const identity = statement
      ? statementIdentity(statement.modulePath, statement.metadataToken, statement.ilOffset)
      : `${nodeId}|${line}`
    const existing = get().lineBreakpoints.find((breakpoint) => breakpoint.identity === identity)
    if (existing) {
      set((state) => ({ lineBreakpoints: state.lineBreakpoints.filter((breakpoint) => breakpoint.id !== existing.id) }))
    } else {
      set((state) => ({
        lineBreakpoints: [...state.lineBreakpoints, {
          id: `line${++lineBreakpointSequence}`,
          nodeId,
          identity,
          requestedLine: line,
          line: statement?.startLine ?? line,
          endLine: statement?.endLine ?? line,
          state: 'pending',
          enabled: true,
          description: statement?.description,
          modulePath: statement?.modulePath,
          metadataToken: statement?.metadataToken,
          ilOffset: statement?.ilOffset,
        }],
      }))
    }
    await syncLineBreakpoints(get, set)
  },

  removeLineBreakpoint: async (id) => {
    if (!get().lineBreakpoints.some((breakpoint) => breakpoint.id === id)) return
    set((state) => ({ lineBreakpoints: state.lineBreakpoints.filter((breakpoint) => breakpoint.id !== id) }))
    await syncLineBreakpoints(get, set)
  },

  setLineBreakpointEnabled: async (id, enabled) => {
    if (!get().lineBreakpoints.some((breakpoint) => breakpoint.id === id && breakpoint.enabled !== enabled)) return
    set((state) => ({
      lineBreakpoints: state.lineBreakpoints.map((breakpoint) => breakpoint.id === id ? { ...breakpoint, enabled } : breakpoint),
    }))
    await syncLineBreakpoints(get, set)
  },

  deleteAllBreakpoints: async () => {
    if (get().lineBreakpoints.length === 0 && get().functionBreakpoints.length === 0) return
    set({ lineBreakpoints: [], functionBreakpoints: [] })
    await Promise.all([syncLineBreakpoints(get, set), syncFunctionBreakpoints(get)])
  },

  setAllLineBreakpointsEnabled: async (enabled) => {
    if (!get().lineBreakpoints.some((breakpoint) => breakpoint.enabled !== enabled)) return
    set((state) => ({ lineBreakpoints: state.lineBreakpoints.map((breakpoint) => ({ ...breakpoint, enabled })) }))
    await syncLineBreakpoints(get, set)
  },

  setExceptionBreakpoint: async (filter, enabled) => {
    set((state) => ({
      exceptionBreakpoints: enabled
        ? [...new Set([...state.exceptionBreakpoints, filter])]
        : state.exceptionBreakpoints.filter((candidate) => candidate !== filter),
    }))
    const { debugSessionId, exceptionBreakpoints } = get()
    if (debugSessionId)
      await window.dnSpy.setExceptionBreakpoints(debugSessionId, exceptionBreakpoints)
  },

  appendOutput: (message) => set((state) => ({
    output: [...state.output.slice(-999), `${timestamp()}  ${message}`],
  })),

  clearError: () => set({ error: undefined }),

  setWordWrap: (value) => {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem('dnspy.wordWrap', String(value))
    set({ wordWrap: value })
  },
  setHighlightCurrentLine: (value) => {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem('dnspy.highlightCurrentLine', String(value))
    set({ highlightCurrentLine: value })
  },
}))

const findNode = (state: Pick<AppState, 'roots' | 'children'>, nodeId: string): TreeNode | undefined => {
  for (const node of state.roots) {
    if (node.id === nodeId)
      return node
  }
  for (const nodes of Object.values(state.children)) {
    const found = nodes.find((node) => node.id === nodeId)
    if (found)
      return found
  }
  return undefined
}

const recentWorkspaceKey = 'dnspy.recentWorkspaces.v1'

export const suggestCodeFilename = (title: string, language: string): string => {
  const extension = language === 'csharp'
    ? '.cs'
    : language === 'visual-basic'
      ? '.vb'
      : language === 'il'
        ? '.il'
        : language === 'xml'
          ? '.xml'
          : '.txt'
  const baseName = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  return `${baseName || 'code'}${extension}`
}

const lastTopLevelSpace = (value: string): number => {
  let depth = 0
  let index = -1
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '<' || char === '[')
      depth++
    else if (char === '>' || char === ']')
      depth--
    else if (char === ' ' && depth === 0)
      index = i
  }
  return index
}

// Tree node descriptions are dnlib's MethodDef.FullName, e.g. "System.Void Ns.Type::Method(System.Int32)".
// Debug adapters want "Ns.Type.Method", so drop the return type and the parameter list, and turn the "::"
// and nested-type "/" separators into ".". A description that is already in dotted form is returned as is.
// Generic arity ("Ns.Type`1") is kept: stripping it is a dnSpy search-filter concern, not a breakpoint one.
export const methodBreakpointName = (description?: string): string | undefined => {
  const trimmed = description?.trim()
  if (!trimmed)
    return undefined
  const parameterStart = trimmed.indexOf('(')
  const withoutParameters = (parameterStart < 0 ? trimmed : trimmed.slice(0, parameterStart)).trim()
  const separator = withoutParameters.indexOf('::')
  if (separator < 0)
    return withoutParameters || undefined
  const declaring = withoutParameters.slice(0, separator).trim()
  const typeName = declaring.slice(lastTopLevelSpace(declaring) + 1).replace(/\//g, '.')
  const methodName = withoutParameters.slice(separator + 2).trim()
  return typeName && methodName ? `${typeName}.${methodName}` : undefined
}

// A gutter click has to land on a sequence point the engine can bind, so the statement whose line range covers the
// click wins; a click on a blank line, a brace or a comment falls back to the nearest statement below it, and only
// then to the nearest one above. Statements nest (a lambda body lives inside the method that declares it), so among
// candidates the one that starts latest — the innermost — is the one the user aimed at.
export const codeStatementAt = (
  statements: CodeStatement[] | undefined,
  line: number,
  column?: number,
): CodeStatement | undefined => {
  const visible = (statements ?? []).filter((statement) => !statement.isHidden)
  let covering: CodeStatement | undefined
  for (const statement of visible) {
    if (line < statement.startLine || line > statement.endLine)
      continue
    // A column only narrows a single-line statement; a multi-line one covers its whole range.
    if (column !== undefined && statement.startLine === statement.endLine && (column < statement.startColumn - 1 || column > statement.endColumn))
      continue
    if (!covering || statement.startLine > covering.startLine)
      covering = statement
  }
  if (covering)
    return covering
  let nearest: CodeStatement | undefined
  for (const statement of visible) {
    if (!nearest || isCloserStatement(statement, nearest, line))
      nearest = statement
  }
  return nearest
}

const statementDistance = (statement: CodeStatement, line: number): number => line < statement.startLine
  ? statement.startLine - line
  : line > statement.endLine ? line - statement.endLine : 0

// Distance first; a tie goes to the statement below the click, matching what the backend's snapping does.
const isCloserStatement = (candidate: CodeStatement, current: CodeStatement, line: number): boolean => {
  const distance = statementDistance(candidate, line)
  const currentDistance = statementDistance(current, line)
  return distance === currentDistance ? candidate.startLine > current.startLine : distance < currentDistance
}

// The IL identity a statement maps to. Two clicks that land on the same sequence point produce the same key, which
// is what makes the second click a toggle even after the first one was snapped to a different line.
export const statementIdentity = (modulePath: string, metadataToken: number, ilOffset: number): string =>
  `${modulePath}|${metadataToken}|${ilOffset}`

// Where each breakpoint draws its dot. Markers are derived from the document on screen rather than stored on the
// breakpoint, so breakpoints created elsewhere (the Breakpoints pane, F9) show up here too, and a document whose
// language has no IL map simply draws nothing. A breakpoint is matched by IL identity, falling back to the node it
// was requested from while the backend has not confirmed the snap yet.
export const lineBreakpointMarkers = (
  nodeId: string,
  statements: CodeStatement[] | undefined,
  breakpoints: LineBreakpoint[],
): { line: number; enabled: boolean; state: LineBreakpoint['state']; message?: string; description?: string }[] => {
  const markers: { line: number; enabled: boolean; state: LineBreakpoint['state']; message?: string; description?: string }[] = []
  for (const breakpoint of breakpoints) {
    const statement = breakpoint.modulePath !== undefined && breakpoint.ilOffset !== undefined
      ? (statements ?? []).find((candidate) => statementIdentity(candidate.modulePath, candidate.metadataToken, candidate.ilOffset) === breakpoint.identity)
      : undefined
    if (statement)
      markers.push({ line: statement.startLine, enabled: breakpoint.enabled, state: breakpoint.state, message: breakpoint.message, description: breakpoint.description })
    // Until the engine has named the module, the requested line is the only place the dot can go. Once it has, an
    // identity this document does not contain means the breakpoint belongs to some other document entirely.
    else if (breakpoint.modulePath === undefined && breakpoint.nodeId === nodeId)
      markers.push({ line: breakpoint.requestedLine, enabled: breakpoint.enabled, state: breakpoint.state, message: breakpoint.message, description: breakpoint.description })
  }
  return markers
}

function loadRecentWorkspaces(): string[][] {
  try {
    const value = JSON.parse(localStorage.getItem(recentWorkspaceKey) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter((entry): entry is string[] => Array.isArray(entry) && entry.every((path) => typeof path === 'string')).slice(0, 10)
      : []
  } catch {
    return []
  }
}

function rememberWorkspace(paths: string[]): string[][] {
  const normalized = [...paths]
  const identity = normalized.join('\0')
  const recent = [normalized, ...loadRecentWorkspaces().filter((entry) => entry.join('\0') !== identity)].slice(0, 10)
  localStorage.setItem(recentWorkspaceKey, JSON.stringify(recent))
  return recent
}

type StoreGet = () => AppState
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void

// Ids only have to be unique within a session's table, and only stable across re-renders, so a counter is enough.
let lineBreakpointSequence = 0

const refreshDebugState = async (get: StoreGet, set: StoreSet, preferredThreadId?: number): Promise<void> => {
  const sessionId = get().debugSessionId
  if (!sessionId) return
  try {
    const threads = await window.dnSpy.getDebugThreads(sessionId)
    const threadId = preferredThreadId ?? threads[0]?.id
    const [frames, modules] = await Promise.all([
      threadId === undefined ? Promise.resolve([]) : window.dnSpy.getDebugStackTrace(sessionId, threadId),
      window.dnSpy.getDebugModules(sessionId).catch(() => []),
    ])
    const frameId = frames[0]?.id
    set({ debugThreads: threads, selectedDebugThreadId: threadId, debugFrames: frames, selectedDebugFrameId: frameId, debugModules: modules })
    if (frameId !== undefined)
      await refreshDebugVariables(get, set, frameId)
  } catch (error) {
    get().appendOutput(t('Could not refresh debugger state: {message}', { message: error instanceof Error ? error.message : String(error) }))
  }
}

const refreshDebugVariables = async (get: StoreGet, set: StoreSet, frameId: number): Promise<void> => {
  const sessionId = get().debugSessionId
  if (!sessionId) return
  const scopes = await window.dnSpy.getDebugScopes(sessionId, frameId)
  const localScope = scopes.find((scope) => scope.name === 'Locals') ?? scopes.find((scope) => !scope.expensive)
  const variables = localScope ? await window.dnSpy.getDebugVariables(sessionId, localScope.variablesReference) : []
  set({ debugVariables: variables })
  await refreshWatches(get, set)
}

const refreshWatches = async (get: StoreGet, set: StoreSet): Promise<void> => {
  const { debugSessionId, selectedDebugFrameId, watches } = get()
  if (!debugSessionId || selectedDebugFrameId === undefined || get().debugState !== 'stopped') return
  const values = await Promise.all(watches.map(async (expression) => {
    try {
      return await window.dnSpy.evaluateDebugExpression(debugSessionId, selectedDebugFrameId, expression)
    } catch (error) {
      return { name: expression, value: error instanceof Error ? error.message : String(error), variablesReference: 0 }
    }
  }))
  set({ watchValues: values })
}

// Disabled breakpoints are deliberately left out of what we send: the debug adapter only knows
// about the breakpoints it was last given, so omitting them is what "disables" them.
const enabledFunctionBreakpointNames = (breakpoints: FunctionBreakpoint[]): string[] =>
  breakpoints.filter((breakpoint) => breakpoint.enabled).map((breakpoint) => breakpoint.name)

const syncFunctionBreakpoints = async (get: StoreGet): Promise<void> => {
  const { debugSessionId, functionBreakpoints } = get()
  if (debugSessionId)
    await window.dnSpy.setFunctionBreakpoints(debugSessionId, enabledFunctionBreakpointNames(functionBreakpoints))
}

// Line breakpoints are sent as the whole set every time, including the disabled ones: the engine can arm and disarm
// a breakpoint in place, so "disabled" does not have to mean "forgotten", and re-enabling one does not have to be
// resolved from scratch. The reply is what the editor draws — the snapped line, and whether it bound at all.
const syncLineBreakpoints = async (get: StoreGet, set: StoreSet): Promise<void> => {
  const { debugSessionId, lineBreakpoints } = get()
  if (!debugSessionId) return
  const requested = lineBreakpoints.map((breakpoint) => ({
    id: breakpoint.id,
    nodeId: breakpoint.nodeId,
    line: breakpoint.requestedLine,
    enabled: breakpoint.enabled,
  }))
  const results = await window.dnSpy.setBreakpoints(debugSessionId, requested)
  const byId = new Map(results.map((result) => [result.id, result]))
  set((state) => ({
    lineBreakpoints: state.lineBreakpoints.map((breakpoint) => {
      const result = byId.get(breakpoint.id)
      return result ? applyBreakpointResult(breakpoint, result) : breakpoint
    }),
  }))
}

const applyBreakpointResult = (breakpoint: LineBreakpoint, result: DebugBreakpoint): LineBreakpoint => {
  const modulePath = result.modulePath || breakpoint.modulePath
  const ilOffset = result.ilOffset >= 0 ? result.ilOffset : breakpoint.ilOffset
  return {
    ...breakpoint,
    // Once the engine has named the module and offset, matching by IL identity is what keeps a later click on the
    // snapped line pointing at this same breakpoint.
    identity: modulePath !== undefined && ilOffset !== undefined
      ? statementIdentity(modulePath, result.metadataToken, ilOffset)
      : breakpoint.identity,
    line: result.line || breakpoint.requestedLine,
    endLine: result.endLine || result.line || breakpoint.requestedLine,
    state: result.state,
    message: result.message,
    enabled: result.enabled,
    description: result.description ?? breakpoint.description,
    modulePath,
    metadataToken: result.metadataToken || breakpoint.metadataToken,
    ilOffset,
  }
}

const refreshAfterEdit = async (get: StoreGet, set: StoreSet, result: EditCommitResponse): Promise<void> => {
  const { workspaceId, savedStateId } = get()
  if (!workspaceId) return
  set({
    workspaceStateId: result.stateId,
    dirty: result.stateId !== savedStateId,
    canUndo: result.canUndo,
    canRedo: result.canRedo,
  })
  const parentIds = new Set<string>()
  for (const nodeId of result.changedNodeIds) {
    const parentId = get().parents[nodeId]
    if (parentId) parentIds.add(parentId)
    try {
      const node = await window.dnSpy.getNode(workspaceId, nodeId)
      if (get().selectedNode?.id === nodeId)
        set({ selectedNode: node })
      const document = get().documents[nodeId]
      if (document)
        await get().openDocument(node, document.requestedLanguage)
    } catch {
      // A removed metadata item may no longer have a view model.
    }
  }
  for (const parentId of parentIds) {
    const refreshed = await window.dnSpy.getChildren(workspaceId, parentId)
    set((state) => ({ children: { ...state.children, [parentId]: refreshed.nodes } }))
  }
}
