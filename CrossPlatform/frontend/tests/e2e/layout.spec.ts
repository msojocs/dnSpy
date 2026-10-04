import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The window's default shape, the way upstream dnSpy has it: the Assembly Explorer fills the left edge
// top to bottom, and what is left splits between the editor over the tool windows. None of the three is a
// border — a border carries its tabs down the outer edge of the window, where dnSpy's explorer wears its
// title across the top of its own column — and the tool windows sit under the editor rather than running
// under the explorer as well.
const contractsAssemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')

let application: ElectronApplication
let page: Page
let userDataDirectory: string

/** The tab set a docked tab lives in, found by the tab rather than by its position among the three. */
const tabsetWith = (tabName: string): Locator => page.locator('.flexlayout__tabset').filter({ has: page.getByRole('tab', { name: tabName, exact: true }) })

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

test('starts with the explorer down the left edge and the tool windows under the editor', async () => {
  await expect(page.getByRole('tab', { name: 'Assembly Explorer' }).first()).toBeVisible()
  await expect(page.locator('.flexlayout__border')).toHaveCount(0)
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(3)

  const explorer = await tabsetWith('Assembly Explorer').boundingBox()
  const documents = await tabsetWith('Start').boundingBox()
  const tools = await tabsetWith('Locals').boundingBox()
  if (!explorer || !documents || !tools)
    throw new Error('The docks are not laid out.')
  expect(explorer.x).toBeLessThan(documents.x)
  // The right-hand column is one column wide: the tool windows start beside the explorer rather than at
  // the window's left edge, and are as wide as the editor above them.
  expect(tools.x).toBeGreaterThanOrEqual(documents.x)
  expect(tools.y).toBeGreaterThan(documents.y)
  expect(tools.width).toBeCloseTo(documents.width, 0)
  // The explorer is as tall as the whole right-hand column, not just as tall as the editor in it.
  expect(explorer.height).toBeGreaterThan(documents.height + tools.height - 12)
  // The shares dnSpy's window gives them: a little under a third of the width, and the lower two fifths
  // of the column beside it.
  expect(explorer.width / (explorer.width + documents.width)).toBeGreaterThan(0.28)
  expect(explorer.width / (explorer.width + documents.width)).toBeLessThan(0.33)
  expect(tools.height / (documents.height + tools.height)).toBeGreaterThan(0.36)
  expect(tools.height / (documents.height + tools.height)).toBeLessThan(0.44)
})

// Upstream's docked tool windows carry their tabs along their bottom edge, in this order, with the Locals
// grid showing until a debugger session asks for another one. The editor's stay on top.
test('docks the tool windows with their tabs along the bottom', async () => {
  const documents = tabsetWith('Start')
  const tools = tabsetWith('Locals')
  // The six dnSpy opens with, and no others: the rest are on the View menu rather than in the dock.
  await expect(tools.getByRole('tab')).toHaveText(['Locals', 'Exception Settings', 'Call Stack', 'Search', 'Analyzer', 'Watch 1'])
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

test('puts the explorer back in its own column after it has been closed', async () => {
  const window = await page.locator('.workspace-host').boundingBox()
  const documents = await tabsetWith('Start').boundingBox()
  if (!window || !documents)
    throw new Error('The workspace is not laid out.')

  await page.getByRole('tab', { name: 'Assembly Explorer' }).locator('.flexlayout__tab_button_trailing').click()
  await expect(page.getByRole('tab', { name: 'Assembly Explorer' })).toHaveCount(0)
  // The column goes with it rather than sitting there empty, so the editor takes the width back.
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(2)
  const widened = await tabsetWith('Start').boundingBox()
  if (!widened)
    throw new Error('The editor is not laid out.')
  expect(widened.width).toBeGreaterThan(documents.width)

  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.getByRole('menuitem', { name: /^Assembly Explorer/ }).click()
  await expect(page.getByRole('tab', { name: 'Assembly Explorer' })).toBeVisible()
  // Back where it came from: a column of its own, beside the editor rather than over it, and the height
  // of the editor and the tool windows together.
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(3)
  const explorer = await tabsetWith('Assembly Explorer').boundingBox()
  const tools = await tabsetWith('Locals').boundingBox()
  const narrowed = await tabsetWith('Start').boundingBox()
  if (!explorer || !tools || !narrowed)
    throw new Error('The explorer is not laid out.')
  expect(explorer.x).toBeLessThan(narrowed.x)
  expect(explorer.height).toBeGreaterThan(narrowed.height + tools.height - 12)
  expect(explorer.width / window.width).toBeGreaterThan(0.28)
  expect(explorer.width / window.width).toBeLessThan(0.33)
})

test('puts a tool window back in its own dock after it has been closed', async () => {
  // Output is not one of the six the default layout opens with, so it is brought up from the View menu
  // first, which is also where it comes back from.
  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.getByRole('menuitem', { name: /^Output/ }).click()
  await expect(page.getByRole('tab', { name: 'Output' })).toBeVisible()

  await page.getByRole('tab', { name: 'Output' }).click()
  await page.getByRole('tab', { name: 'Output' }).locator('.flexlayout__tab_button_trailing').click()
  await expect(page.getByRole('tab', { name: 'Output' })).toHaveCount(0)

  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.locator('.menu-popup').getByText('Output', { exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Output' })).toBeVisible()
  // Back where it came from, whatever tab set happened to be active.
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(3)
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
  // The explorer's column, the editor group, the one the split added, and the tool window dock.
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(4)

  const tools = await tabsetWith('Locals').boundingBox()
  const group = await tab.last().boundingBox()
  if (!tools || !group)
    throw new Error('The split is not laid out.')
  expect(group.y).toBeLessThan(tools.y)

  // "Close All Tabs" reaches the documents only; the tool windows are a dock of their own.
  await tab.last().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Tab actions' }).getByRole('menuitem', { name: 'Close All Tabs' }).click()
  await expect(page.getByRole('tab', { name: 'dnSpy.Backend.Contracts.HelloRequest' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Locals' })).toBeVisible()
})
