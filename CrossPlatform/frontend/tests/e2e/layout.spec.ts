import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The window's default shape, the way upstream dnSpy has it: the Assembly Explorer fills the left edge
// top to bottom, and what is left splits between the editor over the tool windows. None of the three is a
// border — a border carries its tabs down the outer edge of the window, where dnSpy's explorer wears its
// title across the top of its own column — and the tool windows sit under the editor rather than running
// under the explorer as well. Every docked pane wears a caption over it: the pane's title, the dotted rule
// that fills the bar, and the pane's own window menu and close buttons at its end. A dock shows a tab row
// only when it holds more than one window — one window is not a tab group — and when it does, the row runs
// along the bottom edge of the pane, under it, where dnSpy's tool windows carry theirs. The editor's row
// is always there, and stays on top.
const contractsAssemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')

let application: ElectronApplication
let page: Page
let userDataDirectory: string

/** The tab set a docked tab lives in, found by the tab rather than by its position among the three. */
const tabsetWith = (tabName: string): Locator => page.locator('.flexlayout__tabset').filter({ has: page.getByRole('tab', { name: tabName, exact: true }) })

/** A docked pane's caption. The explorer is found this way as well as the tool windows: its tab is at the
 * far end of its column, a long way from the caption the pane's own buttons sit in. */
const captionWith = (title: string): Locator => page.locator('.dock-caption').filter({ has: page.locator('.dock-caption-title', { hasText: title }) })

/** What a docked pane fills: the caption and the window under it, without the tab row below them — the
 * pane's own box is what the row sits under, so it is what a row-at-the-bottom check measures against.
 * A dock of one window fills its whole tab set, since it shows no row. */
const paneWith = (title: string): Locator => page.getByRole('tabpanel').filter({ has: captionWith(title) })

/** Drags a docked window by its tab onto a point in the layout, which is the only way a window is docked by
 * hand. The moves in between are the drag: one jump from the tab to the drop lands as a click. */
const dragTab = async (tabName: string, onto: Locator): Promise<void> => {
  const source = await page.getByRole('tab', { name: tabName }).boundingBox()
  const target = await onto.boundingBox()
  if (!source || !target)
    throw new Error('The ends of the drag are not laid out.')
  const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1)
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10)
  await page.mouse.up()
}

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
  await expect(captionWith('Assembly Explorer')).toBeVisible()
  await expect(page.locator('.flexlayout__border')).toHaveCount(0)
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(3)
  // No ⤢ on any of the three tab sets: the panes wear captions instead, and the buttons at the end of a
  // caption have taken over what the ⤢ was for.
  await expect(page.locator('.flexlayout__tab_toolbar_button')).toHaveCount(0)
  // The explorer is a dock of one window, and one window is not a tab group: it carries no tab row, over
  // the pane or under it. The caption is the only bar the pane wears.
  await expect(page.getByRole('tab', { name: 'Assembly Explorer' })).toHaveCount(0)

  const explorer = await paneWith('Assembly Explorer').boundingBox()
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

// A layout an earlier run saved comes back wearing that run's attributes, which is how a run from before
// the panes grew captions brings the ⤢ back with it, and how a tab row saved over a single window comes
// back with the window it belongs to. The shape is put right on the way in, so a window that has been run
// before still opens the way this one lays it out.
test('brings a layout saved by an earlier run up to the current shape', async () => {
  const legacyLayout = {
    global: { tabEnableRename: false, tabSetMinWidth: 120, tabSetMinHeight: 80 },
    borders: [],
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          id: 'explorer-dock',
          weight: 43,
          enableDeleteWhenEmpty: false,
          children: [{ type: 'tab', id: 'explorer', name: 'Assembly Explorer', component: 'explorer', enableClose: true }],
        },
        {
          type: 'row',
          children: [
            {
              type: 'tabset',
              id: 'documents',
              enableDeleteWhenEmpty: false,
              children: [{ type: 'tab', id: 'start', name: 'Start', component: 'start', enableClose: false }],
            },
            {
              type: 'tabset',
              id: 'toolwindows',
              weight: 65,
              enableDeleteWhenEmpty: false,
              children: [
                { type: 'tab', id: 'locals', name: 'Locals', component: 'locals', enableClose: true },
                { type: 'tab', id: 'callstack', name: 'Call Stack', component: 'callstack', enableClose: true },
              ],
            },
          ],
        },
      ],
    },
  }
  await page.evaluate((layout) => localStorage.setItem('dnspy.layout.v3', JSON.stringify(layout)), legacyLayout)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  await expect(page.locator('.flexlayout__tab_toolbar_button')).toHaveCount(0)
  // The explorer is still a dock of one window, whichever way the run that saved it had it, so it keeps
  // its caption and shows no row.
  await expect(captionWith('Assembly Explorer')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Assembly Explorer' })).toHaveCount(0)

  // The tool windows' two are a group, and their row is brought down to the bottom edge of their pane.
  const toolsTab = await page.getByRole('tab', { name: 'Locals' }).boundingBox()
  const toolsPane = await paneWith('Locals').boundingBox()
  if (!toolsTab || !toolsPane)
    throw new Error('The tool window tab row is not laid out.')
  expect(toolsTab.y).toBeGreaterThanOrEqual(toolsPane.y + toolsPane.height - 1)
})

