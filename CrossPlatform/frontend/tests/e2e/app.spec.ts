import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let application: ElectronApplication
let page: Page
let userDataDirectory: string
let savePath: string
const assemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')
const debugTargetPath = path.resolve(import.meta.dirname, '../../../backend/tests/DebugTarget/bin/Debug/net10.0/DebugTarget.dll')

test.beforeEach(async () => {
  userDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-e2e-'))
  savePath = path.join(userDataDirectory, 'saved-module.dll')
  application = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userDataDirectory}`],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      DNSPY_E2E_ASSEMBLY: assemblyPath,
      DNSPY_E2E_DEBUG_TARGET: debugTargetPath,
      DNSPY_E2E_SAVE_PATH: savePath,
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

  const typeRow = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.HelloRequest$/ })
  await expect(typeRow).toBeVisible()
  await typeRow.dblclick()

  const editor = page.locator('.monaco-editor')
  await expect(editor).toBeVisible()
  await expect.poll(async () => (await editor.locator('.view-lines').innerText()).replaceAll('\u00a0', ' ')).toContain('record HelloRequest')

  await page.getByLabel('Decompiler language').selectOption('il')
  await expect.poll(async () => editor.locator('.view-lines').innerText()).toContain('.class')
  await page.screenshot({ path: 'test-results/dnspy-shell.png' })
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
