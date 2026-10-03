import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let application: ElectronApplication
let page: Page
let userDataDirectory: string
let savePath: string
let saveCodePath: string
let importBookmarksPath: string
const contractsAssemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')
const debugTargetPath = path.resolve(import.meta.dirname, '../../../backend/tests/DebugTarget/bin/Debug/net10.0/DebugTarget.dll')

// The environment decides what the Open Assembly button hands back. A debug test opens the debuggee itself,
// because the in-process engine turns a decompiled line into an IL offset through the module's statement map
// and that map only exists for an assembly the workspace has decompiled.
const launchApp = async (assemblies: string): Promise<void> => {
  userDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-e2e-'))
  savePath = path.join(userDataDirectory, 'saved-module.dll')
  saveCodePath = path.join(userDataDirectory, 'saved-code.cs')
  importBookmarksPath = path.join(userDataDirectory, 'bookmarks-to-import.json')
  application = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userDataDirectory}`],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      DNSPY_E2E_ASSEMBLY: assemblies,
      DNSPY_E2E_DEBUG_TARGET: debugTargetPath,
      DNSPY_E2E_SAVE_PATH: savePath,
      DNSPY_E2E_SAVE_CODE_PATH: saveCodePath,
      DNSPY_E2E_OPEN_TEXT_FILE: importBookmarksPath,
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
    await page.getByRole('menuitem', { name: /^Theme$/ }).hover()
    await page.getByRole('menuitem', { name: 'Light', exact: true }).click()
    await page.getByRole('tab', { name: 'Search' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: /^Theme$/ }).hover()
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

    // The C# Interactive window is named the way the WPF menu names it.
    await page.getByRole('menuitem', { name: '视图' }).click()
    await expect(page.getByRole('menuitem', { name: 'C# 交互' })).toBeVisible()
    await page.getByRole('menuitem', { name: '视图' }).click()
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

    // Module tools live on the module's context menu in the explorer, not in the View menu.
    const moduleRow = page.locator('.tree-row[data-kind="module"]').first()
    await moduleRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Module Information' }).click()
    await expect(page.getByText('MVID', { exact: true })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Metadata Tables' })).toContainText('TypeDef')

    await moduleRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Hex View' }).click()
    await expect(page.locator('.hex-content')).toContainText('4D 5A')

    const namespaceRow = page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ })
    await namespaceRow.locator('.tree-expander').click()
    const helloType = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.HelloRequest$/ })
    await helloType.click()
    // Rename is a tree command in dnSpy, not an Edit menu entry, so it is F2 here too.
    await page.keyboard.press('F2')
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
    await page.getByRole('menuitem', { name: 'Edit Method Body...' }).click()
    const ilDialog = page.getByRole('dialog', { name: /Edit IL/ })
    await expect(ilDialog.getByLabel('Opcode 0')).toBeVisible()
    await ilDialog.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText('Modified', { exact: true })).toBeVisible()
    await page.getByRole('toolbar', { name: 'Main toolbar' }).getByRole('button', { name: 'Save As' }).click()
    await expect(page.getByText('Modified', { exact: true })).not.toBeVisible()
    expect(existsSync(savePath)).toBe(true)
  })

  test('writes a method body from the hex editor and undoes the bytes', async () => {
    await openAssemblyAndNamespace()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.locator('.tree-expander').click()
    const getCode = page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^get_Code\(\)$/ })
    await getCode.click()

    // The hex group is listed in dnSpy's order, and only the entries that have something to point at are
    // in it: an int getter gets no 'return true'/'return false' body, whose commands belong to bool methods.
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    // The shortcut rides along with the label in the item's own text, so it is trimmed off to compare order.
    const labels = (await page.getByRole('menu').last().getByRole('menuitem').allTextContents())
      .map((text) => text.replace(/(Ctrl|Shift|Alt)\+.*$/, '').trim())
    const start = labels.indexOf('Open Hex Editor')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(labels.slice(start, start + 6)).toEqual([
      'Open Hex Editor',
      'Show Instructions in Hex Editor',
      'Show Method Body in Hex Editor',
      'Hex Write Empty Body',
      'Hex Copy Method Body',
      'Hex Paste Method Body',
    ])

    await page.getByRole('menuitem', { name: 'Show Method Body in Hex Editor' }).click()

    // The command marks the bytes it names, so the getter's own body is read off the dump before anything
    // is written over it.
    const marked = page.locator('.hex-byte-marked')
    // The separator between bytes rides along with its own cell, and the last column of a row has none,
    // so the bytes are compared without it.
    const markedBytes = async (): Promise<string[]> => (await marked.allTextContents()).map((text) => text.trim())
    await expect(marked.first()).toBeVisible()
    const original = await markedBytes()

    // The write posts dnSpy's empty-body bytes: a tiny header whose two code bytes return the default. The
    // getter's real body is longer, so its remaining bytes stay where they are under the patch.
    await getCode.click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Hex Write Empty Body' }).click()
    await expect(page.getByText('Updated method body bytes for get_Code().')).toBeVisible()
    await expect(page.getByText('Modified', { exact: true })).toBeVisible()
    await expect.poll(async () => (await markedBytes()).slice(0, 3)).toEqual(['0A', '16', '2A'])

    // A byte patch is an edit like any other, so undo puts the file's own bytes back under it.
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Undo/ }).click()
    await expect.poll(markedBytes).toEqual(original)
    await expect(page.getByText('Modified', { exact: true })).not.toBeVisible()
  })

  test('deletes a type, renames the namespace and restores both with undo', async () => {
    await openAssemblyAndNamespace()
    const namespaceRow = page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ })
    const helloType = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.HelloRequest$/ })
    await helloType.click()

    // The Edit menu names the node it would delete, the way the WPF command does.
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Delete dnSpy\.Backend\.Contracts\.HelloRequest\b/ }).click()
    await expect(helloType).not.toBeVisible()

    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Undo/ }).click()
    await expect(helloType).toBeVisible()

    await namespaceRow.click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Rename Namespace' }).click()
    const namespaceDialog = page.getByRole('dialog', { name: 'Edit Namespace' })
    await namespaceDialog.getByLabel('Name').fill('dnSpy.Backend.Renamed')
    await namespaceDialog.getByRole('button', { name: 'OK' }).click()
    await expect(page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Renamed$/ })).toBeVisible()

    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Undo/ }).click()
    await expect(namespaceRow).toBeVisible()

    // The stub body is built by the backend from the method's signature, so its only job here is to
    // land as an edit the user can undo.
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.locator('.tree-expander').click()
    await page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^get_Code\(\)$/ }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Replace Method Body with stub...' }).click()
    await expect(page.getByText('Modified', { exact: true })).toBeVisible()

    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Undo/ }).click()
    await expect(page.getByText('Modified', { exact: true })).not.toBeVisible()
  })

  test('creates a type, saves it and finds it again after reopening the file', async () => {
    await openAssemblyAndNamespace()
    await page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ }).click()

    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Create Type...' }).click()
    const create = page.getByRole('dialog', { name: 'Create Type' })
    // The namespace comes from the node the command was run on; the name is the user's to type.
    await expect(create.getByLabel('Namespace')).toHaveValue('dnSpy.Backend.Contracts')
    // Exact: the flags beside the box carry `SpecialName` and `RTSpecialName`, which a loose label
    // lookup reads as a second and a third box called Name.
    await create.getByLabel('Name', { exact: true }).fill('E2ECreated')
    await create.getByRole('button', { name: 'OK' }).click()

    await expect(page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.E2ECreated$/ })).toBeVisible()
    await expect(page.getByText('Modified', { exact: true })).toBeVisible()

    await page.getByRole('toolbar', { name: 'Main toolbar' }).getByRole('button', { name: 'Save As' }).click()
    await expect(page.getByText('Modified', { exact: true })).not.toBeVisible()
    expect(existsSync(savePath)).toBe(true)

    // Opening again replaces the workspace with the file that was just written, so what is searched for
    // below is read off the disk rather than out of the session that made it. The picker is native and
    // cannot be driven from a test, so the hook the app opens assemblies through is pointed at the copy.
    await application.evaluate((_electron, saved) => { process.env.DNSPY_E2E_ASSEMBLY = saved }, savePath)
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')
    await page.getByRole('toolbar', { name: 'Main toolbar' }).getByRole('button', { name: 'Search' }).click()
    await page.getByRole('textbox', { name: 'Search assemblies' }).fill('E2ECreated')
    await page.getByRole('button', { name: 'Search', exact: true }).last().click()
    await expect(page.locator('.result-row').filter({ hasText: 'E2ECreated' }).first()).toBeVisible()
  })

  test('creates a method with a parameter and an attribute, then renames it with Alt+Enter', async () => {
    await openAssemblyAndNamespace()
    await page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ }).click()

    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Create Method...' }).click()
    const create = page.getByRole('dialog', { name: 'Create Method' })
    await create.getByLabel('Name', { exact: true }).fill('E2EMethod')

    // A parameter belongs to the signature, so it is added there: the type comes out of the picker and
    // the list takes the finished signature.
    await create.getByRole('tab', { name: 'Signature' }).click()
    const parameterTypes = create.locator('details.methodsig-section').filter({ hasText: 'Method Parameter Types' })
    await parameterTypes.getByRole('button', { name: 'Type' }).click()
    const typePicker = page.getByRole('dialog', { name: 'Pick a Type' })
    // The picker opens the module it is rooted at by itself; the namespace below it is the user's call.
    await typePicker.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ }).locator('.tree-expander').click()
    await typePicker.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.WorkspaceRequest$/ }).click()
    await typePicker.getByRole('button', { name: 'OK' }).click()
    await parameterTypes.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(parameterTypes.getByRole('option')).toHaveText('dnSpy.Backend.Contracts.WorkspaceRequest')

    // The attribute goes through dnSpy's own dialog, which picks its constructor with the same picker.
    await create.getByRole('tab', { name: 'Custom Attrs' }).click()
    await create.getByRole('button', { name: 'Add...' }).click()
    const attribute = page.getByRole('dialog', { name: 'Edit Custom Attribute' })
    await attribute.getByRole('button', { name: 'Pick a Constructor' }).click()
    const constructorPicker = page.getByRole('dialog', { name: 'Pick a Constructor' })
    await constructorPicker.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ }).locator('.tree-expander').click()
    await constructorPicker.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.WorkspaceRequest$/ }).locator('.tree-expander').click()
    await constructorPicker.locator('.tree-row[data-kind="method"]').filter({ hasText: /^\.ctor\(/ }).first().click()
    await constructorPicker.getByRole('button', { name: 'OK' }).click()
    // The button that opens the picker carries 'Constructor' in its own label too, so the box is named
    // by its role rather than by the label alone.
    await expect(attribute.getByRole('textbox', { name: 'Constructor' })).toHaveValue(/^dnSpy\.Backend\.Contracts\.WorkspaceRequest\(System\.String\)$/)
    await attribute.getByRole('button', { name: 'OK' }).click()
    await expect(create.getByRole('option')).toHaveText(/WorkspaceRequest/)
    await create.getByRole('button', { name: 'OK' }).click()

    const created = page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^E2EMethod\(/ })
    await expect(created).toBeVisible()
    await expect(page.getByText('Modified', { exact: true })).toBeVisible()

    // Alt+Enter is the settings command, and the method it was run on is the one the dialog opens.
    await page.keyboard.press('Alt+Enter')
    const edit = page.getByRole('dialog', { name: 'Edit Method' })
    await expect(edit.getByLabel('Name', { exact: true })).toHaveValue('E2EMethod')
    await edit.getByLabel('Name', { exact: true }).fill('E2EMethodRenamed')
    await edit.getByRole('button', { name: 'OK' }).click()
    await expect(page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^E2EMethodRenamed\(/ })).toBeVisible()

    // Both edits are undone again, which is also what lets the app be closed: a workspace that is still
    // modified asks whether to discard it, and that question is a native window this test cannot answer.
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Undo/ }).click()
    await expect(page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^E2EMethod\(/ })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /^Undo/ }).click()
    await expect(page.getByText('Modified', { exact: true })).not.toBeVisible()
  })

  test('closes only the topmost dialog when Escape is pressed', async () => {
    await openAssemblyAndNamespace()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.locator('.tree-expander').click()
    await page.locator('.tree-row[data-kind="method"]').filter({ hasText: /^get_Code\(\)$/ }).click()
    await page.keyboard.press('Alt+Enter')
    const method = page.getByRole('dialog', { name: 'Edit Method' })
    await expect(method).toBeVisible()

    // Three deep: the method's window, the attribute row's window, and the picker the row opens.
    await method.getByRole('tab', { name: 'Custom Attrs' }).click()
    await method.getByRole('button', { name: 'Add...' }).click()
    const attribute = page.getByRole('dialog', { name: 'Edit Custom Attribute' })
    await attribute.getByRole('button', { name: 'Pick a Constructor' }).click()
    const picker = page.getByRole('dialog', { name: 'Pick a Constructor' })
    await expect(picker).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(picker).not.toBeVisible()
    await expect(attribute).toBeVisible()
    await expect(method).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(attribute).not.toBeVisible()
    await expect(method).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(method).not.toBeVisible()
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

  test('bookmarks a statement from the gutter and clears it from the View menu', async () => {
    await openAssemblyAndNamespace()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.dblclick()

    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    const bodyLine = page.locator('.monaco-editor .view-lines .view-line').filter({ hasText: /Code\s*=\s*code/ }).first()
    await expect(bodyLine).toBeVisible()

    await page.getByRole('tab', { name: 'Bookmarks' }).click()
    const rows = page.locator('.bookmark-row')
    const glyphs = page.locator('.bookmark-glyph')
    await expect(rows).toHaveCount(0)

    const lineBox = await bodyLine.boundingBox()
    const marginBox = await page.locator('.monaco-editor .margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    // The bookmark strip is the right-hand part of the margin — the breakpoint glyphs are on the left.
    await page.mouse.click(marginBox.x + marginBox.width - 7, lineBox.y + lineBox.height / 2)

    await expect(glyphs).toHaveCount(1)
    await expect(rows).toHaveCount(1)
    // The row names the method the statement sits in, the IL offset it was saved as, and its module.
    await expect(rows.first()).toContainText('dnSpy.Backend.Contracts.RpcException::.ctor')
    await expect(rows.first()).toContainText(/IL_[0-9A-F]{4}/)
    await expect(rows.first()).toContainText('dnSpy.Backend.Contracts.dll')
    // Making one selects it, and the go-to continues from there.
    await expect(rows.first()).toHaveClass(/active/)

    // The same commands the editor offers, reached through the window's View menu. The submenu opens on
    // hover, the way it does for a pointer; clicking the parent instead would close it again.
    await page.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: 'Bookmarks', exact: true }).hover()
    await expect(page.getByRole('menuitem', { name: /^Previous Bookmark Ctrl\+K/ })).toBeEnabled()
    await page.getByRole('menuitem', { name: /^Clear Bookmarks Ctrl/ }).click()

    await expect(rows).toHaveCount(0)
    await expect(glyphs).toHaveCount(0)
  })

  test('keeps a bookmark across a reload', async () => {
    await openAssemblyAndNamespace()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.dblclick()

    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    const bodyLine = page.locator('.monaco-editor .view-lines .view-line').filter({ hasText: /Code\s*=\s*code/ }).first()
    await expect(bodyLine).toBeVisible()
    const lineBox = await bodyLine.boundingBox()
    const marginBox = await page.locator('.monaco-editor .margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    await page.mouse.click(marginBox.x + marginBox.width - 7, lineBox.y + lineBox.height / 2)

    await page.getByRole('tab', { name: 'Bookmarks' }).click()
    const rows = page.locator('.bookmark-row')
    await expect(rows).toHaveCount(1)
    const saved = await rows.first().textContent()

    // A bookmark is written down as module plus IL offset, never as the node ids this session handed
    // out, so the restart reads it back with its name, its location and its module intact.
    await page.reload()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')

    await page.getByRole('tab', { name: 'Bookmarks' }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveText(saved)
  })

  test('exports the bookmarks to a file and reads them back', async () => {
    await openAssemblyAndNamespace()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.dblclick()

    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    const bodyLine = page.locator('.monaco-editor .view-lines .view-line').filter({ hasText: /Code\s*=\s*code/ }).first()
    await expect(bodyLine).toBeVisible()
    const lineBox = await bodyLine.boundingBox()
    const marginBox = await page.locator('.monaco-editor .margin').first().boundingBox()
    if (!lineBox || !marginBox)
      throw new Error('The editor is not laid out yet.')
    await page.mouse.click(marginBox.x + marginBox.width - 7, lineBox.y + lineBox.height / 2)

    await page.getByRole('tab', { name: 'Bookmarks' }).click()
    const rows = page.locator('.bookmark-row')
    const status = page.locator('.bookmarks-status')
    await expect(rows).toHaveCount(1)

    await page.getByRole('button', { name: 'Export Bookmarks' }).click()
    await expect(status).toContainText('Exported 1 bookmark(s) to')
    const exported = readFileSync(saveCodePath, 'utf8')
    // The file is the portable shape: module, token and IL offset, with nothing session-local in it.
    const entries = JSON.parse(exported).bookmarks as Record<string, unknown>[]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ modulePath: contractsAssemblyPath, metadataToken: expect.any(Number), ilOffset: expect.any(Number), labels: [], enabled: true })

    await page.getByRole('button', { name: 'Clear Bookmarks' }).click()
    await expect(rows).toHaveCount(0)

    writeFileSync(importBookmarksPath, exported)
    await page.getByRole('button', { name: 'Import Bookmarks' }).click()

    await expect(rows).toHaveCount(1)
    await expect(status).toContainText('Imported 1 bookmark(s).')
    await expect(rows.first()).toContainText('IL_')
  })

  test('toggles a bookmark with the Ctrl+K chord while the editor has focus', async () => {
    await openAssemblyAndNamespace()
    const rpcException = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.RpcException$/ })
    await rpcException.dblclick()

    const browserWindow = await application.browserWindow(page)
    await browserWindow.evaluate((window) => window.setSize(1500, 700))

    const bodyLine = page.locator('.monaco-editor .view-lines .view-line').filter({ hasText: /Code\s*=\s*code/ }).first()
    await expect(bodyLine).toBeVisible()
    // Clicking the code puts the caret on the line the chord will bookmark.
    await bodyLine.click()

    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+k')

    await page.getByRole('tab', { name: 'Bookmarks' }).click()
    await expect(page.locator('.bookmark-row')).toHaveCount(1)

    // A second chord on the same statement takes it away again, as the second click in the gutter does.
    await bodyLine.click()
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+k')
    await expect(page.locator('.bookmark-row')).toHaveCount(0)
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

  test('runs submissions in the C# Interactive window', async () => {
    await page.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: /^C# Interactive/ }).click()

    // Opening the window builds the session, which prints the engine banner; the first submission
    // then has to compile, so the waits below are wider than the default.
    const log = page.locator('.script-log')
    await expect(log).toContainText('Roslyn C# Compiler version', { timeout: 60_000 })
    await expect(log).toContainText('Type "#help" for more information.')

    const pane = page.locator('.script-pane')
    const input = page.locator('.script-input .monaco-editor')
    // The input box is locked while a submission runs, so every submission below waits for the
    // previous one to finish before typing — the same thing a user does in front of the window.
    const submit = async (code: string): Promise<void> => {
      await expect(pane).toHaveAttribute('data-running', 'false', { timeout: 60_000 })
      await input.click()
      await page.keyboard.type(code)
      await page.keyboard.press('Enter')
    }

    await submit('1 + 1')
    await expect(log).toContainText('> 1 + 1')
    await expect(log.locator('.script-result').last()).toHaveText('2', { timeout: 60_000 })

    // The host's stdout is the JSON-RPC channel, so this is also the check that a script writing to
    // the console is captured rather than corrupting the protocol — the submission after it still
    // works, which is what a broken frame would prevent.
    await submit('Console.WriteLine("hello from the console");')
    await expect(log).toContainText('hello from the console')

    // The session outlives a submission, so a variable declared in one is visible to the next.
    await submit('var x = 41;')
    await expect(log).toContainText('> var x = 41;')
    await submit('x + 1')
    await expect(log.locator('.script-result').last()).toHaveText('42', { timeout: 60_000 })

    // #reset drops the session, and the old variable goes with it.
    await submit('#reset')
    await expect(log).toContainText('Resetting execution engine.')
    await submit('x + 1')
    await expect(log.locator('.script-error').last()).toContainText('CS0103', { timeout: 60_000 })

    // #help is answered by the window itself, like the upstream REPL command.
    await submit('#help')
    await expect(log).toContainText('Script directives:')
    await expect(log).toContainText('#load "myscript.csx"')

    await page.getByRole('button', { name: 'Clear the script editor' }).click()
    await expect(log).toBeEmpty()
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
