import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BackendClient } from './backend-client'
import type { BackendStatus, UiLocale } from '../shared/protocol'

let mainWindow: BrowserWindow | undefined
let backend: BackendClient | undefined
let lastBackendStatus: BackendStatus = { state: 'starting' }
let uiLocale: UiLocale = 'en'
const initialPaths = parseInitialPaths(process.argv)

const nativeMessages = {
  'zh-CN': {
    openAssembly: '打开程序集',
    dotNetAssemblies: '.NET 程序集',
    allFiles: '所有文件',
    replaceResource: '替换嵌入的资源',
    resourceTooLarge: '资源文件不能超过 64 MiB。',
    saveModuleAs: '模块另存为',
    saveCode: '保存代码',
    codeFiles: '代码文件',
    selectDebugTarget: '选择要调试的 .NET 程序',
    dotNetPrograms: '.NET 程序',
  },
  en: {
    openAssembly: 'Open Assembly',
    dotNetAssemblies: '.NET Assemblies',
    allFiles: 'All Files',
    replaceResource: 'Replace Embedded Resource',
    resourceTooLarge: 'Resource files are limited to 64 MiB.',
    saveModuleAs: 'Save Module As',
    saveCode: 'Save Code',
    codeFiles: 'Code Files',
    selectDebugTarget: 'Select .NET Program to Debug',
    dotNetPrograms: '.NET Programs',
  },
} as const

const nativeText = () => nativeMessages[uiLocale]

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
  },
}])

const sendBackendStatus = (status: BackendStatus): void => {
  lastBackendStatus = status
  mainWindow?.webContents.send('backend:status', status)
}

const sendBackendNotification = (method: string, parameters: unknown): void => {
  if (method === 'debug/event')
    mainWindow?.webContents.send('debug:event', parameters)
}

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    title: 'dnSpy',
    width: 1000,
    height: 600,
    minWidth: 640,
    minHeight: 400,
    show: false,
    frame: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.webContents.send('backend:status', lastBackendStatus)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[renderer load failed]', { errorCode, errorDescription, validatedURL })
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer process gone]', details)
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (url !== current)
      event.preventDefault()
  })
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
  const sendMaximizedState = (): void => {
    mainWindow?.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', sendMaximizedState)
  mainWindow.on('unmaximize', sendMaximizedState)

  if (process.env.ELECTRON_RENDERER_URL)
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else
    void mainWindow.loadURL('app://dnspy/index.html')
}

const registerAppProtocol = (): void => {
  const rendererRoot = path.resolve(__dirname, '../renderer')
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url)
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
      const requestedPath = path.resolve(rendererRoot, relativePath)
      if (requestedPath !== rendererRoot && !requestedPath.startsWith(`${rendererRoot}${path.sep}`))
        return new Response('Forbidden', { status: 403 })
      const contents = await readFile(requestedPath)
      return new Response(contents, {
        headers: { 'Content-Type': contentTypeFor(requestedPath) },
      })
    } catch (error) {
      console.error('[app protocol]', error)
      return new Response('Not found', { status: 404 })
    }
  })
}

const contentTypeFor = (filePath: string): string => {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.svg': return 'image/svg+xml'
    case '.ttf': return 'font/ttf'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

function parseInitialPaths(args: string[]): string[] {
  const paths: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--open' && index + 1 < args.length)
      paths.push(path.resolve(args[++index]))
  }
  return paths
}

const requireBackend = (): BackendClient => {
  if (!backend)
    throw new Error('The backend is not available.')
  return backend
}

