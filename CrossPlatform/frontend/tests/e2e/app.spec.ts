import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let application: ElectronApplication
let page: Page
let userDataDirectory: string
let savePath: string
let saveCodePath: string
const assemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')
const debugTargetPath = path.resolve(import.meta.dirname, '../../../backend/tests/DebugTarget/bin/Debug/net10.0/DebugTarget.dll')

test.beforeEach(async () => {
  userDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-e2e-'))
  savePath = path.join(userDataDirectory, 'saved-module.dll')
  saveCodePath = path.join(userDataDirectory, 'saved-code.cs')
  application = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userDataDirectory}`],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      DNSPY_E2E_ASSEMBLY: assemblyPath,
      DNSPY_E2E_DEBUG_TARGET: debugTargetPath,
      DNSPY_E2E_SAVE_PATH: savePath,
      DNSPY_E2E_SAVE_CODE_PATH: saveCodePath,
    },
  })
  page = await application.firstWindow()
  page.on('dialog', (dialog) => void dialog.accept())
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  await application.close()
  rmSync(userDataDirectory, { recursive: true, force: true })
})

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
  await page.getByRole('menuitem', { name: 'Light Theme' }).click()
  await page.getByRole('tab', { name: 'Search' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.getByRole('menuitem', { name: 'High Contrast' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'hc')
})

test('switches to Simplified Chinese and persists the language', async () => {
  await page.getByRole('menuitem', { name: 'Language' }).click()
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
  await expect(page.getByRole('menuitem', { name: '语言' })).toBeVisible()
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

test('debugs a real CoreCLR process and renders locals and watch values', async () => {
  await page.getByRole('tab', { name: 'Breakpoints' }).click()
  await page.getByRole('textbox', { name: 'Function breakpoint', exact: true }).fill('DebugTarget.Program.Calculate')
  await page.getByRole('button', { name: 'Add function breakpoint' }).click()

  const toolbar = page.getByRole('toolbar', { name: 'Main toolbar' })
  await toolbar.getByRole('button', { name: 'Start Debugging' }).click()
  await expect(toolbar.getByRole('button', { name: 'Continue' })).toBeEnabled()
  await toolbar.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Stopped: breakpoint', { exact: true })).toBeVisible()

  const locals = page.getByRole('table', { name: 'Locals' })
  await expect(locals).toContainText('left')
  await expect(locals).toContainText('right')

  await page.getByRole('tab', { name: 'Watch' }).click()
  await page.getByRole('textbox', { name: 'Watch expression', exact: true }).fill('left + right')
  await page.getByRole('button', { name: 'Add watch' }).click()
  await expect(page.getByRole('table', { name: 'Watch' })).toContainText('42')

  await toolbar.getByRole('button', { name: 'Stop' }).click()
  await expect(toolbar.getByRole('button', { name: 'Start Debugging' })).toBeEnabled()
})

test('toggles a breakpoint by clicking the editor gutter', async () => {
  await openAssemblyAndNamespace()
  const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
  await rpcException.dblclick()
  await expect.poll(async () => (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' ')).toContain('public int Code { get; }')

  await page.getByRole('tab', { name: 'Breakpoints' }).click()
  const breakpointRows = page.locator('.breakpoint-row')
  const glyphs = page.locator('.breakpoint-glyph')
  const clickGutter = async (): Promise<void> => {
    // The auto-property on this line is get_Code(); the click lands in the glyph margin left of the line numbers.
    // Monaco pads with non-breaking spaces, so match on \s rather than on plain spaces.
    const bodyLine = page.locator('.monaco-editor .view-lines .view-line').filter({ hasText: /public\s+int\s+Code/ }).first()
    const lineBox = await bodyLine.boundingBox()
    const marginBox = await page.locator('.monaco-editor .margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    await page.mouse.click(marginBox.x + 8, lineBox.y + lineBox.height / 2)
  }

  await clickGutter()
  await expect(breakpointRows).toContainText('dnSpy.Backend.Contracts.RpcException.get_Code')
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
