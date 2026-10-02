import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let application: ElectronApplication
let page: Page
let userDataDirectory: string
let savePath: string
let saveCodePath: string
const contractsAssemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')
const debugTargetPath = path.resolve(import.meta.dirname, '../../../backend/tests/DebugTarget/bin/Debug/net10.0/DebugTarget.dll')

// The environment decides what the Open Assembly button hands back. A debug test opens the debuggee itself,
// because the in-process engine turns a decompiled line into an IL offset through the module's statement map
// and that map only exists for an assembly the workspace has decompiled.
const launchApp = async (assemblies: string): Promise<void> => {
  userDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-e2e-'))
  savePath = path.join(userDataDirectory, 'saved-module.dll')
  saveCodePath = path.join(userDataDirectory, 'saved-code.cs')
  application = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userDataDirectory}`],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      DNSPY_E2E_ASSEMBLY: assemblies,
      DNSPY_E2E_DEBUG_TARGET: debugTargetPath,
      DNSPY_E2E_SAVE_PATH: savePath,
      DNSPY_E2E_SAVE_CODE_PATH: saveCodePath,
    },
  })
  page = await application.firstWindow()
  page.on('dialog', (dialog) => void dialog.accept())
  await page.waitForLoadState('domcontentloaded')
}

const closeApp = async (): Promise<void> => {
  await application.close()
  rmSync(userDataDirectory, { recursive: true, force: true })
}

const openAssemblyAndNamespace = async (): Promise<void> => {
  await page.getByRole('button', { name: 'Open Assembly' }).first().click()
  await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')
  await page.getByRole('menuitem', { name: 'File' }).click()
  await expect(page.getByRole('menuitem', { name: /dnSpy\.Backend\.Contracts\.dll/ })).toBeVisible()
  await page.getByRole('menuitem', { name: 'File' }).click()
  const namespaceRow = page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ })
  await expect(namespaceRow).toBeVisible()
  await namespaceRow.locator('.tree-expander').click()
}

test.describe('the workspace shell', () => {
  test.beforeEach(async () => { await launchApp(contractsAssemblyPath) })
  test.afterEach(closeApp)

  test('starts the backend and renders the upstream-style shell', async () => {
    await expect(page.getByRole('menubar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Minimize window' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Maximize window' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close window' })).toBeVisible()
    await expect(page.getByRole('toolbar', { name: 'Main toolbar' })).toBeVisible()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Assembly Explorer' }).first()).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Output' })).toBeVisible()
  })

  test('opens and closes the in-app About dialog', async () => {
    const nativeDialogs: string[] = []
    page.on('dialog', (dialog) => nativeDialogs.push(dialog.message()))

    await page.getByRole('menuitem', { name: 'Help' }).click()
    await page.getByRole('menuitem', { name: 'About dnSpy' }).click()

    const about = page.getByRole('dialog', { name: 'About dnSpy' })
    await expect(about).toBeVisible()
    await expect(about).toContainText('Version 1.0.0')
    await expect(about).toContainText('GNU GPL v3.0 only')
    expect(nativeDialogs).toEqual([])

    await page.keyboard.press('Escape')
    await expect(about).not.toBeVisible()
    await expect(page.getByRole('toolbar', { name: 'Main toolbar' })).toBeVisible()
  })

  test('maximizes and restores the window from the title bar', async () => {
    const browserWindow = await application.browserWindow(page)
    await page.getByRole('button', { name: 'Maximize window' }).click()
    await expect(page.getByRole('button', { name: 'Restore window' })).toBeVisible()
    expect(await browserWindow.evaluate((window) => window.isMaximized())).toBe(true)

    await page.getByRole('button', { name: 'Restore window' }).click()
    await expect(page.getByRole('button', { name: 'Maximize window' })).toBeVisible()
    expect(await browserWindow.evaluate((window) => window.isMaximized())).toBe(false)
  })

  test('persists themes across renderer reloads', async () => {
    await page.getByRole('menuitem', { name: 'View' }).click()
    // The themes sit in a submenu, which opens while the pointer rests on its parent row.
    await page.getByRole('menuitem', { name: /^Themes/ }).hover()
    await page.getByRole('menuitem', { name: 'Light Theme' }).click()
    await page.getByRole('tab', { name: 'Search' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: /^Themes/ }).hover()
    await page.getByRole('menuitem', { name: 'High Contrast' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'hc')
  })

  test('switches to Simplified Chinese and persists the language', async () => {
    await page.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: 'Language' }).hover()
    await page.getByRole('menuitem', { name: 'Simplified Chinese' }).click()

    await expect(page.getByRole('menuitem', { name: '文件' })).toBeVisible()
    await expect(page.getByText('就绪', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: '程序集资源管理器' }).first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await page.getByRole('button', { name: '打开程序集' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')
    await expect(page.locator('.tree-row[data-kind="referencesgroup"]')).toContainText('程序集引用')
    await page.screenshot({ path: 'test-results/dnspy-shell-zh-CN.png' })

    await page.reload()
    await expect(page.getByRole('menuitem', { name: '视图' })).toBeVisible()
    await expect(page.getByText('就绪', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  })

  test('opens a real assembly, expands the tree and decompiles a type', async () => {
    await openAssemblyAndNamespace()
    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    const typeRow = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.HelloRequest$/ })
    await expect(typeRow).toBeVisible()
    await typeRow.dblclick()

    const editor = page.locator('.monaco-editor')
    await expect(editor).toBeVisible()
    await expect.poll(async () => (await editor.locator('.view-lines').innerText()).replaceAll('\u00a0', ' ')).toContain('record HelloRequest')

    await page.getByLabel('Decompiler language').selectOption('il')
    await expect.poll(async () => editor.locator('.view-lines').innerText()).toContain('.class')
    await expect(editor).toHaveAttribute('data-language-id', 'il')
    await editor.click()
    await expect.poll(async () => editor.locator('.view-lines').innerText()).toContain('<ProtocolVersion>k__BackingField')
    const ilTokens = await editor.locator('.view-lines span[class*="mtk"]').evaluateAll((tokens) => tokens.map((token) => ({
      text: token.textContent,
      color: getComputedStyle(token).color,
      fontWeight: getComputedStyle(token).fontWeight,
    })).filter((token) => token.text?.trim()))
    expect(ilTokens.find((token) => token.text === '.method')?.color).toBe('rgb(86, 156, 214)')
    expect(ilTokens.find((token) => token.text === 'IL_0000')?.color).toBe('rgb(215, 186, 125)')
    expect(ilTokens.find((token) => token.text === 'ldarg.0')?.color).toBe('rgb(197, 134, 192)')
    expect(ilTokens.find((token) => token.text === 'ldarg.0')?.fontWeight).toBe('700')
    expect(ilTokens.find((token) => token.text === 'System.Int32')?.color).toBe('rgb(78, 201, 176)')
    expect(ilTokens.find((token) => token.text === '<ProtocolVersion>k__BackingField')?.color).toBe('rgb(220, 220, 170)')
    await page.screenshot({ path: 'test-results/dnspy-il-highlighting.png' })

    await page.getByLabel('Decompiler language').selectOption('ilWithCSharp')
    await editor.click()
    await page.keyboard.press('PageDown')
    await expect.poll(async () => editor.locator('.view-lines').innerText()).toContain('//')
    await expect.poll(async () => editor.locator('.view-lines').innerText()).toContain('IL_')
    await page.screenshot({ path: 'test-results/dnspy-shell.png' })
  })

  test('runs document tab commands from the title context menu', async () => {
    await openAssemblyAndNamespace()
    const helloRequest = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.HelloRequest$/ })
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await helloRequest.dblclick()
    await expect.poll(async () => (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' ')).toContain('record HelloRequest')
    await rpcException.dblclick()
    await expect(page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.RpcException' })).toBeVisible()

    const helloTab = page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.HelloRequest' })
    await helloTab.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Tab actions' })
    await expect(menu.getByRole('menuitem', { name: /Save Code/ })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: /^Close Ctrl\+F4$/ })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: 'Close All Tabs' })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: 'Close All But This' })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: 'New Tab' })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: 'New Horizontal Tab Group' })).toBeEnabled()
    await expect(menu.getByRole('menuitem', { name: 'New Vertical Tab Group' })).toBeEnabled()

    await menu.getByRole('menuitem', { name: /Save Code/ }).click()
    await expect.poll(() => existsSync(saveCodePath)).toBe(true)
    expect(readFileSync(saveCodePath, 'utf8')).toContain('record HelloRequest')

    await helloTab.click({ button: 'right' })
    await page.getByRole('menu', { name: 'Tab actions' }).getByRole('menuitem', { name: 'New Tab' }).click()
    await expect(page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.HelloRequest' })).toHaveCount(2)

    await page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.HelloRequest' }).last().click({ button: 'right' })
    await page.getByRole('menu', { name: 'Tab actions' }).getByRole('menuitem', { name: 'New Horizontal Tab Group' }).click()
    await expect(page.locator('.flexlayout__tabset')).toHaveCount(2)

    await page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.RpcException' }).click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Tab actions' }).getByRole('menuitem', { name: 'New Horizontal Tab Group' })).toBeVisible()
    await expect(page.getByRole('menu', { name: 'Tab actions' }).getByRole('menuitem', { name: 'New Vertical Tab Group' })).toHaveCount(0)

    await page.keyboard.press('Escape')
    rmSync(saveCodePath)
    await page.keyboard.press('Control+s')
    await expect.poll(() => existsSync(saveCodePath)).toBe(true)
    expect(readFileSync(saveCodePath, 'utf8')).toContain('class RpcException')

    await page.keyboard.press('Control+t')
    await expect(page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.RpcException' })).toHaveCount(2)
    await page.keyboard.press('Control+F4')
    await expect(page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.RpcException' })).toHaveCount(1)
  })

  test('navigates C# references with F12 and document history', async () => {
    await openAssemblyAndNamespace()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.locator('.tree-expander').click()
    const getCode = page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^get_Code\(\)$/ })
    await getCode.dblclick()

    await expect(page.locator('.document-view')).toHaveAttribute('data-reference-count', /^[1-9]\d*$/)
    const reference = page.locator('.monaco-editor .view-lines').getByText(/BackingField/).first()
    await expect(reference).toBeVisible()
    await reference.click()
    await page.keyboard.press('F12')

    const targetTab = page.getByRole('tab', { name: /BackingField/ })
    await expect(targetTab).toBeVisible()
    const toolbar = page.getByRole('toolbar', { name: 'Main toolbar' })
    await expect(toolbar.getByRole('button', { name: 'Back' })).toBeEnabled()
    await toolbar.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByRole('tab', { name: 'get_Code()' })).toHaveAttribute('aria-selected', 'true')
    await expect(toolbar.getByRole('button', { name: 'Forward' })).toBeEnabled()
  })

  test('opens search results without requiring their tree nodes to be expanded', async () => {
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')
    await page.getByRole('toolbar', { name: 'Main toolbar' }).getByRole('button', { name: 'Search' }).click()
    await page.getByRole('textbox', { name: 'Search assemblies' }).fill('HelloRequest')
    await page.getByRole('button', { name: 'Search', exact: true }).last().click()
    const result = page.locator('.result-row').filter({ hasText: 'dnSpy.Backend.Contracts.HelloRequest' }).first()
    await expect(result).toBeVisible()
    await result.dblclick()
    await expect(page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.HelloRequest' })).toBeVisible()
    await expect(page.locator('.monaco-editor')).toBeVisible()
  })

  test('opens module tools and commits metadata and IL edits', async () => {
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')

    await page.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: 'Module Information' }).click()
    await expect(page.getByText('MVID', { exact: true })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Metadata Tables' })).toContainText('TypeDef')

    await page.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: 'Hex View' }).click()
    await expect(page.locator('.hex-content')).toContainText('4D 5A')

    const namespaceRow = page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ })
    await namespaceRow.locator('.tree-expander').click()
    const helloType = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.HelloRequest$/ })
    await helloType.click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Rename...' }).click()
    const renameDialog = page.getByRole('dialog', { name: 'Rename' })
    await renameDialog.getByLabel('Name').fill('HelloRequestEdited')
    await renameDialog.getByRole('button', { name: 'Rename' }).click()
    await expect(page.locator('.tree-row[data-kind="type"]').filter({ hasText: /HelloRequestEdited/ })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Undo/ }).click()
    await expect(page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.HelloRequest$/ })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Redo/ }).click()
    await expect(page.locator('.tree-row[data-kind="type"]').filter({ hasText: /HelloRequestEdited/ })).toBeVisible()

    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.locator('.tree-expander').click()
    const getCode = page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^get_Code\(\)$/ })
    await getCode.click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Edit IL Body...' }).click()
    const ilDialog = page.getByRole('dialog', { name: /Edit IL/ })
    await expect(ilDialog.getByLabel('Opcode 0')).toBeVisible()
    await ilDialog.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText('Modified', { exact: true })).toBeVisible()
    await page.getByRole('toolbar', { name: 'Main toolbar' }).getByRole('button', { name: 'Save As' }).click()
    await expect(page.getByText('Modified', { exact: true })).not.toBeVisible()
    expect(existsSync(savePath)).toBe(true)
  })

  test('toggles a line breakpoint by clicking the editor gutter', async () => {
    await openAssemblyAndNamespace()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.dblclick()

    // The constructor body is the only place in this document a statement is printed: an auto-property such as
    // `public int Code { get; }` has no body to map, so `Code = code;` is where a click lands on a sequence point.
    // Monaco only renders the lines the viewport can hold, so the editor has to be tall enough to show the body.
    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    const bodyLine = page.locator('.monaco-editor .view-lines .view-line').filter({ hasText: /Code\s*=\s*code/ }).first()
    await expect(bodyLine).toBeVisible()

    await page.getByRole('tab', { name: 'Breakpoints' }).click()
    const breakpointRows = page.locator('.breakpoint-row')
    const glyphs = page.locator('.breakpoint-glyph')
    const lineBox = await bodyLine.boundingBox()
    const marginBox = await page.locator('.monaco-editor .margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    const clickGutter = async (): Promise<void> => {
      await page.mouse.click(marginBox.x + 8, lineBox.y + lineBox.height / 2)
    }

    await clickGutter()
    await expect(breakpointRows).toContainText('dnSpy.Backend.Contracts.RpcException..ctor')
    await expect(glyphs).toHaveCount(1)

    // Clicking the marker again removes it, the same way the WPF editor toggles an existing breakpoint.
    await clickGutter()
    await expect(breakpointRows).toHaveCount(0)
    await expect(glyphs).toHaveCount(0)
  })

  test('toggles a breakpoint for the current method from the Debug menu', async () => {
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')

    await page.getByRole('tab', { name: 'Breakpoints' }).click()
    const namespaceRow = page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ })
    await namespaceRow.locator('.tree-expander').click()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.locator('.tree-expander').click()
    // The tree row keeps focus, so the F9 handler is not suppressed by the editor guard.
    await page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^get_Code\(\)$/ }).click()

    const breakpointRows = page.locator('.breakpoint-row')
    await page.keyboard.press('F9')
    await expect(breakpointRows).toContainText('dnSpy.Backend.Contracts.RpcException.get_Code')

    // A second press removes it again, like the upstream Toggle Breakpoint command.
    await page.keyboard.press('F9')
    await expect(breakpointRows).toHaveCount(0)
  })
})

// Line breakpoints need the debuggee inside the workspace, and so do function breakpoints: the engine resolves
// both through the workspace's decompiled statement map rather than through PDBs on disk.
test.describe('the in-process debug engine', () => {
  test.beforeEach(async () => { await launchApp(debugTargetPath) })
  test.afterEach(closeApp)

  const openDebugTarget = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText('DebugTarget')
    const namespaceRow = page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^DebugTarget$/ })
    await expect(namespaceRow).toBeVisible()
    await namespaceRow.locator('.tree-expander').click()
  }

  // Upstream's Start button opens the Debug Program dialog rather than a bare file picker, and the executable
  // is prefilled from the module the workspace already has open — so confirming the dialog is all a test needs.
  // "Break at" defaults to Don't Break, which is why there is no Continue step below: the launch runs straight
  // to the breakpoint instead of stopping on the entry point first.
  const startDebugging = async (): Promise<void> => {
    await page.getByRole('toolbar', { name: 'Main toolbar' }).getByRole('button', { name: 'Debug a Program' }).click()
    await page.getByRole('dialog', { name: 'Debug Program' }).getByRole('button', { name: 'OK' }).click()
  }

  test('sets a line breakpoint from the gutter, stops on it and shows the frame locals', async () => {
    await openDebugTarget()
    const programRow = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^DebugTarget\.Program$/ })
    await programRow.locator('.tree-expander').click()
    await page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^Calculate\(/ }).dblclick()

    const editor = page.locator('.monaco-editor')
    // Monaco only renders the lines its viewport can hold, so the window has to be tall enough for the body.
    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    // The statement the breakpoint goes on. `return sum;` is where the accumulator holds the value the Locals
    // assertion below reads; the decompiler calls the local `num`, the frame's slots keep the source name.
    const returnLine = editor.locator('.view-lines .view-line').filter({ hasText: /return\s+\w+\s*;/ }).first()
    await expect(returnLine).toBeVisible()

    await page.getByRole('tab', { name: 'Breakpoints' }).click()
    const glyphs = page.locator('.breakpoint-glyph')
    const lineBox = await returnLine.boundingBox()
    const marginBox = await editor.locator('.margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    // A click in the margin left of the line numbers toggles a breakpoint on that line.
    await page.mouse.click(marginBox.x + 8, lineBox.y + lineBox.height / 2)

    await expect(page.locator('.breakpoint-row')).toContainText('DebugTarget.Program.Calculate:')
    await expect(glyphs).toHaveCount(1)
    // The marker is echoed on the line the click mapped to, which for a click on a statement is its own line.
    const glyphBox = await glyphs.first().boundingBox()
    if (!glyphBox)
      throw new Error('The breakpoint glyph was not laid out.')
    expect(glyphBox.y).toBeGreaterThanOrEqual(lineBox.y)
    expect(glyphBox.y).toBeLessThan(lineBox.y + lineBox.height)

    const toolbar = page.getByRole('toolbar', { name: 'Main toolbar' })
    await startDebugging()
    // The launch asks not to break at the entry point, so the very first stop is the breakpoint's.
    await expect(page.getByText('Stopped: breakpoint', { exact: true })).toBeVisible()
    // The debuggee's module only loads when the process starts, so the breakpoint was pending until then.
    await expect(page.locator('.breakpoint-state-bound')).toHaveCount(1)

    // The frame's arguments and locals, named through the module's portable PDB and matched to ICorDebug slots by
    // index: the accumulator is 2 * 21 by the time the return statement is reached.
    await page.getByRole('tab', { name: 'Locals' }).click()
    await expect(page.locator('.debug-variable-name')).toContainText(['left', 'right', 'sum', 'i'])
    await expect(page.locator('.debug-table-row').filter({ hasText: 'sum' })).toContainText('42')

    // The stopped line is marked in the editor, on the document the frame decompiled to.
    await expect(page.locator('.debug-stopped-glyph')).toHaveCount(1)

    await toolbar.getByRole('button', { name: 'Stop' }).click()
    await expect(toolbar.getByRole('button', { name: 'Debug a Program' })).toBeEnabled()
  })

  test('breaks at the entry point when the dialog asks for it', async () => {
    await openDebugTarget()

    await page.getByRole('toolbar', { name: 'Main toolbar' }).getByRole('button', { name: 'Debug a Program' }).click()
    const dialog = page.getByRole('dialog', { name: 'Debug Program' })
    // The other half of the dialog's "Break at": upstream's start parameters can stop before Main runs.
    await dialog.getByLabel('Break at').selectOption('entry-point')
    await dialog.getByRole('button', { name: 'OK' }).click()

    await expect(page.locator('.status-bar')).toContainText('Stopped: entry')
    await page.getByRole('tab', { name: 'Call Stack' }).click()
    await expect(page.locator('.result-list[aria-label="Call Stack"] .stack-row').first()).toContainText('DebugTarget.Program::Main')

    // The entry stop is an ordinary stop: continuing runs the program to its end.
    const toolbar = page.getByRole('toolbar', { name: 'Main toolbar' })
    await toolbar.getByRole('button', { name: 'Continue' }).click()
    await expect(toolbar.getByRole('button', { name: 'Debug a Program' })).toBeEnabled()
  })

  test('stops on a function breakpoint for a method of the debuggee', async () => {
    await openDebugTarget()
    await page.getByRole('tab', { name: 'Breakpoints' }).click()
    await page.getByRole('textbox', { name: 'Function breakpoint', exact: true }).fill('DebugTarget.Program.Calculate')
    await page.getByRole('button', { name: 'Add function breakpoint' }).click()

    const toolbar = page.getByRole('toolbar', { name: 'Main toolbar' })
    await startDebugging()
    await expect(page.getByText('Stopped: breakpoint', { exact: true })).toBeVisible()

    await toolbar.getByRole('button', { name: 'Stop' }).click()
    await expect(toolbar.getByRole('button', { name: 'Debug a Program' })).toBeEnabled()
  })

  test('steps the loop one pass at a time and leaves the method for its caller', async () => {
    await openDebugTarget()
    const programRow = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^DebugTarget\.Program$/ })
    await programRow.locator('.tree-expander').click()
    await page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^Calculate\(/ }).dblclick()

    const editor = page.locator('.monaco-editor')
    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    // The statement inside the loop: a breakpoint on it stops on every pass, so what a step does to the
    // pass counter and the accumulator is visible in the Locals pane.
    const bodyLine = editor.locator('.view-lines .view-line').filter({ hasText: /\+=\s*\w+\s*;/ }).first()
    await expect(bodyLine).toBeVisible()
    await page.getByRole('tab', { name: 'Breakpoints' }).click()
    const lineBox = await bodyLine.boundingBox()
    const marginBox = await editor.locator('.margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    await page.mouse.click(marginBox.x + 8, lineBox.y + lineBox.height / 2)
    await expect(page.locator('.breakpoint-row')).toContainText('DebugTarget.Program.Calculate:')

    const toolbar = page.getByRole('toolbar', { name: 'Main toolbar' })
    await startDebugging()
    await expect(page.getByText('Stopped: breakpoint', { exact: true })).toBeVisible()

    // The frame stopped on the loop body, with the accumulator still 0 for this pass. The line the frame
    // reports is the decompiled document's, the same one the editor is showing.
    await page.getByRole('tab', { name: 'Call Stack' }).click()
    const frameRow = page.locator('.result-list[aria-label="Call Stack"] .stack-row').first()
    await expect(frameRow).toContainText('DebugTarget.Program::Calculate')
    await expect(frameRow).toContainText('DebugTarget.dll:9')
    await page.getByRole('tab', { name: 'Locals' }).click()
    const sumRow = page.locator('.debug-table-row').filter({ hasText: 'sum' })
    await expect(sumRow).toContainText('0')

    // A step over the body runs the add and stops on the loop header — where the next pass is decided —
    // and the accumulator has grown by the left operand.
    await toolbar.getByRole('button', { name: 'Step Over' }).click()
    await expect(page.getByText('Stopped: step', { exact: true })).toBeVisible()
    await expect(frameRow).toContainText('DebugTarget.dll:7')
    await expect(sumRow).toContainText('2')

    // The step after that is the body again: a loop runs its statements more than once, so a step that
    // only ever moved forwards would have left it.
    await toolbar.getByRole('button', { name: 'Step Over' }).click()
    await expect(frameRow).toContainText('DebugTarget.dll:9')
    await expect(sumRow).toContainText('2')

    // Stepping out of the body leaves the method rather than running the loop to its end: the stop is
    // reported in the caller, which is the frame the runtime steps back to.
    await page.getByRole('tab', { name: 'Call Stack' }).click()
    await page.getByRole('menuitem', { name: 'Debug' }).click()
    await page.getByRole('menuitem', { name: 'Step Out' }).click()
    await expect(page.getByText('Stopped: step', { exact: true })).toBeVisible()
    await expect(frameRow).toContainText('DebugTarget.Program::Main')

    // The step out lands after the call, so what follows it is the framework's own call — which has no
    // decompilable source to walk into. A step into degrades to a step over there and stops on the
    // caller's next statement; the editor's marker stays on a statement of the debuggee.
    await page.keyboard.press('F11')
    await expect(page.getByText('Stopped: step', { exact: true })).toBeVisible()
    await expect(frameRow).toContainText('DebugTarget.Program::Main')
    await expect(frameRow).toContainText('DebugTarget.dll:18')

    await toolbar.getByRole('button', { name: 'Stop' }).click()
    await expect(toolbar.getByRole('button', { name: 'Debug a Program' })).toBeEnabled()
  })

  // A step into stops before the call runs, so the frame has to be standing on the call statement itself:
  // stepping out of a method lands *after* its call, where there is nothing left to enter.
  test('steps into a call of the debuggee and lands on the callee', async () => {
    await openDebugTarget()
    const programRow = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^DebugTarget\.Program$/ })
    await programRow.locator('.tree-expander').click()
    await page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^Main\(/ }).dblclick()

    const editor = page.locator('.monaco-editor')
    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    const callLine = editor.locator('.view-lines .view-line').filter({ hasText: /Calculate\(/ }).first()
    // Monaco renders only the lines its viewport holds, and the call sits after the argument-handling
    // branch, so the editor has to be scrolled to it before it exists to be clicked.
    await editor.locator('.view-lines').hover()
    await page.mouse.wheel(0, 400)
    await expect(callLine).toBeVisible()
    await page.getByRole('tab', { name: 'Breakpoints' }).click()
    const lineBox = await callLine.boundingBox()
    const marginBox = await editor.locator('.margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    await page.mouse.click(marginBox.x + 8, lineBox.y + lineBox.height / 2)
    await expect(page.locator('.breakpoint-row')).toContainText('DebugTarget.Program.Main:')

    const toolbar = page.getByRole('toolbar', { name: 'Main toolbar' })
    await startDebugging()
    await expect(page.getByText('Stopped: breakpoint', { exact: true })).toBeVisible()

    // The stop is on the call itself: the arguments are read but the callee has not run.
    await page.getByRole('tab', { name: 'Call Stack' }).click()
    const frameRow = page.locator('.result-list[aria-label="Call Stack"] .stack-row').first()
    await expect(frameRow).toContainText('DebugTarget.Program::Main')

    // The step arms the callee's statements, so the runtime stops on the method's first one rather than
    // walking through code the client has nothing to show for.
    await page.keyboard.press('F11')
    await expect(page.getByText('Stopped: step', { exact: true })).toBeVisible()
    await expect(frameRow).toContainText('DebugTarget.Program::Calculate')

    await toolbar.getByRole('button', { name: 'Stop' }).click()
    await expect(toolbar.getByRole('button', { name: 'Debug a Program' })).toBeEnabled()
  })

  test('steps across an await without landing in the state machine', async () => {
    await openDebugTarget()
    const programRow = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^DebugTarget\.Program$/ })
    await programRow.locator('.tree-expander').click()
    await page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^AddAsync\(/ }).dblclick()

    const editor = page.locator('.monaco-editor')
    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    const sumLine = editor.locator('.view-lines .view-line').filter({ hasText: /=\s*\w+\s*\+\s*\w+\s*;/ }).first()
    await expect(sumLine).toBeVisible()
    await page.getByRole('tab', { name: 'Breakpoints' }).click()
    const lineBox = await sumLine.boundingBox()
    const marginBox = await editor.locator('.margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    await page.mouse.click(marginBox.x + 8, lineBox.y + lineBox.height / 2)
    // The statement's own code starts inside the sequence point that covers it — the machine's field store
    // is charged to it — so where the engine can arm the breakpoint is not where the line begins. The row
    // still names the line that was clicked.
    await expect(page.locator('.breakpoint-row')).toContainText('DebugTarget.Program.AddAsync:7')

    const toolbar = page.getByRole('toolbar', { name: 'Main toolbar' })
    await startDebugging()
    // The breakpoint is on the statement inside the state machine, so the stop is on its line.
    await expect(page.getByText('Stopped: breakpoint', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: 'Call Stack' }).click()
    const frameRow = page.locator('.result-list[aria-label="Call Stack"] .stack-row').first()
    await expect(frameRow).toContainText('DebugTarget.Program::AddAsync')
    await expect(frameRow).toContainText('DebugTarget.dll:7')

    // The step over crosses the suspension and stops on the await's own line, in the method the user
    // wrote: the frame is a generated MoveNext, so walking its own instructions would stop somewhere in
    // the plumbing between the two statements instead.
    await toolbar.getByRole('button', { name: 'Step Over' }).click()
    await expect(page.getByText('Stopped: step', { exact: true })).toBeVisible()
    await expect(frameRow).toContainText('DebugTarget.Program::AddAsync')
    await expect(frameRow).toContainText('DebugTarget.dll:8')

    await toolbar.getByRole('button', { name: 'Stop' }).click()
    await expect(toolbar.getByRole('button', { name: 'Debug a Program' })).toBeEnabled()
  })
})
