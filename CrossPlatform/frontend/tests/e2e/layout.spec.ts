import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The window's default shape, the way upstream dnSpy has it: the Assembly Explorer down the left edge,
// and the editor over the tool windows in what is left. The explorer is a docked border and the other
// two are tab sets inside the layout, which is what keeps the tool windows off the left column — a
// border along the bottom would span the whole window and run under the explorer.
const contractsAssemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')

let application: ElectronApplication
let page: Page
let userDataDirectory: string

test.beforeEach(async () => {
  userDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-layout-'))
  application = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userDataDirectory}`],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, DNSPY_E2E_ASSEMBLY: contractsAssemblyPath },
  })
  page = await application.firstWindow()
  page.on('dialog', (dialog) => void dialog.accept())
  await page.waitForLoadState('domcontentloaded')
})
test.afterEach(async () => {
  await application.close()
  rmSync(userDataDirectory, { recursive: true, force: true })
})

test('starts with the explorer left and the tool windows under the editor', async () => {
  await expect(page.getByRole('tab', { name: 'Assembly Explorer' }).first()).toBeVisible()
  await expect(page.locator('.flexlayout__border')).toHaveCount(1)
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(2)

  const explorer = await page.locator('.flexlayout__border_left').boundingBox()
  const documents = await page.locator('.flexlayout__tabset').nth(0).boundingBox()
  const tools = await page.locator('.flexlayout__tabset').nth(1).boundingBox()
  if (!explorer || !documents || !tools)
    throw new Error('The docks are not laid out.')
  expect(explorer.x).toBeLessThan(documents.x)
  // The second row starts beside the explorer rather than at the window's left edge, and is as wide as
  // the editor above it: one column on the left, two on the right.
  expect(tools.x).toBeGreaterThanOrEqual(documents.x)
  expect(tools.y).toBeGreaterThan(documents.y)
  expect(tools.width).toBeCloseTo(documents.width, 0)
})

// Upstream's docked tool windows carry their tabs along their bottom edge, in this order, with the
// Locals grid showing until a debugger session asks for another one. The editor's stay on top.
test('docks the tool windows with their tabs along the bottom', async () => {
  const documents = page.locator('.flexlayout__tabset').nth(0)
  const tools = page.locator('.flexlayout__tabset').nth(1)
  await expect(tools.getByRole('tab').first()).toHaveText('Locals')
  await expect(tools.getByRole('tab').nth(1)).toHaveText('Exception Settings')
  await expect(page.getByRole('tab', { name: 'Locals' })).toHaveAttribute('aria-selected', 'true')

  const locals = await page.getByRole('tabpanel', { name: 'Locals' }).boundingBox()
  const localsTab = await page.getByRole('tab', { name: 'Locals' }).boundingBox()
  const start = await page.getByRole('tabpanel', { name: 'Start' }).boundingBox()
  const startTab = await page.getByRole('tab', { name: 'Start' }).boundingBox()
  if (!locals || !localsTab || !start || !startTab)
    throw new Error('The tab strips are not laid out.')
  expect(localsTab.y).toBeGreaterThanOrEqual(locals.y + locals.height - 1)
  expect(startTab.y).toBeLessThan(start.y)
  await expect(documents.getByRole('tab').first()).toHaveText('Start')
})

test('puts a tool window back in its own dock after it has been closed', async () => {
  // The close button only shows on the tab that is in front, so the one to close is brought up first.
  await page.getByRole('tab', { name: 'Output' }).click()
  await page.getByRole('tab', { name: 'Output' }).locator('.flexlayout__tab_button_trailing').click()
  await expect(page.getByRole('tab', { name: 'Output' })).toHaveCount(0)

  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.locator('.menu-popup').getByText('Output', { exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Output' })).toBeVisible()
  // Back where it came from, whatever tab set happened to be active.
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(2)
})

test('splits the editor group without disturbing the tool windows', async () => {
  await page.getByRole('button', { name: 'Open Assembly' }).first().click()
  await page.locator('.tree-row[data-kind="assembly"] .tree-expander').first().click()
  await page.locator('.tree-row[data-kind="module"]').filter({ hasText: 'dnSpy.Backend.Contracts.dll' }).locator('.tree-expander').click()
  await page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ }).locator('.tree-expander').click()
  await page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^dnSpy\.Backend\.Contracts\.HelloRequest$/ }).dblclick()
  const tab = page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.HelloRequest' })
  await expect(tab).toBeVisible()

  await tab.click({ button: 'right' })
  await page.getByRole('menu', { name: 'Tab actions' }).getByRole('menuitem', { name: 'New Tab' }).click()
  await tab.last().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Tab actions' }).getByRole('menuitem', { name: 'New Horizontal Tab Group' }).click()
  // The editor group, the one the split added, and the tool window dock.
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(3)

  const output = await page.getByRole('tab', { name: 'Output' }).boundingBox()
  const group = await tab.last().boundingBox()
  if (!output || !group)
    throw new Error('The split is not laid out.')
  expect(group.y).toBeLessThan(output.y)

  // "Close All Tabs" reaches the documents only; the tool windows are a dock of their own.
  await tab.last().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Tab actions' }).getByRole('menuitem', { name: 'Close All Tabs' }).click()
  await expect(page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.HelloRequest' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Output' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Locals' })).toBeVisible()
})
