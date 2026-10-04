import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A real ELF image off this machine, the case a Linux user meets when they open a native binary: dnSpy reads
// its headers and hangs one node per structure off an ELF node, in readelf's order.
const elfPath = ['/bin/ls', '/usr/bin/ls'].find((candidate) => existsSync(candidate)) ?? '/bin/ls'

let application: ElectronApplication
let page: Page
let userDataDirectory: string

test.describe('the ELF node of an opened native binary', () => {
  test.beforeEach(async () => {
    userDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-e2e-elf-'))
    application = await electron.launch({
      args: ['.', '--no-sandbox', `--user-data-dir=${userDataDirectory}`],
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, DNSPY_E2E_ASSEMBLY: elfPath },
    })
    page = await application.firstWindow()
    page.on('dialog', (dialog) => void dialog.accept())
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.getByRole('treeitem').first()).toContainText(path.basename(elfPath))
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
    // The file itself, then the ELF node that holds everything worth expanding.
    await expect(page.locator('.tree-row[data-kind="elfdocument"]')).toContainText(path.basename(elfPath))
    await expandRow('elfdocument')
    await expandRow('elf')

    const structures = page.locator('.tree-row[data-kind="elfstructure"]')
    await expect(structures.first()).toContainText('ELF Header')
    await expect(structures.filter({ hasText: /^Program Header #0$/ })).toHaveCount(1)
    await expect(structures.filter({ hasText: /Section #0$/ })).toHaveCount(1)
    // A section carries the name the file's own string table gives it.
    await expect(structures.filter({ hasText: /Section #\d+: \.text$/ })).toHaveCount(1)

    // A structure is not code, so the row expands to nothing — the fields live in its document.
    await expect(structures.filter({ hasText: 'ELF Header' }).locator('.tree-expander')).toBeDisabled()

    await structures.filter({ hasText: 'ELF Header' }).dblclick()
    await expect(page.getByRole('tab', { name: 'ELF Header' })).toBeVisible()
    const document = async (): Promise<string> =>
      (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' ')
    await expect.poll(document).toContain('Class:')
    await expect.poll(document).toContain('64-bit (ELFCLASS64)')
    await expect.poll(document).toContain('Little endian (ELFDATA2LSB)')
  })

  test('opens the whole image as one document from the ELF node', async () => {
    await expandRow('elfdocument')

    await page.locator('.tree-row[data-kind="elf"]').dblclick()

    await expect(page.getByRole('tab', { name: 'ELF' })).toBeVisible()
    const document = async (): Promise<string> =>
      (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' ')
    await expect.poll(document).toContain(`// ${path.basename(elfPath)}`)
    // The ELF node's document is the whole image, opened from the node that stands for it.
    await expect.poll(document).toContain('ELF Header')
  })

  test('says why a structure has no IL instead of failing', async () => {
    await expandRow('elfdocument')
    await expandRow('elf')

    const header = page.locator('.tree-row[data-kind="elfstructure"]').filter({ hasText: 'ELF Header' })
    await header.dblclick()
    await expect(page.getByRole('tab', { name: 'ELF Header' })).toBeVisible()

    // The IL view of the same node: a header of the image has no IL, and the document says so rather than
    // showing the IL of whatever method the node would otherwise be mistaken for.
    await page.getByRole('combobox', { name: 'Decompiler language' }).selectOption('ilWithCSharp')
    await expect.poll(async () => (await page.locator('.monaco-editor .view-lines').innerText()).replaceAll('\u00a0', ' '))
      .toBe('// ELF Header')
    await expect(page.locator('.document-diagnostic')).toHaveAttribute('title', /no IL/)
  })
})
