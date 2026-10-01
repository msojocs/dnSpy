import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Actions, DockLocation, I18nLabelDefaults, Layout, Model, TabNode, type IJsonModel } from 'flexlayout-react'
import { AlertCircle, FolderOpen, X } from 'lucide-react'
import type { TreeNode } from '../../shared/protocol'
import { useAppStore } from './app-store'
import { AssemblyExplorer } from './components/AssemblyExplorer'
import { MenuBar, type ThemeName } from './components/MenuBar'
import { ToolBar } from './components/ToolBar'
import { AnalysisPane, DebugPlaceholder, OutputPane, SearchPane } from './components/ToolWindows'
import { MethodBodyEditor, RenameDialog } from './components/EditDialogs'
import { HexView, ModuleInfoView } from './components/SpecialDocuments'
import { BreakpointsPane, CallStackPane, LocalsPane, ModulesPane, ThreadsPane, WatchPane } from './components/DebugToolWindows'
import { AttachDialog } from './components/AttachDialog'
import { AboutDialog } from './components/AboutDialog'
import { cloneDocumentTab, closeDocumentTab, showDocumentTabContextMenu } from './components/DocumentTabContextMenu'
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
        { type: 'tab', id: 'output', name: translate('Output'), component: 'output', enableClose: false },
        { type: 'tab', id: 'search', name: translate('Search'), component: 'search', enableClose: false },
        { type: 'tab', id: 'analysis', name: translate('Analyzer'), component: 'analysis', enableClose: false },
        { type: 'tab', id: 'locals', name: translate('Locals'), component: 'locals', enableClose: false },
        { type: 'tab', id: 'watch', name: translate('Watch'), component: 'watch', enableClose: false },
        { type: 'tab', id: 'callstack', name: translate('Call Stack'), component: 'callstack', enableClose: false },
        { type: 'tab', id: 'breakpoints', name: translate('Breakpoints'), component: 'breakpoints', enableClose: false },
        { type: 'tab', id: 'threads', name: translate('Threads'), component: 'threads', enableClose: false },
        { type: 'tab', id: 'modules', name: translate('Modules'), component: 'modules', enableClose: false },
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

const loadLayout = (): Model => {
  try {
    const saved = localStorage.getItem('dnspy.layout.v1')
    const model = Model.fromJson(saved ? JSON.parse(saved) as IJsonModel : createDefaultLayout())
    if (!model.getFirstTabSet())
      return Model.fromJson(createDefaultLayout())
    model.doAction(Actions.updateModelAttributes({ tabSetEnableDeleteWhenEmpty: true }))
    return model
  } catch {
    return Model.fromJson(createDefaultLayout())
  }
}

const getTargetDocumentTabSet = (model: Model) => model.getActiveTabset() ?? model.getFirstTabSet()

const loadTheme = (): ThemeName => {
  const saved = localStorage.getItem('dnspy.theme')
  return saved === 'light' || saved === 'dark' || saved === 'hc' || saved === 'blue' ? saved : 'dark'
}