// Upstream's docked tool windows carry their tabs along their bottom edge, in this order, with the Locals
// grid showing until a debugger session asks for another one. The editor's stay on top, above the pane.
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

  // The caption titles the pane, and the pane's content starts under it rather than over it.
  const caption = captionWith('Locals')
  await expect(caption.locator('.dock-caption-title')).toHaveText('Locals')
  const captionBox = await caption.boundingBox()
  const header = await page.locator('.debug-table-header').first().boundingBox()
  if (!captionBox || !header)
    throw new Error('The Locals caption is not laid out.')
  expect(header.y).toBeGreaterThanOrEqual(captionBox.y + captionBox.height - 1)
  // The pane that was last worked in is the blue one, as it is upstream.
  await page.getByRole('tab', { name: 'Locals' }).click()
  await expect(caption).toHaveClass(/dock-caption-active/)
  await expect(captionWith('Assembly Explorer')).not.toHaveClass(/dock-caption-active/)

  // The pane's dropdown lists the windows docked in it — the same six the strip along its bottom edge
  // switches between.
  await caption.locator('.dock-caption-menu').click()
  const menu = page.locator('.flexlayout__popup_menu_item')
  await expect(menu).toHaveText(['Locals', 'Exception Settings', 'Call Stack', 'Search', 'Analyzer', 'Watch 1'])
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

// A dock of one window has no row to drag a window in by, and a window dragged over the pane itself lands
// in the dock it was dropped on: that is what turns one window into a group, and the group wears its row.
test('gives a dock its tab row when a second window is dragged in beside the first', async () => {
  const explorer = paneWith('Assembly Explorer')
  await expect(page.getByRole('tab', { name: 'Assembly Explorer' })).toHaveCount(0)

  // Dropped over the middle of the pane rather than near one of its edges: an edge opens a column of its
  // own beside it, while the middle joins the window to the dock that is already there.
  await dragTab('Locals', explorer)

  // The dock holds two windows now, so it is a tab group, and it wears a row of them along the bottom
  // edge of the pane — below the caption and below the pane itself.
  const tab = page.getByRole('tab', { name: 'Assembly Explorer' })
  await expect(tab).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Locals' })).toBeVisible()
  // The window that was dragged in is the one showing; the explorer's own goes back up so there is a pane
  // under the row to measure against.
  await tab.click()
  const tabBox = await tab.boundingBox()
  const pane = await paneWith('Assembly Explorer').boundingBox()
  if (!tabBox || !pane)
    throw new Error('The explorer tab row is not laid out.')
  expect(tabBox.y).toBeGreaterThanOrEqual(pane.y + pane.height - 1)
  // The window left the dock it came from rather than being copied.
  await expect(tabsetWith('Call Stack').getByRole('tab')).toHaveText(['Exception Settings', 'Call Stack', 'Search', 'Analyzer', 'Watch 1'])
})

test('puts the explorer back in its own column after it has been closed', async () => {
  const window = await page.locator('.workspace-host').boundingBox()
  const documents = await tabsetWith('Start').boundingBox()
  if (!window || !documents)
    throw new Error('The workspace is not laid out.')

  await captionWith('Assembly Explorer').locator('.dock-caption-close').click()
  await expect(captionWith('Assembly Explorer')).toHaveCount(0)
  // The column goes with it rather than sitting there empty, so the editor takes the width back.
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(2)
  const widened = await tabsetWith('Start').boundingBox()
  if (!widened)
    throw new Error('The editor is not laid out.')
  expect(widened.width).toBeGreaterThan(documents.width)

  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.getByRole('menuitem', { name: /^Assembly Explorer/ }).click()
  await expect(captionWith('Assembly Explorer')).toBeVisible()
  // The View menu builds the column back as the default layout has it rather than as a bare tab set: the
  // pane's own caption, and no row while the explorer is the only window in it.
  await expect(page.getByRole('tab', { name: 'Assembly Explorer' })).toHaveCount(0)
  // Back where it came from: a column of its own, beside the editor rather than over it, and the height
  // of the editor and the tool windows together.
  await expect(page.locator('.flexlayout__tabset')).toHaveCount(3)
  const explorer = await paneWith('Assembly Explorer').boundingBox()
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