const registerIpc = (): void => {
  ipcMain.handle('dialog:openAssemblies', async () => {
    if (!app.isPackaged && process.env.DNSPY_E2E_ASSEMBLY)
      return process.env.DNSPY_E2E_ASSEMBLY.split(path.delimiter).filter(Boolean)
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: nativeText().openAssembly,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: nativeText().dotNetAssemblies, extensions: ['dll', 'exe', 'netmodule', 'winmd'] },
        { name: nativeText().allFiles, extensions: ['*'] },
      ],
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('workspace:open', (_event, paths: string[]) => requireBackend().invoke('workspace/open', { paths }))
  ipcMain.handle('workspace:close', (_event, workspaceId: string) => requireBackend().invoke('workspace/close', { workspaceId }))
  ipcMain.handle('tree:roots', (_event, workspaceId: string) => requireBackend().invoke('tree/getRoots', { workspaceId }))
  ipcMain.handle('tree:children', (_event, workspaceId: string, nodeId: string) => requireBackend().invoke('tree/getChildren', { workspaceId, nodeId }))
  ipcMain.handle('tree:node', (_event, workspaceId: string, nodeId: string) => requireBackend().invoke('tree/getNode', { workspaceId, nodeId }))
  ipcMain.handle('document:decompile', (_event, workspaceId: string, nodeId: string, language: string) => requireBackend().invoke('document/decompile', { workspaceId, nodeId, language }))
  ipcMain.handle('search:run', (_event, workspaceId: string, query: string, kinds?: string[]) => requireBackend().invoke('search/run', { workspaceId, query, kinds }))
  ipcMain.handle('analyze:references', (_event, workspaceId: string, nodeId: string) => requireBackend().invoke('analyze/references', { workspaceId, nodeId }))
  ipcMain.handle('hex:length', (_event, workspaceId: string, moduleId: string) => requireBackend().invoke('hex/getLength', { workspaceId, moduleId }))
  ipcMain.handle('hex:read', (_event, workspaceId: string, moduleId: string, offset: number, count: number) => requireBackend().invoke('hex/readRange', { workspaceId, moduleId, offset, count }))
  ipcMain.handle('module:info', (_event, workspaceId: string, moduleId: string) => requireBackend().invoke('module/getInfo', { workspaceId, moduleId }))
  ipcMain.handle('edit:begin', (_event, workspaceId: string) => requireBackend().invoke('edit/begin', { workspaceId }))
  ipcMain.handle('edit:getMethodBody', (_event, workspaceId: string, methodNodeId: string) => requireBackend().invoke('edit/getMethodBody', { workspaceId, methodNodeId }))
  ipcMain.handle('edit:rename', (_event, workspaceId: string, transactionId: string, nodeId: string, newName: string) => requireBackend().invoke('edit/rename', { workspaceId, transactionId, nodeId, newName }))
  ipcMain.handle('edit:replaceMethodBody', (_event, workspaceId: string, transactionId: string, methodNodeId: string, body: { maxStack: number; initLocals: boolean; instructions: unknown[] }, clearExceptionHandlers: boolean) => requireBackend().invoke('edit/replaceMethodBody', {
    workspaceId,
    transactionId,
    methodNodeId,
    instructions: body.instructions,
    maxStack: body.maxStack,
    initLocals: body.initLocals,
    clearExceptionHandlers,
  }))
  ipcMain.handle('edit:replaceResourceFromFile', async (_event, workspaceId: string, transactionId: string, resourceNodeId: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: nativeText().replaceResource,
      properties: ['openFile'],
      filters: [{ name: nativeText().allFiles, extensions: ['*'] }],
    })
    if (result.canceled || result.filePaths.length === 0)
      return false
    const data = await readFile(result.filePaths[0])
    if (data.length > 64 * 1024 * 1024)
      throw new Error(nativeText().resourceTooLarge)
    await requireBackend().invoke('edit/replaceResource', {
      workspaceId,
      transactionId,
      resourceNodeId,
      base64Data: data.toString('base64'),
    })
    return true
  })
  ipcMain.handle('edit:commit', (_event, workspaceId: string, transactionId: string) => requireBackend().invoke('edit/commit', { workspaceId, transactionId }))
  ipcMain.handle('edit:rollback', (_event, workspaceId: string, transactionId: string) => requireBackend().invoke('edit/rollback', { workspaceId, transactionId }))
  ipcMain.handle('edit:undo', (_event, workspaceId: string) => requireBackend().invoke('edit/undo', { workspaceId }))
  ipcMain.handle('edit:redo', (_event, workspaceId: string) => requireBackend().invoke('edit/redo', { workspaceId }))
  ipcMain.handle('module:saveAs', async (_event, workspaceId: string, moduleId: string, suggestedName: string) => {
    if (!app.isPackaged && process.env.DNSPY_E2E_SAVE_PATH) {
      return requireBackend().invoke('module/saveAs', {
        workspaceId,
        moduleId,
        destinationPath: process.env.DNSPY_E2E_SAVE_PATH,
        overwrite: true,
      })
    }
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: nativeText().saveModuleAs,
      defaultPath: suggestedName,
      filters: [
        { name: nativeText().dotNetAssemblies, extensions: ['dll', 'exe', 'netmodule'] },
        { name: nativeText().allFiles, extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath)
      return undefined
    return requireBackend().invoke('module/saveAs', {
      workspaceId,
      moduleId,
      destinationPath: result.filePath,
      overwrite: true,
    })
  })
  ipcMain.handle('document:saveCode', async (_event, suggestedName: string, text: string) => {
    if (typeof suggestedName !== 'string' || typeof text !== 'string')
      throw new TypeError('Invalid save-code request.')
    if (!app.isPackaged && process.env.DNSPY_E2E_SAVE_CODE_PATH) {
      await writeFile(process.env.DNSPY_E2E_SAVE_CODE_PATH, text, 'utf8')
      return process.env.DNSPY_E2E_SAVE_CODE_PATH
    }
    const safeName = path.basename(suggestedName) || 'code.txt'
    const extension = path.extname(safeName).slice(1) || 'txt'
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: nativeText().saveCode,
      defaultPath: safeName,
      filters: [
        { name: nativeText().codeFiles, extensions: [extension] },
        { name: nativeText().allFiles, extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath)
      return undefined
    await writeFile(result.filePath, text, 'utf8')
    return result.filePath
  })
  ipcMain.handle('debug:chooseTarget', async () => {
    if (!app.isPackaged && process.env.DNSPY_E2E_DEBUG_TARGET)
      return process.env.DNSPY_E2E_DEBUG_TARGET
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: nativeText().selectDebugTarget,
      properties: ['openFile'],
      filters: [
        { name: nativeText().dotNetPrograms, extensions: ['dll', 'exe'] },
        { name: nativeText().allFiles, extensions: ['*'] },
      ],
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('debug:listProcesses', () => requireBackend().invoke('debug/listProcesses', {}))
  ipcMain.handle('debug:launch', (_event, program: string, args: string[], stopAtEntry: boolean) => requireBackend().invoke('debug/launch', { program, arguments: args, stopAtEntry }))
  ipcMain.handle('debug:attach', (_event, processId: number) => requireBackend().invoke('debug/attach', { processId }))
  const debugRequest = (channel: string, command: string): void => {
    ipcMain.handle(channel, (_event, sessionId: string, args: unknown) => requireBackend().invoke('debug/request', { sessionId, command, arguments: args }))
  }
  debugRequest('debug:setFunctionBreakpoints', 'setFunctionBreakpoints')
  debugRequest('debug:continue', 'continue')
  debugRequest('debug:pause', 'pause')
  debugRequest('debug:next', 'next')
  debugRequest('debug:stepIn', 'stepIn')
  debugRequest('debug:stepOut', 'stepOut')
  debugRequest('debug:threads', 'threads')
  debugRequest('debug:stackTrace', 'stackTrace')
  debugRequest('debug:scopes', 'scopes')
  debugRequest('debug:variables', 'variables')
  debugRequest('debug:modules', 'modules')
  debugRequest('debug:setExceptionBreakpoints', 'setExceptionBreakpoints')
  debugRequest('debug:evaluate', 'evaluate')
  ipcMain.handle('debug:disconnect', (_event, sessionId: string, terminateDebuggee: boolean) => requireBackend().invoke('debug/disconnect', { sessionId, terminateDebuggee }))
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle('window:toggleMaximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window)
      return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle('window:isMaximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
  ipcMain.handle('backend:status:get', () => lastBackendStatus)
  ipcMain.handle('app:initialPaths', () => initialPaths)
  ipcMain.handle('app:processId', () => process.pid)
  ipcMain.handle('app:setLocale', (_event, locale: UiLocale) => {
    if (locale === 'en' || locale === 'zh-CN')
      uiLocale = locale
  })
  ipcMain.handle('app:quit', () => app.quit())
}

app.whenReady().then(async () => {
  uiLocale = app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  Menu.setApplicationMenu(null)
  registerAppProtocol()
  registerIpc()
  createWindow()
  backend = new BackendClient(sendBackendStatus, sendBackendNotification)
  try {
    await backend.start()
  } catch (error) {
    sendBackendStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0)
    createWindow()
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  void backend?.dispose()
})
