import type { MenuItem } from './edit-menu'
import type { TranslationValues } from '../localization'

export interface FileMenuContext {
  t(message: string, values?: TranslationValues): string
  hasWorkspace: boolean
  /** Whether the workspace holds a module, which is what "Save Module..." acts on. */
  hasModule: boolean
  /** Whether an edit is unsaved. dnSpy gates Save and Save All on there being something to write. */
  dirty: boolean
  /** The workspace sets the user opened before, most recent first; each is the path list of one open. */
  recentWorkspaces: string[][]
  onOpen(): void
  onOpenRecent(paths: string[]): void
  onSave(): void
  onSaveModule(): void
  onSaveAll(): void
  onReloadAll(): void
  onCloseAll(): void
  onSortAssemblies(): void
  onQuit(): void
}

interface FileEntry {
  group: number
  order: number
  label(ctx: FileMenuContext): string
  shortcut?: string
  /** Only consulted for entries that have an action or a submenu; the rest render disabled. */
  enabled?(ctx: FileMenuContext): boolean
  action?(ctx: FileMenuContext): void
  /** A submenu in place of an action — only "Recent Files" has one, and its entries are the sessions. */
  submenu?(ctx: FileMenuContext): MenuItem[]
}

// dnSpy's group order constants (dnSpy.Contracts.DnSpy/Menus/MenuConstants.cs). The numeric prefix sorts
// the groups, and a separator goes between them — the rule MenuService.CreateMenuItems applies.
const GROUP_SAVE = 0
const GROUP_OPEN = 1000
const GROUP_EXIT = 1000000

const always = (): boolean => true

/**
 * dnSpy's recent-file list: one entry per remembered file, numbered, under the "Recent Files" submenu.
 * This port remembers the path list of each open rather than single files, so an entry names the first
 * of its paths and says how many more came with it.
 */
const recentFiles = (ctx: FileMenuContext): MenuItem[] =>
  ctx.recentWorkspaces.map((paths, index) => ({
    label: `${index + 1}  ${recentLabel(paths, ctx.t('Workspace'))}`,
    action: () => ctx.onOpenRecent(paths),
  }))

export const recentLabel = (paths: string[], workspaceLabel: string): string => {
  const first = paths[0]?.split(/[\\/]/).at(-1) ?? workspaceLabel
  return paths.length > 1 ? `${first} +${paths.length - 1}` : first
}

/**
 * dnSpy's File menu (AppMenus.cs + the ExportMenuItem registrations across dnSpy.Documents.Tabs,
 * dnSpy.AsmEditor and MainApp), in the order its Group and Order values give. Entries this port has no
 * command for — Export to Project, Open from GAC, Open List, the Close* sweeps, Restart as
 * Administrator — keep dnSpy's place and render disabled, so the menu still reads as dnSpy's.
 */
const FILE_ENTRIES: FileEntry[] = [
  // 0 — Save
  { group: GROUP_SAVE, order: 0, label: (ctx) => ctx.t('Export to Project...'), enabled: () => false },
  // "Save" is ApplicationCommands.Save, which has no Header of its own: the header is the command's own
  // text, and its gesture is SaveKey (Ctrl+S).
  { group: GROUP_SAVE, order: 10, label: (ctx) => ctx.t('Save'), shortcut: 'Ctrl+S', enabled: (ctx) => ctx.hasWorkspace && ctx.dirty, action: (ctx) => ctx.onSave() },
  { group: GROUP_SAVE, order: 20, label: (ctx) => ctx.t('Save Module...'), enabled: (ctx) => ctx.hasModule, action: (ctx) => ctx.onSaveModule() },
  { group: GROUP_SAVE, order: 30, label: (ctx) => ctx.t('Save All...'), shortcut: 'Ctrl+Shift+S', enabled: (ctx) => ctx.hasWorkspace && ctx.dirty, action: (ctx) => ctx.onSaveAll() },

  // 1000 — Open and the commands that work on what is open
  { group: GROUP_OPEN, order: 0, label: (ctx) => ctx.t('Open...'), shortcut: 'Ctrl+O', enabled: always, action: (ctx) => ctx.onOpen() },
  { group: GROUP_OPEN, order: 10, label: (ctx) => ctx.t('Open from GAC...'), shortcut: 'Ctrl+Shift+O', enabled: () => false },
  { group: GROUP_OPEN, order: 20, label: (ctx) => ctx.t('Open List...'), enabled: () => false },
  { group: GROUP_OPEN, order: 30, label: (ctx) => ctx.t('Recent Files'), enabled: (ctx) => ctx.recentWorkspaces.length > 0, submenu: recentFiles },
  { group: GROUP_OPEN, order: 40, label: (ctx) => ctx.t('Reload All Assemblies'), enabled: (ctx) => ctx.hasWorkspace, action: (ctx) => ctx.onReloadAll() },
  // Close All and Close Old In-Memory Modules share dnSpy's Order 50; the stable sort keeps this order.
  { group: GROUP_OPEN, order: 50, label: (ctx) => ctx.t('Close All'), enabled: (ctx) => ctx.hasWorkspace, action: (ctx) => ctx.onCloseAll() },
  { group: GROUP_OPEN, order: 50, label: (ctx) => ctx.t('Close Old In-Memory Modules'), enabled: () => false },
  { group: GROUP_OPEN, order: 55, label: (ctx) => ctx.t('Close All Framework Assemblies'), enabled: () => false },
  { group: GROUP_OPEN, order: 60, label: (ctx) => ctx.t('Close All Missing Files'), enabled: () => false },
  { group: GROUP_OPEN, order: 100, label: (ctx) => ctx.t('Sort Assemblies'), enabled: (ctx) => ctx.hasWorkspace, action: (ctx) => ctx.onSortAssemblies() },

  // 1000000 — Exit
  { group: GROUP_EXIT, order: 900000, label: (ctx) => ctx.t('Restart as Administrator'), enabled: () => false },
  { group: GROUP_EXIT, order: 1000000, label: (ctx) => ctx.t('Exit'), shortcut: 'Alt+F4', enabled: always, action: (ctx) => ctx.onQuit() },
]

export const buildFileMenu = (ctx: FileMenuContext): MenuItem[] => {
  const groups = new Map<number, FileEntry[]>()
  for (const entry of FILE_ENTRIES) {
    const entries = groups.get(entry.group)
    if (entries)
      entries.push(entry)
    else
      groups.set(entry.group, [entry])
  }

  const items: MenuItem[] = []
  for (const group of [...groups.keys()].sort((a, b) => a - b)) {
    if (items.length > 0)
      items.push({ separator: true })
    // Array.prototype.sort is stable, so entries sharing an order keep their table order.
    for (const entry of groups.get(group)!.sort((a, b) => a.order - b.order)) {
      const submenu = entry.submenu?.(ctx)
      const action = entry.action
      items.push({
        label: entry.label(ctx),
        shortcut: entry.shortcut,
        disabled: submenu ? entry.enabled?.(ctx) === false : action ? entry.enabled?.(ctx) === false : true,
        submenu,
        action: action ? () => action(ctx) : undefined,
      })
    }
  }
  return items
}