export const App = (): React.JSX.Element => {
  const [model] = useState(loadLayout)
  const [theme, setTheme] = useState<ThemeName>(loadTheme)
  const [renameNode, setRenameNode] = useState<TreeNode>()
  const [editMethodNode, setEditMethodNode] = useState<TreeNode>()
  const [attachDialogOpen, setAttachDialogOpen] = useState(false)
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
  const [navigation, setNavigation] = useState<{ items: TreeNode[]; index: number }>({ items: [], index: -1 })
  const [, forceLayoutUpdate] = useState(0)
  const previousWorkspaceId = useRef<string | undefined | null>(null)
  const initialPathsHandled = useRef(false)
  const workspaceId = useAppStore((state) => state.workspaceId)
  const backendStatus = useAppStore((state) => state.backendStatus)
  const busy = useAppStore((state) => state.busy)
  const error = useAppStore((state) => state.error)
  const selectedNode = useAppStore((state) => state.selectedNode)
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
  const saveCode = useAppStore((state) => state.saveCode)
  const replaceResource = useAppStore((state) => state.replaceResource)
  const openDocument = useAppStore((state) => state.openDocument)
  const analyzeNode = useAppStore((state) => state.analyzeNode)
  const setBackendStatus = useAppStore((state) => state.setBackendStatus)
  const clearError = useAppStore((state) => state.clearError)
  const debugState = useAppStore((state) => state.debugState)
  const stoppedReason = useAppStore((state) => state.stoppedReason)
  const launchDebug = useAppStore((state) => state.launchDebug)
  const handleDebugEvent = useAppStore((state) => state.handleDebugEvent)
  const continueDebug = useAppStore((state) => state.continueDebug)
  const pauseDebug = useAppStore((state) => state.pauseDebug)
  const stepDebug = useAppStore((state) => state.stepDebug)
  const stopDebug = useAppStore((state) => state.stopDebug)
  const { locale, t } = useLanguage()

  useEffect(() => {
    const unsubscribe = window.dnSpy.onBackendStatus(setBackendStatus)
    void window.dnSpy.getBackendStatus().then(setBackendStatus)
    return unsubscribe
  }, [setBackendStatus])
  useEffect(() => {
    if (backendStatus.state !== 'ready' || initialPathsHandled.current)
      return
    initialPathsHandled.current = true
    void window.dnSpy.getInitialPaths().then((paths) => {
      if (paths.length > 0)
        void openPaths(paths)
    })
  }, [backendStatus.state, openPaths])
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
    const names: Record<string, string> = {
      explorer: t('Assembly Explorer'),
      output: t('Output'),
      search: t('Search'),
      analysis: t('Analyzer'),
      locals: t('Locals'),
      watch: t('Watch'),
      callstack: t('Call Stack'),
      breakpoints: t('Breakpoints'),
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const editingText = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false
      if (event.ctrlKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void chooseAndOpen()
      } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveModuleAs()
      } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 's') {
        const tab = model.getActiveTabset()?.getSelectedNode()
        const config = tab?.getComponent() === 'document'
          ? tab.getConfig() as { documentId?: string } | undefined
          : undefined
        const document = config?.documentId ? useAppStore.getState().documents[config.documentId] : undefined
        if (config?.documentId && document && !document.loading) {
          event.preventDefault()
          void saveCode(config.documentId)
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
      } else if (event.ctrlKey && event.key.toLowerCase() === 'f' && workspaceId) {
        event.preventDefault()
        model.doAction(Actions.selectTab('search'))
        forceLayoutUpdate((value) => value + 1)
      } else if (event.ctrlKey && event.key.toLowerCase() === 'z' && canUndo && !editingText) {
        event.preventDefault()
        void undoEdit()
      } else if (event.ctrlKey && event.key.toLowerCase() === 'y' && canRedo && !editingText) {
        event.preventDefault()
        void redoEdit()
      } else if (event.key === 'F2' && selectedNode && !editingText && ['type', 'method', 'field', 'property', 'event'].includes(selectedNode.kind)) {
        event.preventDefault()
        setRenameNode(selectedNode)
      } else if (event.shiftKey && event.key === 'F5' && debugState !== 'inactive' && !editingText) {
        event.preventDefault()
        void stopDebug()
      } else if (event.key === 'F5' && !editingText) {
        event.preventDefault()
        if (debugState === 'stopped') void continueDebug()
        else if (debugState === 'inactive') void launchDebug()
      } else if (event.key === 'F10' && debugState === 'stopped' && !editingText) {
        event.preventDefault()
        void stepDebug('next')
      } else if (event.key === 'F11' && debugState === 'stopped' && !editingText) {
        event.preventDefault()
        void stepDebug('stepIn')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canRedo, canUndo, chooseAndOpen, continueDebug, debugState, launchDebug, model, redoEdit, saveCode, saveModuleAs, selectedNode, stepDebug, stopDebug, undoEdit, workspaceId])

  useEffect(() => {
    if (previousWorkspaceId.current === workspaceId)
      return
    previousWorkspaceId.current = workspaceId
    setNavigation({ items: [], index: -1 })
    const tabsToClose: string[] = []
    model.visitNodes((node) => {
      if (node instanceof TabNode && ['document', 'hex', 'module-info'].includes(node.getComponent() ?? ''))
        tabsToClose.push(node.getId())
    })
    for (const tabId of tabsToClose)
      model.doAction(Actions.deleteTab(tabId))
    const targetTabSet = getTargetDocumentTabSet(model)
    if (!model.getNodeById('start') && targetTabSet) {
      model.doAction(Actions.addNode({ type: 'tab', id: 'start', name: t('Start'), component: 'start', enableClose: false }, targetTabSet.getId(), DockLocation.CENTER, -1, true))
    }
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

  const addDocumentTab = async (node: TreeNode, recordHistory = true): Promise<void> => {
    if (recordHistory) {
      setNavigation((current) => {
        if (current.items[current.index]?.id === node.id)
          return current
        const items = [...current.items.slice(0, current.index + 1), node].slice(-100)
        return { items, index: items.length - 1 }
      })
    }
    const documentId = await openDocument(node)
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

  const openNodeId = async (nodeId: string): Promise<void> => {
    if (!workspaceId) return
    try {
      const node = await window.dnSpy.getNode(workspaceId, nodeId)
      await addDocumentTab(node)
    } catch (reason) {
      useAppStore.getState().appendOutput(t('Navigation failed: {message}', { message: reason instanceof Error ? reason.message : String(reason) }))
    }
  }

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

  const showBorderTab = (tabId: string): void => {
    const tab = model.getNodeById(tabId)
    const border = tab?.getParent() as { isShowing?: () => boolean; getSelectedNode?: () => { getId(): string } | undefined } | undefined
    if (tab && (!border?.isShowing?.() || border.getSelectedNode?.()?.getId() !== tabId)) {
      model.doAction(Actions.selectTab(tabId))
      forceLayoutUpdate((value) => value + 1)
    }
  }

  const selectedModule = selectedNode?.kind === 'module'
    ? selectedNode
    : undefined

  const addSpecialTab = (component: 'hex' | 'module-info'): void => {
    const module = selectedModule
    if (!module) return
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

  const closeCurrentWorkspace = (): void => {
    if (!dirty || window.confirm(t('Discard unsaved changes and close the workspace?')))
      void closeWorkspace()
  }

  const factory = (node: TabNode): React.ReactNode => {
    switch (node.getComponent()) {
      case 'explorer': return <AssemblyExplorer onOpenNode={(item) => void addDocumentTab(item)} onAnalyzeNode={(item) => void openAnalysis(item)} />
      case 'document': return <Suspense fallback={<div className="loading-state">{t('Loading')}</div>}><DocumentView documentId={(node.getConfig() as { documentId: string }).documentId} viewId={node.getId()} theme={theme} onNavigate={(targetNodeId) => void openNodeId(targetNodeId)} /></Suspense>
      case 'output': return <OutputPane />
      case 'search': return <SearchPane onOpenNodeId={(nodeId) => void openNodeId(nodeId)} />
      case 'analysis': return <AnalysisPane onOpenNodeId={(nodeId) => void openNodeId(nodeId)} />
      case 'hex': return <HexView moduleId={(node.getConfig() as { moduleId: string }).moduleId} />
      case 'module-info': return <ModuleInfoView moduleId={(node.getConfig() as { moduleId: string }).moduleId} />
      case 'locals': return <LocalsPane />
      case 'watch': return <WatchPane />
      case 'callstack': return <CallStackPane />
      case 'breakpoints': return <BreakpointsPane />
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
        canRename={Boolean(selectedNode && ['type', 'method', 'field', 'property', 'event'].includes(selectedNode.kind))}
        canEditMethod={selectedNode?.kind === 'method'}
        canReplaceResource={selectedNode?.kind === 'resource'}
        canInspectModule={Boolean(selectedModule)}
        debugAvailable={backendStatus.capabilities?.['debug.coreclr.launch'] === true}
        debugState={debugState}
        recentWorkspaces={recentWorkspaces}
        canUndo={canUndo}
        canRedo={canRedo}
        theme={theme}
        onOpen={() => void chooseAndOpen()}
        onOpenRecent={(paths) => void openPaths(paths)}
        onClose={closeCurrentWorkspace}
        onSave={() => void saveModuleAs()}
        onFind={() => showBorderTab('search')}
        onUndo={() => void undoEdit()}
        onRedo={() => void redoEdit()}
        onRename={() => { if (selectedNode) setRenameNode(selectedNode) }}
        onEditMethod={() => { if (selectedNode?.kind === 'method') setEditMethodNode(selectedNode) }}
        onReplaceResource={() => { if (selectedNode) void replaceResource(selectedNode) }}
        onHex={() => addSpecialTab('hex')}
        onModuleInfo={() => addSpecialTab('module-info')}
        onStartDebug={() => void launchDebug()}
        onAttachDebug={() => setAttachDialogOpen(true)}
        onContinueDebug={() => void continueDebug()}
        onPauseDebug={() => void pauseDebug()}
        onStepIn={() => void stepDebug('stepIn')}
        onStepOver={() => void stepDebug('next')}
        onStopDebug={() => void stopDebug()}
        onShowExplorer={() => showBorderTab('explorer')}
        onShowOutput={() => showBorderTab('output')}
        onShowSearch={() => showBorderTab('search')}
        onTheme={setTheme}
        onAbout={() => setAboutDialogOpen(true)}
        onQuit={() => void window.dnSpy.quit()}
      />
      <ToolBar
        hasWorkspace={Boolean(workspaceId)} busy={busy} onOpen={() => void chooseAndOpen()} onSave={() => void saveModuleAs()} onSearch={() => showBorderTab('search')}
        canGoBack={navigation.index > 0} canGoForward={navigation.index >= 0 && navigation.index < navigation.items.length - 1} onBack={goBack} onForward={goForward}
        debugAvailable={backendStatus.capabilities?.['debug.coreclr.launch'] === true} debugState={debugState}
        onStart={() => void launchDebug()} onContinue={() => void continueDebug()} onPause={() => void pauseDebug()}
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
      {editMethodNode && <MethodBodyEditor node={editMethodNode} onClose={() => setEditMethodNode(undefined)} />}
      {attachDialogOpen && <AttachDialog onClose={() => setAttachDialogOpen(false)} />}
      {aboutDialogOpen && <AboutDialog onClose={() => setAboutDialogOpen(false)} />}
    </div>
  )
}
