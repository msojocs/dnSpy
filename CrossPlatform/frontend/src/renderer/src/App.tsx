import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Actions, DockLocation, I18nLabelDefaults, Layout, Model, TabNode, type IJsonModel } from 'flexlayout-react'
import { AlertCircle, FolderOpen, X } from 'lucide-react'
import type { DecompilerLanguage, TreeNode } from '../../shared/protocol'
import { enableSessionPersistence, loadSession, methodBreakpointName, orderedDocumentKeys, ownerTypeIdOf, useAppStore, type SavedSession } from './app-store'
import { clearBookmarks, clearBookmarksInDocument, showBookmarksWindow, stepBookmark, toggleBookmarkAtCaret, toggleBookmarkEnabledAtCaret } from './bookmark-commands'
import { AssemblyExplorer } from './components/AssemblyExplorer'
import { MenuBar, type ThemeName } from './components/MenuBar'
import { ToolBar } from './components/ToolBar'
import { AnalysisPane, DebugPlaceholder, OutputPane, SearchPane } from './components/ToolWindows'
import { CSharpInteractive } from './components/CSharpInteractive'
import { MethodBodyEditor, RenameDialog, RenameNamespaceDialog } from './components/EditDialogs'
import { HexView, ModuleInfoView } from './components/SpecialDocuments'
import { BreakpointsPane, CallStackPane, LocalsPane, ModulesPane, ThreadsPane, WatchPane } from './components/DebugToolWindows'
import { BookmarksPane } from './components/BookmarksPane'
import { AttachDialog } from './components/AttachDialog'
import { DebugProgramDialog } from './components/DebugProgramDialog'
import { AboutDialog } from './components/AboutDialog'
import { NodeOptionsDialog } from './components/NodeOptionsDialog'
import { OptionsDialog } from './components/OptionsDialog'
import { cloneDocumentTab, closeDocumentTab, closeDocumentTabsFor, showDocumentTabContextMenu } from './components/DocumentTabContextMenu'
import type { ActiveDocument, CreatedKind, HexShowKind } from './components/edit-menu'
import { findInActiveDocumentEditor, focusDocumentEditor } from './editor-registry'
import { translate, useLanguage } from './localization'

const DocumentView = lazy(async () => {
  const module = await import('./components/DocumentView')
  return { default: module.DocumentView }
})

const createDefaultLayout = (): IJsonModel => ({
  global: {
    tabEnableRename: false,
    tabEnableFloat: false,
    tabSetEnableMaximize: true,
    tabSetEnableDeleteWhenEmpty: true,
    tabSetMinWidth: 120,
    tabSetMinHeight: 80,
    borderMinSize: 120,
  },
  borders: [
    {
      type: 'border',
      location: 'left',
      size: 250,
      selected: 0,
      children: [{ type: 'tab', id: 'explorer', name: translate('Assembly Explorer'), component: 'explorer', enableClose: false }],
    },
    {
      type: 'border',
      location: 'bottom',
      size: 220,
      selected: 0,
      children: [
        { type: 'tab', id: 'output', name: translate('Output'), component: 'output', enableClose: true },
        { type: 'tab', id: 'csharp-interactive', name: translate('C# Interactive'), component: 'csharp-interactive', enableClose: true },
        { type: 'tab', id: 'search', name: translate('Search'), component: 'search', enableClose: true },
        { type: 'tab', id: 'analysis', name: translate('Analyzer'), component: 'analysis', enableClose: true },
        { type: 'tab', id: 'locals', name: translate('Locals'), component: 'locals', enableClose: true },
        { type: 'tab', id: 'watch', name: translate('Watch'), component: 'watch', enableClose: true },
        { type: 'tab', id: 'callstack', name: translate('Call Stack'), component: 'callstack', enableClose: true },
        { type: 'tab', id: 'breakpoints', name: translate('Breakpoints'), component: 'breakpoints', enableClose: true },
        { type: 'tab', id: 'bookmarks', name: translate('Bookmarks'), component: 'bookmarks', enableClose: true },
        { type: 'tab', id: 'threads', name: translate('Threads'), component: 'threads', enableClose: true },
        { type: 'tab', id: 'modules', name: translate('Modules'), component: 'modules', enableClose: true },
      ],
    },
  ],
  layout: {
    type: 'row',
    children: [{
      type: 'tabset',
      id: 'documents',
      weight: 100,
      selected: 0,
      children: [{ type: 'tab', id: 'start', name: translate('Start'), component: 'start', enableClose: false }],
    }],
  },
})

interface RestorableBorderTab {
  name: string
  component: string
  borderId: string
  location: DockLocation
}

