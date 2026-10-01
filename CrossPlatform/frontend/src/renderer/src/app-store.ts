import { create } from 'zustand'
import type {
  AnalyzeReferencesResponse,
  BackendStatus,
  DecompilerLanguage,
  DecompileResponse,
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
  watches: string[]
  watchValues: DebugVariable[]
  functionBreakpoints: string[]
  exceptionBreakpoints: string[]
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
  addWatch(expression: string): Promise<void>
  removeWatch(expression: string): void
  addFunctionBreakpoint(name: string): Promise<void>
  removeFunctionBreakpoint(name: string): Promise<void>
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
  exceptionBreakpoints: [],

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
      const started = await window.dnSpy.launchDebug(target, [], true)
      set({ debugSessionId: started.sessionId })
      if (get().functionBreakpoints.length > 0)
        await window.dnSpy.setFunctionBreakpoints(started.sessionId, get().functionBreakpoints)
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
      const started = await window.dnSpy.attachDebug(processId)
      set({ debugSessionId: started.sessionId })
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
    } else if (event.event === 'continued') {
      set({ debugState: 'running', debugFrames: [], debugVariables: [], watchValues: [] })
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
    set({ debugState: 'running', debugFrames: [], debugVariables: [], watchValues: [] })
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
    set({ debugState: 'running', debugFrames: [], debugVariables: [], watchValues: [] })
  },

  stopDebug: async () => {
    const sessionId = get().debugSessionId
    if (!sessionId) return
    try { await window.dnSpy.disconnectDebug(sessionId, true) } catch { /* adapter may exit before replying */ }
    set({ debugState: 'inactive', debugSessionId: undefined, debugThreads: [], debugFrames: [], debugVariables: [], debugModules: [], watchValues: [] })
  },

  selectDebugFrame: async (frameId) => {
    set({ selectedDebugFrameId: frameId })
    await refreshDebugVariables(get, set, frameId)
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
    if (!trimmed || get().functionBreakpoints.includes(trimmed)) return
    set((state) => ({ functionBreakpoints: [...state.functionBreakpoints, trimmed] }))
    await syncFunctionBreakpoints(get)
  },

  removeFunctionBreakpoint: async (name) => {
    set((state) => ({ functionBreakpoints: state.functionBreakpoints.filter((breakpoint) => breakpoint !== name) }))
    await syncFunctionBreakpoints(get)
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

const syncFunctionBreakpoints = async (get: StoreGet): Promise<void> => {
  const { debugSessionId, functionBreakpoints } = get()
  if (debugSessionId)
    await window.dnSpy.setFunctionBreakpoints(debugSessionId, functionBreakpoints)
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
