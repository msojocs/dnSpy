import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const contractsAssemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')

let application: ElectronApplication
let page: Page
let userDataDirectory: string

// dnSpy hangs a PE node off the module, with one node per structure of the image below it
// (dnSpy.AsmEditor.Hex.Nodes.PENode). Nothing expands on its own, so every step below is a click.
test.describe('the PE node of an opened assembly', () => {
  test.beforeEach(async () => {
    userDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-e2e-pe-'))
    application = await electron.launch({
      args: ['.', '--no-sandbox', `--user-data-dir=${userDataDirectory}`],
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, DNSPY_E2E_ASSEMBLY: contractsAssemblyPath },
    })
    page = await application.firstWindow()
    page.on('dialog', (dialog) => void dialog.accept())
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')
  })
  test.afterEach(async () => {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  })

  /** One row of a kind, expanded — the rows carry the node kind the backend gave them. */
  const expandRow = async (kind: string): Promise<void> => {
    const row = page.locator(`.tree-row[data-kind="${kind}"]`).first()
    await expect(row).toBeVisible()
    await row.locator('.tree-expander').click()
  }

  test('lists the structures of the image, and a structure opens as a document', async () => {
    await expandRow('assembly')
    await expandRow('module')

    const pe = page.locator('.tree-row[data-kind="pe"]')
    await expect(pe).toHaveCount(1)
    await expect(pe).toContainText('PE')

    await expandRow('pe')

    const structures = page.locator('.tree-row[data-kind="pestructure"]')
    await expect(structures.first()).toContainText('DOS Header')
    await expect(structures.filter({ hasText: 'File Header' })).toHaveCount(1)
    await expect(structures.filter({ hasText: /Optional Header \((32|64)-bit\)/ })).toHaveCount(1)
    await expect(structures.filter({ hasText: /Section #0: / })).toHaveCount(1)
    await expect(structures.filter({ hasText: 'Cor20 Header' })).toHaveCount(1)
    await expect(structures.filter({ hasText: /Storage Stream #\d+:/ }).first()).toBeVisible()

    // A structure is not code, so the row expands to nothing — the fields live in its document.
    await expect(structures.filter({ hasText: 'File Header' }).locator('.tree-expander')).toBeDisabled()

    await structures.filter({ hasText: 'File Header' }).dblclick()
    await expect(page.getByRole('tab', { name: 'File Header' })).toBeVisible()
    await expect.poll(async () => (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' '))
      .toContain('Machine:')
  })

  test('opens the whole image as one document from the PE node', async () => {
    await expandRow('assembly')
    await expandRow('module')

    await page.locator('.tree-row[data-kind="pe"]').dblclick()

    await expect(page.getByRole('tab', { name: 'PE' })).toBeVisible()
    await expect.poll(async () => (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' '))
      .toContain('// dnSpy.Backend.Contracts.dll')
    // The PE node's document is the whole image, opened from the node that stands for it.
    await expect.poll(async () => (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' '))
      .toContain('DOS Header')
  })

  test('says why a structure has no IL instead of failing', async () => {
    await expandRow('assembly')
    await expandRow('module')
    await expandRow('pe')

    const dosHeader = page.locator('.tree-row[data-kind="pestructure"]').filter({ hasText: 'DOS Header' })
    await dosHeader.dblclick()
    await expect(page.getByRole('tab', { name: 'DOS Header' })).toBeVisible()

    // The IL view of the same node: a header of the image has no IL, and the document says so rather than
    // showing the IL of whatever method the node would otherwise be mistaken for.
    await page.getByRole('combobox', { name: 'Decompiler language' }).selectOption('ilWithCSharp')
    await expect.poll(async () => (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' '))
      .toBe('// DOS Header')
    await expect(page.locator('.document-diagnostic')).toHaveAttribute('title', /no IL/)
  })
})