const restorableBorderTabs: Record<string, RestorableBorderTab> = {
  explorer: { name: 'Assembly Explorer', component: 'explorer', borderId: 'border_left', location: DockLocation.LEFT },
  output: { name: 'Output', component: 'output', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  'csharp-interactive': { name: 'C# Interactive', component: 'csharp-interactive', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  search: { name: 'Search', component: 'search', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  analysis: { name: 'Analyzer', component: 'analysis', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  locals: { name: 'Locals', component: 'locals', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  watch: { name: 'Watch', component: 'watch', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  callstack: { name: 'Call Stack', component: 'callstack', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  breakpoints: { name: 'Breakpoints', component: 'breakpoints', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  bookmarks: { name: 'Bookmarks', component: 'bookmarks', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  threads: { name: 'Threads', component: 'threads', borderId: 'border_bottom', location: DockLocation.BOTTOM },
  modules: { name: 'Modules', component: 'modules', borderId: 'border_bottom', location: DockLocation.BOTTOM },
}

const loadLayout = (): Model => {
  try {
    const saved = localStorage.getItem('dnspy.layout.v1')
    const model = Model.fromJson(saved ? JSON.parse(saved) as IJsonModel : createDefaultLayout())
    if (!model.getFirstTabSet())
      return Model.fromJson(createDefaultLayout())
    model.doAction(Actions.updateModelAttributes({ tabSetEnableDeleteWhenEmpty: true }))
    // Migrate older layouts where the tool window tabs were marked non-closable.
    for (const id of Object.keys(restorableBorderTabs)) {
      const node = model.getNodeById(id)
      if (node && !node.isCloseable())
        model.doAction(Actions.updateNodeAttributes(id, { enableClose: true }))
    }
    return model
  } catch {
    return Model.fromJson(createDefaultLayout())
  }
}

const getTargetDocumentTabSet = (model: Model) => model.getActiveTabset() ?? model.getFirstTabSet()

// The second key of a Ctrl+K chord, as dnSpy binds it: Ctrl+K Ctrl+K toggles, Ctrl+K Ctrl+P and Ctrl+K
// Ctrl+N walk the bookmarks, Ctrl+K Ctrl+L clears them, Ctrl+K Ctrl+E enables or disables the one under
// the caret, and Ctrl+K Ctrl+W opens the window — the same keys Visual Studio uses.
const bookmarkChords: Record<string, () => void> = {
  k: toggleBookmarkAtCaret,
  p: () => stepBookmark(-1),
  n: () => stepBookmark(1),
  l: clearBookmarks,
  e: toggleBookmarkEnabledAtCaret,
  w: showBookmarksWindow,
}

// The kinds dnSpy confirms before deleting, with its own wording (`AskDeleteType` and friends). Every
// other deletable kind — property, event, resource, namespace — is removed without a prompt.
const DELETE_CONFIRMATIONS: Record<string, string> = {
  type: 'There could be code in some assembly that references this type. Are you sure you want to delete the type?',
  method: 'There could be code in some assembly that references this method. Are you sure you want to delete the method?',
  field: 'There could be code in some assembly that references this field. Are you sure you want to delete the field?',
}

// The node kinds the Edit menu offers a Delete command for, and which the Del key therefore removes.
const DELETABLE_KINDS = ['type', 'method', 'field', 'property', 'event', 'namespace', 'resource']

// The node kinds whose Edit command — and Alt+Enter with it — opens a dialog: every one dnSpy has a
// settings command for that the port has built the window of.
const EDITABLE_KINDS = new Set<string>(['type', 'method', 'field', 'property', 'event'])
const isEditableKind = (kind: string): kind is CreatedKind => EDITABLE_KINDS.has(kind)

const loadTheme = (): ThemeName => {
  const saved = localStorage.getItem('dnspy.theme')
  return saved === 'light' || saved === 'dark' || saved === 'hc' || saved === 'blue' ? saved : 'dark'
}

export const App = (): React.JSX.Element => {
  const [model] = useState(loadLayout)
  const [theme, setTheme] = useState<ThemeName>(loadTheme)
  const wordWrap = useAppStore((state) => state.wordWrap)
  const setWordWrap = useAppStore((state) => state.setWordWrap)
  const highlightCurrentLine = useAppStore((state) => state.highlightCurrentLine)
  const setHighlightCurrentLine = useAppStore((state) => state.setHighlightCurrentLine)
  const [fullScreen, setFullScreen] = useState<boolean>(false)
  // dnSpy reads this once at startup and never again; elevation can't change under a running app.
  const [elevated, setElevated] = useState<boolean>(false)
  const [renameNode, setRenameNode] = useState<TreeNode>()
  const [renameNamespaceNode, setRenameNamespaceNode] = useState<TreeNode>()
  const [editMethodNode, setEditMethodNode] = useState<TreeNode>()
  // The create or edit dialog the Edit menu opened, over the node it acts on: `nodeId` is what is being
  // edited, and is left off when a new node is being created in `ownerNodeId` instead.
  const [editNode, setEditNode] = useState<{ kind: CreatedKind, nodeId?: string, ownerNodeId?: string, nested?: boolean }>()
  const [attachDialogOpen, setAttachDialogOpen] = useState(false)
  const [debugProgramDialogOpen, setDebugProgramDialogOpen] = useState(false)
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
  const [optionsDialogCategory, setOptionsDialogCategory] = useState<'environment' | 'decompiler' | 'debugger' | undefined>(undefined)
  const [navigation, setNavigation] = useState<{ items: TreeNode[]; index: number }>({ items: [], index: -1 })
  const [layoutVersion, forceLayoutUpdate] = useState(0)
  const previousWorkspaceId = useRef<string | undefined | null>(null)
  // The tabs from the saved layout name document ids from the run that wrote it, so they are torn down
  // and rebuilt from the restored session instead.
  const startupHandled = useRef(false)
  const visibleToolWindows = useMemo(() => {
    const visible = new Set<string>()
    for (const id of Object.keys(restorableBorderTabs)) {
      if (model.getNodeById(id))
        visible.add(id)
    }
    return visible
  }, [model, layoutVersion])
  // Which document the Edit menu keys off: dnSpy shows its hex and metadata-table groups for the
  // document kind that has focus, and this port's hex/info views are the same two components.
  const activeDocument = useMemo<ActiveDocument>(() => {
    const tab = model.getActiveTabset()?.getSelectedNode()
    if (!(tab instanceof TabNode))
      return null
    const component = tab.getComponent()
    return component === 'document' ? 'code' : component === 'hex' || component === 'module-info' ? component : null
  }, [model, layoutVersion])
  const canShowCode = activeDocument === 'code'
  // When a Ctrl+K chord stops waiting for its second key, as a timestamp so it needs no timer.
  const bookmarkChord = useRef(0)
  const workspaceId = useAppStore((state) => state.workspaceId)
  const backendStatus = useAppStore((state) => state.backendStatus)
  const busy = useAppStore((state) => state.busy)
  const error = useAppStore((state) => state.error)
  const selectedNode = useAppStore((state) => state.selectedNode)
  const modules = useAppStore((state) => state.modules)
  const chooseAndOpen = useAppStore((state) => state.chooseAndOpen)
  const closeWorkspace = useAppStore((state) => state.closeWorkspace)
  const dirty = useAppStore((state) => state.dirty)
  const recentWorkspaces = useAppStore((state) => state.recentWorkspaces)
  const openPaths = useAppStore((state) => state.openPaths)
  const canUndo = useAppStore((state) => state.canUndo)
  const canRedo = useAppStore((state) => state.canRedo)
  const undoEdit = useAppStore((state) => state.undoEdit)
  const redoEdit = useAppStore((state) => state.redoEdit)
  const saveModuleAs = useAppStore((state) => state.saveModuleAs)
  const saveModule = useAppStore((state) => state.saveModule)
  const saveAllModules = useAppStore((state) => state.saveAllModules)
  const reloadAllAssemblies = useAppStore((state) => state.reloadAllAssemblies)
  const sortAssemblies = useAppStore((state) => state.sortAssemblies)
  const saveCode = useAppStore((state) => state.saveCode)
  const replaceResource = useAppStore((state) => state.replaceResource)
  const deleteNode = useAppStore((state) => state.deleteNode)
  const renameNamespace = useAppStore((state) => state.renameNamespace)
  const moveTypesToEmptyNamespace = useAppStore((state) => state.moveTypesToEmptyNamespace)
  const replaceMethodBodyWithStub = useAppStore((state) => state.replaceMethodBodyWithStub)
  const hexTarget = useAppStore((state) => state.hexTarget)
  const hexStatement = useAppStore((state) => state.hexStatement)
  const resolveHexTarget = useAppStore((state) => state.resolveHexTarget)
  const showHexAt = useAppStore((state) => state.showHexAt)
  const hexWriteMethodBody = useAppStore((state) => state.hexWriteMethodBody)
  const hexCopyMethodBody = useAppStore((state) => state.hexCopyMethodBody)
  const hexPasteMethodBody = useAppStore((state) => state.hexPasteMethodBody)
  const roots = useAppStore((state) => state.roots)
  const treeChildren = useAppStore((state) => state.children)
  const treeParents = useAppStore((state) => state.parents)
  const openDocument = useAppStore((state) => state.openDocument)
  const expandNode = useAppStore((state) => state.expandNode)
  const loadChildren = useAppStore((state) => state.loadChildren)
  const selectNode = useAppStore((state) => state.selectNode)
  const setRestoringSession = useAppStore((state) => state.setRestoringSession)
  const setDocumentOrder = useAppStore((state) => state.setDocumentOrder)
  const appendOutput = useAppStore((state) => state.appendOutput)
  const setOpenNodeById = useAppStore((state) => state.setOpenNodeById)
  const setOpenToolWindow = useAppStore((state) => state.setOpenToolWindow)
  const bookmarks = useAppStore((state) => state.bookmarks)
  const setAllBookmarksEnabled = useAppStore((state) => state.setAllBookmarksEnabled)
  const clearBookmarksAction = useAppStore((state) => state.clearBookmarks)
  const analyzeNode = useAppStore((state) => state.analyzeNode)
  const setBackendStatus = useAppStore((state) => state.setBackendStatus)
  const clearError = useAppStore((state) => state.clearError)
  const debugState = useAppStore((state) => state.debugState)
  const stoppedReason = useAppStore((state) => state.stoppedReason)
  const handleDebugEvent = useAppStore((state) => state.handleDebugEvent)
  const continueDebug = useAppStore((state) => state.continueDebug)
  const pauseDebug = useAppStore((state) => state.pauseDebug)
  const stepDebug = useAppStore((state) => state.stepDebug)
  const stopDebug = useAppStore((state) => state.stopDebug)
  const functionBreakpoints = useAppStore((state) => state.functionBreakpoints)
  const lineBreakpoints = useAppStore((state) => state.lineBreakpoints)
  const toggleFunctionBreakpoint = useAppStore((state) => state.toggleFunctionBreakpoint)
  const deleteAllBreakpointsAction = useAppStore((state) => state.deleteAllBreakpoints)
  const setAllFunctionBreakpointsEnabled = useAppStore((state) => state.setAllFunctionBreakpointsEnabled)
  const setAllLineBreakpointsEnabled = useAppStore((state) => state.setAllLineBreakpointsEnabled)
  const { locale, setLanguage, t } = useLanguage()

  // "Toggle Breakpoint" acts on the current item. With the tree focused that item is a method, so the entry still
  // means "break wherever this method starts"; in the editor F9 is handled by Monaco, which knows the cursor line
  // and can therefore set a line breakpoint instead.
  const breakpointTarget = useMemo(
    () => (selectedNode?.kind === 'method' ? methodBreakpointName(selectedNode.description) : undefined),
    [selectedNode],
  )
  const toggleBreakpointHere = (): void => {
    if (breakpointTarget) void toggleFunctionBreakpoint(breakpointTarget)
  }
  const deleteAllBreakpoints = (): void => {
    if (window.confirm(t('Do you want to delete all breakpoints?')))
      void deleteAllBreakpointsAction()
  }

  // dnSpy's "Move Types to Empty Namespace" is offered only when the module already has an empty
  // namespace node for the types to land in; the module's children are loaded whenever one of its
  // namespaces is selectable, so the sibling list is the tree the user is looking at.
  const hasEmptyNamespaceSibling = useMemo(() => {
    if (selectedNode?.kind !== 'namespace')
      return false
    const parentId = treeParents[selectedNode.id]
    const siblings = parentId ? treeChildren[parentId] : undefined
    return siblings?.some((sibling) => sibling.kind === 'namespace' && sibling.label === '-') ?? false
  }, [selectedNode, treeChildren, treeParents])

  const deleteSelected = (): void => {
    if (!selectedNode)
      return
    // dnSpy asks before removing a type, method or field — each of those can be referenced from code
    // that this edit cannot see. Property, event, resource and namespace removals go through unasked.
    const question = DELETE_CONFIRMATIONS[selectedNode.kind]
    if (question && !window.confirm(t(question)))
      return
    void deleteNode(selectedNode).then((deleted) => {
      if (deleted)
        closeDocumentTabsFor(model, selectedNode.id)
    })
  }
  const enableAllBreakpoints = (enabled: boolean): void => {
    void setAllLineBreakpointsEnabled(enabled)
    void setAllFunctionBreakpointsEnabled(enabled)
  }
  const anyBreakpointEnabled = lineBreakpoints.some((breakpoint) => breakpoint.enabled) || functionBreakpoints.some((breakpoint) => breakpoint.enabled)
  const anyBreakpointDisabled = lineBreakpoints.some((breakpoint) => !breakpoint.enabled) || functionBreakpoints.some((breakpoint) => !breakpoint.enabled)

  // The Edit menu's hex entries are built from where the selection points, so the answer is refreshed
  // whenever the selection changes rather than being asked for when the menu opens.
  useEffect(() => {
    void resolveHexTarget(selectedNode)
  }, [selectedNode, resolveHexTarget])

  useEffect(() => {
    const unsubscribe = window.dnSpy.onBackendStatus(setBackendStatus)
    void window.dnSpy.getBackendStatus().then(setBackendStatus)
    return unsubscribe
  }, [setBackendStatus])
  useEffect(() => window.dnSpy.onDebugEvent((event) => { void handleDebugEvent(event) }), [handleDebugEvent])

  useEffect(() => {
    const locals = model.getNodeById('locals')
    const border = locals?.getParent() as { isShowing?: () => boolean; getSelectedNode?: () => { getId(): string } | undefined } | undefined
    if (debugState === 'stopped' && locals && (!border?.isShowing?.() || border.getSelectedNode?.()?.getId() !== 'locals')) {
      model.doAction(Actions.selectTab('locals'))
      forceLayoutUpdate((value) => value + 1)
    }
  }, [debugState, model])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('dnspy.theme', theme)
  }, [theme])

  useEffect(() => {
    let mounted = true
    void window.dnSpy.isFullScreen().then((value) => {
      if (mounted) setFullScreen(value)
    })
    const unsubscribe = window.dnSpy.onFullScreenChange(setFullScreen)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void window.dnSpy.isRunningAsAdministrator().then((value) => {
      if (mounted) setElevated(value)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const names: Record<string, string> = {
      explorer: t('Assembly Explorer'),
      output: t('Output'),
      'csharp-interactive': t('C# Interactive'),
      search: t('Search'),
      analysis: t('Analyzer'),
      locals: t('Locals'),
      watch: t('Watch'),
      callstack: t('Call Stack'),
      breakpoints: t('Breakpoints'),
      bookmarks: t('Bookmarks'),
      threads: t('Threads'),
      modules: t('Modules'),
      start: t('Start'),
    }
    for (const [id, name] of Object.entries(names)) {
      const node = model.getNodeById(id)
      if (node instanceof TabNode && node.getName() !== name)
        model.doAction(Actions.renameTab(id, name))
    }
    localStorage.setItem('dnspy.layout.v1', JSON.stringify(model.toJson()))
    forceLayoutUpdate((value) => value + 1)
  }, [locale, model, t])

  const showBorderTab = (tabId: string): void => {
    const tab = model.getNodeById(tabId)
    if (tab) {
      const border = tab.getParent() as { isShowing?: () => boolean; getSelectedNode?: () => { getId(): string } | undefined } | undefined
      if (!border?.isShowing?.() || border.getSelectedNode?.()?.getId() !== tabId) {
        model.doAction(Actions.selectTab(tabId))
        forceLayoutUpdate((value) => value + 1)
      }
      return
    }
    const spec = restorableBorderTabs[tabId]
    if (!spec) return
    if (!model.getNodeById(spec.borderId)) return
    model.doAction(Actions.addNode({
      type: 'tab',
      id: tabId,
      name: t(spec.name),
      component: spec.component,
      enableClose: true,
    }, spec.borderId, spec.location, -1, true))
    forceLayoutUpdate((value) => value + 1)
  }

  const showCode = async (): Promise<void> => {
    const tab = model.getActiveTabset()?.getSelectedNode()
    if (!(tab instanceof TabNode) || tab.getComponent() !== 'document')
      return
    const documentId = (tab.getConfig() as { documentId?: string } | undefined)?.documentId
    if (!documentId)
      return
    const state = useAppStore.getState()
    if (state.documents[documentId]?.requestedLanguage !== 'cSharp')
      await state.changeDocumentLanguage(documentId, 'cSharp')
    focusDocumentEditor(tab.getId())
  }

  const collapseTreeViewNodes = (): void => useAppStore.getState().collapseTreeViewNodes()

  /** dnSpy's settings command for the selected node — Edit Method... and its Alt+Enter. A node whose
   * dialog has not been built yet has no shortcut, since there is nothing for it to open. */
  const openEditNode = (): void => {
    const node = selectedNode
    if (node !== undefined && isEditableKind(node.kind))
      setEditNode({ kind: node.kind, nodeId: node.id })
  }

  /**
   * The five create commands. A member goes into the type the selection belongs to, which is the selected
   * type itself or the type a selected member hangs off. A type is the one of them with two forms: a
   * nested one goes into that same type, while a top-level one is filed by whoever is selected — a
   * namespace by its own name, a type by the namespace it is already in, and a module by nothing at all.
   * dnSpy reaches the first through the namespace ancestor of the selection and the second through the
   * selected node itself, which is why the owner is picked differently here.
   */
  const createMember = (kind: CreatedKind, nested = false): void => {
    const ownerNodeId = kind === 'type' && !nested ? selectedNode?.id : ownerTypeIdOf(treeParents, selectedNode)
    if (ownerNodeId !== undefined)
      setEditNode({ kind, ownerNodeId, nested })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const editingText = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false
      // The bookmark commands are two-key chords: Ctrl+K arms them and the second key runs one. Monaco
      // binds the same chords while the code editor has focus and stops the event there, so this path
      // is the one that answers when the focus is in the tree, a tool window or the menu bar.
      if (!editingText && !event.shiftKey && !event.altKey && event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        bookmarkChord.current = Date.now() + 2000
        return
      }
      if (!editingText && bookmarkChord.current > Date.now() && event.ctrlKey && !event.shiftKey && !event.altKey) {
        const chord = bookmarkChords[event.key.toLowerCase()]
        if (chord) {
          bookmarkChord.current = 0
          event.preventDefault()
          chord()
          return
        }
      }
      bookmarkChord.current = 0
      if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void chooseAndOpen()
      } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
        // dnSpy's Save All. Save Module... is the one without a gesture, so it moves no other binding.
        event.preventDefault()
        void saveAllModules()
      } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 's') {
        // dnSpy's Save: the active document. A code tab is a document of its own here, and the tab menu
        // advertises this key for its "Save Code..."; with no such tab the command falls to the module.
        const tab = model.getActiveTabset()?.getSelectedNode()
        const config = tab?.getComponent() === 'document'
          ? tab.getConfig() as { documentId?: string } | undefined
          : undefined
        const document = config?.documentId ? useAppStore.getState().documents[config.documentId] : undefined
        if (config?.documentId && document && !document.loading) {
          event.preventDefault()
          void saveCode(config.documentId)
        } else if (!editingText) {
          event.preventDefault()
          void saveModule()
        }
      } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 't') {
        const tab = model.getActiveTabset()?.getSelectedNode()
        if (tab?.getComponent() === 'document') {
          event.preventDefault()
          cloneDocumentTab(tab)
          forceLayoutUpdate((value) => value + 1)
        }
      } else if (event.ctrlKey && !event.shiftKey && event.key === 'F4') {
        const tab = model.getActiveTabset()?.getSelectedNode()
        if (tab?.isCloseable()) {
          event.preventDefault()
          closeDocumentTab(tab)
          forceLayoutUpdate((value) => value + 1)
        }
      } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        collapseTreeViewNodes()
      } else if (event.ctrlKey && event.altKey && (event.code === 'Digit0' || event.code === 'Numpad0')) {
        event.preventDefault()
        void showCode()
      } else if (event.ctrlKey && event.altKey && event.code === 'KeyN') {
        event.preventDefault()
        showBorderTab('csharp-interactive')
      } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'k' && workspaceId) {
        event.preventDefault()
        showBorderTab('search')
      } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f' && activeDocument === 'code') {
        event.preventDefault()
        findInActiveDocumentEditor()
      } else if (event.ctrlKey && event.key.toLowerCase() === 'z' && canUndo && !editingText) {
        event.preventDefault()
        void undoEdit()
      } else if (event.ctrlKey && event.key.toLowerCase() === 'y' && canRedo && !editingText) {
        event.preventDefault()
        void redoEdit()
      } else if (event.altKey && event.key === 'Enter' && !editingText) {
        // dnSpy's Alt+Enter: the settings command of the selected node, which its menu lists beside
        // Edit Method...
        event.preventDefault()
        openEditNode()
      } else if (event.key === 'F2' && selectedNode && !editingText && ['type', 'method', 'field', 'property', 'event'].includes(selectedNode.kind)) {
        event.preventDefault()
        setRenameNode(selectedNode)
      } else if (event.key === 'Delete' && selectedNode && !editingText && DELETABLE_KINDS.includes(selectedNode.kind)) {
        event.preventDefault()
        deleteSelected()
      } else if (event.ctrlKey && event.shiftKey && event.key === 'F9') {
        event.preventDefault()
        deleteAllBreakpoints()
      } else if (event.key === 'F9' && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && !editingText) {
        event.preventDefault()
        toggleBreakpointHere()
      } else if (event.shiftKey && event.key === 'F5' && debugState !== 'inactive' && !editingText) {
        event.preventDefault()
        void stopDebug()
      } else if (event.key === 'F5' && !editingText) {
        event.preventDefault()
        if (debugState === 'stopped') void continueDebug()
        // Upstream's F5 is ContinueOrDebugProgram: with no session it is the Start button, dialog and all.
        else if (debugState === 'inactive') setDebugProgramDialogOpen(true)
      } else if (event.key === 'F10' && debugState === 'stopped' && !editingText) {
        event.preventDefault()
        void stepDebug('next')
      } else if (event.shiftKey && event.key === 'F11' && debugState === 'stopped' && !editingText) {
        event.preventDefault()
        void stepDebug('stepOut')
      } else if (event.key === 'F11' && !event.shiftKey && debugState === 'stopped' && !editingText) {
        event.preventDefault()
        void stepDebug('stepIn')
      } else if (event.key === 'F11' && !event.shiftKey && !editingText) {
        event.preventDefault()
        void window.dnSpy.toggleFullScreen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeDocument, canRedo, canUndo, chooseAndOpen, collapseTreeViewNodes, continueDebug, debugState, deleteAllBreakpoints, deleteSelected, model, openEditNode, redoEdit, saveAllModules, saveCode, saveModule, saveModuleAs, selectedNode, showBorderTab, showCode, stepDebug, stopDebug, toggleBreakpointHere, undoEdit, workspaceId])

  // Closing the workspace's documents is also the first thing a restore does, so the two share it.
  const closeDocumentTabs = (): void => {
    const tabsToClose: string[] = []
    model.visitNodes((node) => {
      if (node instanceof TabNode && ['document', 'hex', 'module-info'].includes(node.getComponent() ?? ''))
        tabsToClose.push(node.getId())
    })
    for (const tabId of tabsToClose)
      model.doAction(Actions.deleteTab(tabId))
  }

  const showStartTab = (): void => {
    const targetTabSet = getTargetDocumentTabSet(model)
    if (!model.getNodeById('start') && targetTabSet)
      model.doAction(Actions.addNode({ type: 'tab', id: 'start', name: t('Start'), component: 'start', enableClose: false }, targetTabSet.getId(), DockLocation.CENTER, -1, true))
  }

  useEffect(() => {
    if (previousWorkspaceId.current === workspaceId)
      return
    previousWorkspaceId.current = workspaceId
    setNavigation({ items: [], index: -1 })
    // A restore opens the workspace itself, and the tabs it puts back are the ones this would otherwise
    // delete a moment later; it clears the stale ones and adds Start where it needs them.
    if (useAppStore.getState().restoringSession)
      return
    closeDocumentTabs()
    showStartTab()
    forceLayoutUpdate((value) => value + 1)
  }, [model, workspaceId, t])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const addDocumentTab = async (node: TreeNode, recordHistory = true, language?: DecompilerLanguage): Promise<void> => {
    if (recordHistory) {
      setNavigation((current) => {
        if (current.items[current.index]?.id === node.id)
          return current
        const items = [...current.items.slice(0, current.index + 1), node].slice(-100)
        return { items, index: items.length - 1 }
      })
    }
    const documentId = await openDocument(node, language)
    const tabId = `doc:${documentId}`
    if (model.getNodeById(tabId)) {
      model.doAction(Actions.selectTab(tabId))
    } else {
      const targetTabSet = getTargetDocumentTabSet(model)
      if (!targetTabSet) return
      model.doAction(Actions.addNode({
        type: 'tab',
        id: tabId,
        name: node.label,
        component: 'document',
        config: { documentId },
      }, targetTabSet.getId(), DockLocation.CENTER, -1, true))
      if (model.getNodeById('start'))
        model.doAction(Actions.deleteTab('start'))
    }
    forceLayoutUpdate((value) => value + 1)
  }

  // Where the previous session comes back. Every node the saved session names is looked up by key —
  // walking down from the roots, materialising each branch on the way, because only the module roots
  // exist after a restart — and whatever no longer resolves is passed over so the rest still restores.
  const restoreSession = async (session: SavedSession): Promise<void> => {
    if (session.paths.length === 0)
      return
    setRestoringSession(true)
    try {
      // The saved layout still holds tabs from the run that wrote it, named by document ids that died
      // with it. They are rebuilt from the session below instead.
      closeDocumentTabs()
      const paths = await window.dnSpy.filterExistingPaths(session.paths)
      if (paths.length < session.paths.length)
        appendOutput(t('{count} file(s) from the previous session are no longer on disk.', { count: session.paths.length - paths.length }))
      if (paths.length === 0) {
        showStartTab()
        forceLayoutUpdate((value) => value + 1)
        return
      }
      await openPaths(paths)
      if (!useAppStore.getState().workspaceId)
        return // openPaths has already reported why
      const byKey = new Map<string, TreeNode>()
      for (const root of useAppStore.getState().roots) {
        if (root.key)
          byKey.set(root.key, root)
      }
      for (const reference of session.nodes) {
        const node = byKey.get(reference.key)
        if (!node)
          continue
        // The list is ordered parents-first, so a node it names has its parent already in the map.
        // Expanding is not a toggle here: the explorer expands every fresh root on its own, and a
        // toggle would close the root it just opened.
        if (reference.expanded)
          await expandNode(node)
        else
          await loadChildren(node)
        for (const child of useAppStore.getState().children[node.id] ?? []) {
          if (child.key)
            byKey.set(child.key, child)
        }
      }
      const selected = session.selectedNode ? byKey.get(session.selectedNode) : undefined
      if (selected)
        selectNode(selected)
      let restoredDocuments = 0
      for (const document of session.documents) {
        const node = byKey.get(document.key)
        if (!node)
          continue
        await addDocumentTab(node, false, document.language)
        restoredDocuments++
      }
      // Opening a document takes the Start tab away, so one only comes back when nothing was restored
      // to take its place.
      if (restoredDocuments === 0)
        showStartTab()
      const active = session.activeDocument ? byKey.get(session.activeDocument) : undefined
      if (active) {
        model.doAction(Actions.selectTab(`doc:${active.id}`))
        forceLayoutUpdate((value) => value + 1)
      }
      appendOutput(t('Restored the previous session.'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendOutput(t('Could not restore the previous session: {message}', { message }))
      showStartTab()
      forceLayoutUpdate((value) => value + 1)
    } finally {
      // Enabled before the flag drops: the change that ends the restore is the one write that captures
      // everything it put back.
      enableSessionPersistence()
      setRestoringSession(false)
    }
  }

  const openNodeId = async (nodeId: string): Promise<void> => {
    if (!workspaceId) return
    try {
      const node = await window.dnSpy.getNode(workspaceId, nodeId)
      await addDocumentTab(node)
    } catch (reason) {
      useAppStore.getState().appendOutput(t('Navigation failed: {message}', { message: reason instanceof Error ? reason.message : String(reason) }))
    }
  }

  // A bookmark restores to a node id that died with its workspace, so it opens by asking for one and
  // reports back whether that worked; the store falls back to looking the module and token up again.
  const openBookmarkTarget = async (nodeId: string): Promise<string | undefined> => {
    if (!workspaceId)
      return undefined
    try {
      const node = await window.dnSpy.getNode(workspaceId, nodeId)
      await addDocumentTab(node)
      return nodeId
    } catch {
      return undefined
    }
  }

  // The store cannot open tabs or tool windows itself, so it calls back into the shell. Handlers are
  // read through a ref because both close over the current workspace and layout.
  const shellCallbacksRef = useRef({ openBookmarkTarget, showBorderTab, restoreSession })
  shellCallbacksRef.current = { openBookmarkTarget, showBorderTab, restoreSession }
  useEffect(() => {
    setOpenNodeById((nodeId) => shellCallbacksRef.current.openBookmarkTarget(nodeId))
    setOpenToolWindow((tabId) => shellCallbacksRef.current.showBorderTab(tabId))
    return () => {
      setOpenNodeById(undefined)
      setOpenToolWindow(undefined)
    }
  }, [setOpenNodeById, setOpenToolWindow])

  // The one place the previous session comes back. It runs once the backend can answer, and puts the
  // assemblies, the branches, the tabs and the selection back before anything else looks at the state.
  // Files named on the command line are opened afterwards, which — because Open appends — grows the
  // restored tree exactly the way the same command behaves in a running window.
  useEffect(() => {
    if (backendStatus.state !== 'ready' || startupHandled.current)
      return
    startupHandled.current = true
    void (async () => {
      const options = await window.dnSpy.getStartupOptions()
      const session = options.noLoadFiles ? undefined : loadSession()
      if (session && session.paths.length > 0) {
        await shellCallbacksRef.current.restoreSession(session)
      } else {
        // Nothing comes back: the tabs the saved layout still holds name documents from a run that is
        // over, so the window starts on a clean page rather than on tabs that lead nowhere.
        closeDocumentTabs()
        showStartTab()
        forceLayoutUpdate((value) => value + 1)
      }
      enableSessionPersistence()
      if (options.initialPaths.length > 0)
        await openPaths(options.initialPaths)
    })()
  }, [backendStatus.state, openPaths])

  const goBack = (): void => {
    if (navigation.index <= 0) return
    const index = navigation.index - 1
    const node = navigation.items[index]
    setNavigation((current) => ({ ...current, index }))
    void addDocumentTab(node, false)
  }

  const goForward = (): void => {
    if (navigation.index >= navigation.items.length - 1) return
    const index = navigation.index + 1
    const node = navigation.items[index]
    setNavigation((current) => ({ ...current, index }))
    void addDocumentTab(node, false)
  }

  const openAnalysis = async (node: TreeNode): Promise<void> => {
    await analyzeNode(node)
    showBorderTab('analysis')
  }

  // A module node and the module a hex command names are the same node id, but a command only has the
  // id, so the tab builder takes the two fields it needs rather than the whole tree node.
  const addSpecialTab = (component: 'hex' | 'module-info', module: { id: string; label: string }): void => {
    const tabId = `${component}:${module.id}`
    if (model.getNodeById(tabId)) {
      model.doAction(Actions.selectTab(tabId))
    } else {
      const targetTabSet = getTargetDocumentTabSet(model)
      if (!targetTabSet) return
      model.doAction(Actions.addNode({
        type: 'tab',
        id: tabId,
        name: component === 'hex' ? `${module.label} [${t('Hex')}]` : `${module.label} [${t('Info')}]`,
        component,
        config: { moduleId: module.id },
      }, targetTabSet.getId(), DockLocation.CENTER, -1, true))
      if (model.getNodeById('start')) model.doAction(Actions.deleteTab('start'))
    }
    forceLayoutUpdate((value) => value + 1)
  }

  // The hex commands name their module by node id, and the tab needs a label with it.
  const moduleTabTarget = (moduleId: string): { id: string; label: string } | undefined => {
    const node = roots.find((root) => root.id === moduleId)
    return node ? { id: node.id, label: node.label } : undefined
  }

  const openHex = (): void => {
    const target = hexTarget ? moduleTabTarget(hexTarget.moduleId) : undefined
    if (target)
      addSpecialTab('hex', target)
  }

  /** Opens the hex tab on the bytes one of the "Show ... in Hex Editor" commands names. */
  const showSelectionInHex = (kind: HexShowKind): void => {
    if (kind === 'statement') {
      const statement = hexStatement
      const target = statement ? moduleTabTarget(statement.moduleId) : undefined
      if (!statement || !target) return
      showHexAt(statement.moduleId, statement.range.offset, statement.range.length)
      addSpecialTab('hex', target)
      return
    }
    const range = !hexTarget ? undefined
      : kind === 'instructions' ? hexTarget.method && { offset: hexTarget.method.codeOffset, length: hexTarget.method.codeSize }
      : kind === 'body' ? hexTarget.method && { offset: hexTarget.method.bodyOffset, length: hexTarget.method.bodySize }
      : kind === 'fieldInitialValue' ? hexTarget.fieldInitialValue
      : hexTarget.resource
    const target = hexTarget ? moduleTabTarget(hexTarget.moduleId) : undefined
    if (!hexTarget || !target || !range) return
    showHexAt(hexTarget.moduleId, range.offset, range.length)
    addSpecialTab('hex', target)
  }

  const closeCurrentWorkspace = (): void => {
    if (!dirty || window.confirm(t('Discard unsaved changes and close the workspace?')))
      void closeWorkspace()
  }

  // dnSpy's restart goes through the ordinary close, so unsaved edits still get their say first;
  // the confirm stands in for that prompt and a "no" leaves the app, and the edits, alone.
  const restartAsAdministrator = (): void => {
    if (!dirty || window.confirm(t('Discard unsaved changes and restart with elevated rights?')))
      void window.dnSpy.restartAsAdministrator()
  }

  const factory = (node: TabNode): React.ReactNode => {
    switch (node.getComponent()) {
      case 'explorer': return <AssemblyExplorer onOpenNode={(item) => void addDocumentTab(item)} onAnalyzeNode={(item) => void openAnalysis(item)} onShowHex={(item) => addSpecialTab('hex', item)} onShowModuleInfo={(item) => addSpecialTab('module-info', item)} />
      case 'document': return <Suspense fallback={<div className="loading-state">{t('Loading')}</div>}><DocumentView documentId={(node.getConfig() as { documentId: string }).documentId} viewId={node.getId()} theme={theme} onNavigate={(targetNodeId) => void openNodeId(targetNodeId)} /></Suspense>
      case 'output': return <OutputPane />
      case 'csharp-interactive': return <CSharpInteractive theme={theme} />
      case 'search': return <SearchPane onOpenNodeId={(nodeId) => void openNodeId(nodeId)} />
      case 'analysis': return <AnalysisPane onOpenNodeId={(nodeId) => void openNodeId(nodeId)} />
      case 'hex': return <HexView moduleId={(node.getConfig() as { moduleId: string }).moduleId} />
      case 'module-info': return <ModuleInfoView moduleId={(node.getConfig() as { moduleId: string }).moduleId} />
      case 'locals': return <LocalsPane />
      case 'watch': return <WatchPane />
      case 'callstack': return <CallStackPane />
      case 'breakpoints': return <BreakpointsPane />
      case 'bookmarks': return <BookmarksPane />
      case 'threads': return <ThreadsPane />
      case 'modules': return <ModulesPane />
      case 'start': return (
        <div className="start-view">
          <button className="command-button" disabled={backendStatus.state !== 'ready'} onClick={() => void chooseAndOpen()}>
            <FolderOpen size={16} /> {t('Open Assembly')}
          </button>
        </div>
      )
      default: return null
    }
  }

  return (
    <div className="app-shell">
      <MenuBar
        hasWorkspace={Boolean(workspaceId)}
        hasModule={modules.length > 0}
        selectionKind={selectedNode?.kind}
        selectionLabel={selectedNode?.label}
        hasEmptyNamespaceSibling={hasEmptyNamespaceSibling}
        activeDocument={activeDocument}
        canShowCode={canShowCode}
        debugAvailable={backendStatus.capabilities?.['debug.coreclr.launch'] === true}
        debugState={debugState}
        recentWorkspaces={recentWorkspaces}
        canUndo={canUndo}
        canRedo={canRedo}
        theme={theme}
        onOpen={() => void chooseAndOpen()}
        onOpenRecent={(paths) => void openPaths(paths)}
        onCloseAll={closeCurrentWorkspace}
        dirty={dirty}
        onSave={() => void saveModule()}
        onSaveModule={() => void saveModuleAs()}
        onSaveAll={() => void saveAllModules()}
        onReloadAll={() => void reloadAllAssemblies()}
        onSortAssemblies={() => void sortAssemblies()}
        onFind={() => { findInActiveDocumentEditor() }}
        onSearchAssemblies={() => showBorderTab('search')}
        onUndo={() => void undoEdit()}
        onRedo={() => void redoEdit()}
        onEditMethodBody={() => { if (selectedNode?.kind === 'method') setEditMethodNode(selectedNode) }}
        onEditResource={() => { if (selectedNode) void replaceResource(selectedNode) }}
        onDelete={deleteSelected}
        onRenameNamespace={() => { if (selectedNode?.kind === 'namespace') setRenameNamespaceNode(selectedNode) }}
        onMoveTypesToEmptyNamespace={() => { if (selectedNode?.kind === 'namespace') void moveTypesToEmptyNamespace(selectedNode) }}
        onReplaceMethodBodyWithStub={() => { if (selectedNode?.kind === 'method') void replaceMethodBodyWithStub(selectedNode) }}
        hexTarget={hexTarget}
        hexStatement={hexStatement}
        onOpenHex={openHex}
        onShowHexAt={showSelectionInHex}
        onHexWriteBody={(kind) => void hexWriteMethodBody(kind)}
        onHexCopyBody={() => void hexCopyMethodBody()}
        onHexPasteBody={() => void hexPasteMethodBody()}
        onCreateMember={createMember}
        onEditNode={openEditNode}
        onShowCode={() => void showCode()}
        onCollapseTreeViewNodes={collapseTreeViewNodes}
        onStartDebug={() => setDebugProgramDialogOpen(true)}
        onAttachDebug={() => setAttachDialogOpen(true)}
        onContinueDebug={() => void continueDebug()}
        onPauseDebug={() => void pauseDebug()}
        onStepIn={() => void stepDebug('stepIn')}
        onStepOver={() => void stepDebug('next')}
        onStepOut={() => void stepDebug('stepOut')}
        onStopDebug={() => void stopDebug()}
        canToggleBreakpoint={Boolean(breakpointTarget)}
        hasFunctionBreakpoints={lineBreakpoints.length > 0 || functionBreakpoints.length > 0}
        canEnableAllBreakpoints={anyBreakpointDisabled}
        canDisableAllBreakpoints={anyBreakpointEnabled}
        onToggleBreakpoint={toggleBreakpointHere}
        onDeleteAllBreakpoints={deleteAllBreakpoints}
        onEnableAllBreakpoints={() => enableAllBreakpoints(true)}
        onDisableAllBreakpoints={() => enableAllBreakpoints(false)}
        bookmarksCount={bookmarks.length}
        canEnableAllBookmarks={bookmarks.some((bookmark) => !bookmark.enabled)}
        canDisableAllBookmarks={bookmarks.some((bookmark) => bookmark.enabled)}
        onShowBookmarks={showBookmarksWindow}
        onToggleBookmark={toggleBookmarkAtCaret}
        onEnableBookmark={toggleBookmarkEnabledAtCaret}
        onEnableAllBookmarks={() => setAllBookmarksEnabled(true)}
        onDisableAllBookmarks={() => setAllBookmarksEnabled(false)}
        onPreviousBookmark={() => stepBookmark(-1)}
        onNextBookmark={() => stepBookmark(1)}
        onPreviousBookmarkWithSameLabel={() => stepBookmark(-1, 'label')}
        onNextBookmarkWithSameLabel={() => stepBookmark(1, 'label')}
        onPreviousBookmarkInDocument={() => stepBookmark(-1, 'document')}
        onNextBookmarkInDocument={() => stepBookmark(1, 'document')}
        onClearBookmarks={clearBookmarks}
        onClearBookmarksInDocument={clearBookmarksInDocument}
        onShowExplorer={() => showBorderTab('explorer')}
        onShowOutput={() => showBorderTab('output')}
        onShowCSharpInteractive={() => showBorderTab('csharp-interactive')}
        onShowLocals={() => showBorderTab('locals')}
        onShowWatch={() => showBorderTab('watch')}
        onShowCallStack={() => showBorderTab('callstack')}
        onShowBreakpoints={() => showBorderTab('breakpoints')}
        onShowThreads={() => showBorderTab('threads')}
        onShowModules={() => showBorderTab('modules')}
        onShowModuleBreakpoints={() => undefined}
        onShowExceptionSettings={() => undefined}
        onShowAutos={() => undefined}
        onShowStaticFields={() => undefined}
        onShowProcesses={() => undefined}
        onShowMemory={() => undefined}
        onShowDisassembly={() => undefined}
        visibleToolWindows={visibleToolWindows}
        onTheme={setTheme}
        wordWrap={wordWrap}
        highlightCurrentLine={highlightCurrentLine}
        fullScreen={fullScreen}
        elevated={elevated}
        onToggleWordWrap={() => setWordWrap(!wordWrap)}
        onToggleHighlightCurrentLine={() => setHighlightCurrentLine(!highlightCurrentLine)}
        onToggleFullScreen={() => void window.dnSpy.toggleFullScreen()}
        onSetLanguage={setLanguage}
        onAbout={() => setAboutDialogOpen(true)}
        onRestartAsAdministrator={restartAsAdministrator}
        onQuit={() => void window.dnSpy.quit()}
        onShowOptions={(category) => setOptionsDialogCategory(category ?? 'environment')}
      />
      <ToolBar
        hasWorkspace={Boolean(workspaceId)} busy={busy} onOpen={() => void chooseAndOpen()} onSave={() => void saveModuleAs()} onSearch={() => showBorderTab('search')}
        canGoBack={navigation.index > 0} canGoForward={navigation.index >= 0 && navigation.index < navigation.items.length - 1} onBack={goBack} onForward={goForward}
        debugAvailable={backendStatus.capabilities?.['debug.coreclr.launch'] === true} debugState={debugState}
        onStart={() => setDebugProgramDialogOpen(true)} onContinue={() => void continueDebug()} onPause={() => void pauseDebug()}
        onStep={() => void stepDebug('next')} onStop={() => void stopDebug()}
      />
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
          <button className="icon-button" aria-label={t('Dismiss')} onClick={clearError}><X size={14} /></button>
        </div>
      )}
      <main className="workspace-host">
        <Layout
          model={model}
          factory={factory}
          onModelChange={(nextModel) => {
            localStorage.setItem('dnspy.layout.v1', JSON.stringify(nextModel.toJson()))
            // Every layout change comes through here, which makes it the one place that knows the tab
            // order — and the tab order is part of the session the next run restores.
            const { order, active } = orderedDocumentKeys(nextModel)
            setDocumentOrder(order, active)
            forceLayoutUpdate((value) => value + 1)
          }}
          onContextMenu={(node, event) => {
            if (!(node instanceof TabNode)) return
            showDocumentTabContextMenu(node, event, {
              t,
              canSave: (tab) => {
                if (tab.getComponent() !== 'document') return false
                const config = tab.getConfig() as { documentId?: string } | undefined
                const state = useAppStore.getState()
                const document = config?.documentId ? state.documents[config.documentId] : undefined
                return Boolean(document && !document.loading && !state.busy)
              },
              canClone: (tab) => tab.getComponent() === 'document',
              onSave: (tab) => {
                const config = tab.getConfig() as { documentId?: string } | undefined
                if (config?.documentId) void saveCode(config.documentId)
              },
              onModelChanged: () => forceLayoutUpdate((value) => value + 1),
            })
          }}
          i18nTranslator={(key) => t(I18nLabelDefaults[key] ?? key)}
        />
      </main>
      <footer className="status-bar">
        <span className={`status-indicator status-${backendStatus.state}`} />
        <span>{backendStatus.state === 'ready' ? t('Ready') : backendStatus.message ?? t(backendStatus.state)}</span>
        <span className="status-spacer" />
        {selectedNode && <span title={selectedNode.description}>{selectedNode.kind === 'referencesgroup' ? t('Assembly References') : selectedNode.kind === 'resourcesgroup' ? t('Resources') : selectedNode.label}</span>}
        {workspaceId && <span>{t('Workspace')}</span>}
        {dirty && <span className="dirty-indicator">{t('Modified')}</span>}
        {debugState !== 'inactive' && <span>{debugState === 'stopped' ? t('Stopped: {reason}', { reason: t(stoppedReason ?? 'unknown') }) : t(debugState)}</span>}
      </footer>
      {renameNode && <RenameDialog node={renameNode} onClose={() => setRenameNode(undefined)} />}
      {renameNamespaceNode && <RenameNamespaceDialog node={renameNamespaceNode} onClose={() => setRenameNamespaceNode(undefined)} />}
      {editMethodNode && <MethodBodyEditor node={editMethodNode} onClose={() => setEditMethodNode(undefined)} />}
      {editNode && workspaceId && (
        <NodeOptionsDialog
          key={`${editNode.kind}:${editNode.nodeId ?? editNode.ownerNodeId}:${editNode.nested === true}`}
          workspaceId={workspaceId}
          kind={editNode.kind}
          nodeId={editNode.nodeId}
          ownerNodeId={editNode.ownerNodeId}
          nested={editNode.nested}
          onClose={() => setEditNode(undefined)}
        />
      )}
      {attachDialogOpen && <AttachDialog onClose={() => setAttachDialogOpen(false)} />}
      {debugProgramDialogOpen && <DebugProgramDialog onClose={() => setDebugProgramDialogOpen(false)} />}
      {aboutDialogOpen && <AboutDialog onClose={() => setAboutDialogOpen(false)} />}
      {optionsDialogCategory !== undefined && (
        <OptionsDialog initialCategory={optionsDialogCategory} onClose={() => setOptionsDialogCategory(undefined)} />
      )}
    </div>
  )
}
