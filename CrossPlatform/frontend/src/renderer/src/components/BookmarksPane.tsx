import { useEffect, useMemo, useRef, useState } from 'react'
import { showPopupMenu, type IPopupMenuItem, type PopupMenuEntry } from 'flexlayout-react'
import { Download, Play, Tag, Trash2, Upload, X } from 'lucide-react'
import { bookmarkEntries, filterBookmarks, parseBookmarkEntries, useAppStore } from '../app-store'
import type { Bookmark } from '../app-store'
import { clearBookmarks, stepBookmark, toggleBookmarkAtCaret } from '../bookmark-commands'
import { useLanguage } from '../localization'

// dnSpy's Bookmarks window: a four-column list of every bookmark in the session, with a search box, a
// toolbar and a context menu carrying the same commands the View menu offers. The search box takes
// dnSpy's prefixes — `n:` name, `l:` label, `o:` location, `m:` module — as well as bare words, which
// match any of the four.

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** `Namespace.Type.Method(): IL_0007`, the way dnSpy's Location column reads. */
const bookmarkLocation = (bookmark: Bookmark): string => {
  const offset = `IL_${bookmark.ilOffset.toString(16).toUpperCase().padStart(4, '0')}`
  return bookmark.description ? `${bookmark.description}: ${offset}` : offset
}

const bookmarkRowText = (bookmark: Bookmark): string =>
  [bookmark.name, bookmark.labels.join(', '), bookmarkLocation(bookmark), fileName(bookmark.modulePath)].join('\t')

const menuItem = (key: string, label: string, onSelect: () => void, disabled = false, shortcut?: string): IPopupMenuItem => ({
  key,
  content: (
    <>
      <span className="document-tab-menu-label">{label}</span>
      {shortcut && <span className="document-tab-menu-shortcut">{shortcut}</span>}
    </>
  ),
  disabled,
  onSelect,
})

export const BookmarksPane = (): React.JSX.Element => {
  const bookmarks = useAppStore((state) => state.bookmarks)
  const activeBookmarkId = useAppStore((state) => state.activeBookmarkId)
  const goToBookmark = useAppStore((state) => state.goToBookmark)
  const removeBookmarks = useAppStore((state) => state.removeBookmarks)
  const setBookmarksEnabled = useAppStore((state) => state.setBookmarksEnabled)
  const renameBookmark = useAppStore((state) => state.renameBookmark)
  const setBookmarkLabels = useAppStore((state) => state.setBookmarkLabels)
  const importBookmarks = useAppStore((state) => state.importBookmarks)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<{ id: string; field: 'name' | 'labels' }>()
  const [status, setStatus] = useState('')
  const { t } = useLanguage()
  const rows = useMemo(() => filterBookmarks(bookmarks, query), [bookmarks, query])
  const hiddenCount = bookmarks.length - rows.length

  // A selection that outlived its rows would leave the toolbar acting on nothing.
  useEffect(() => {
    setSelected((current) => {
      const alive = current.filter((id) => bookmarks.some((bookmark) => bookmark.id === id))
      return alive.length === current.length ? current : alive
    })
  }, [bookmarks])

  const selectRow = (id: string, event: React.MouseEvent): void => {
    setSelected((current) => {
      if (event.ctrlKey || event.metaKey)
        return current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]
      if (event.shiftKey && current.length > 0) {
        const from = rows.findIndex((bookmark) => bookmark.id === current[current.length - 1])
        const to = rows.findIndex((bookmark) => bookmark.id === id)
        if (from >= 0 && to >= 0)
          return rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((bookmark) => bookmark.id)
      }
      return [id]
    })
  }

  // Everything the toolbar and the context menu act on: the selection, or every row in view when
  // nothing is selected — dnSpy's "the matching bookmarks" when there is no selection.
  const targets = (): Bookmark[] => selected.length > 0 ? rows.filter((bookmark) => selected.includes(bookmark.id)) : rows

  const exportBookmarks = async (): Promise<void> => {
    const chosen = targets()
    if (chosen.length === 0)
      return
    const text = JSON.stringify({ version: 1, bookmarks: bookmarkEntries(chosen) }, null, 2)
    const saved = await window.dnSpy.saveCode('bookmarks.json', text)
    setStatus(saved ? t('Exported {count} bookmark(s) to {path}.', { count: chosen.length, path: saved }) : '')
  }

  const runImport = async (): Promise<void> => {
    let text: string | undefined
    try {
      text = await window.dnSpy.readTextFile()
    } catch {
      // A file the host could not read is reported the same way a damaged one is.
      setStatus(t('The bookmark file could not be read.'))
      return
    }
    if (text === undefined)
      return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setStatus(t('The bookmark file could not be read.'))
      return
    }
    const entries = parseBookmarkEntries(parsed)
    if (entries.length === 0) {
      setStatus(t('The bookmark file could not be read.'))
      return
    }
    setStatus(t('Imported {count} bookmark(s).', { count: importBookmarks(entries) }))
  }

  const toggleMatching = (): void => {
    // dnSpy's Enable/Disable: if anything in view is still enabled, turn the lot off; otherwise back on.
    const enabled = rows.some((bookmark) => bookmark.enabled)
    setBookmarksEnabled(rows.map((bookmark) => bookmark.id), !enabled)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if ((event.target as HTMLElement).matches('input, textarea'))
      return
    if (event.key === 'Delete' && selected.length > 0) {
      event.preventDefault()
      removeBookmarks(selected)
    } else if (event.key === 'F2' && selected.length > 0) {
      event.preventDefault()
      setEditing({ id: selected[0], field: 'name' })
    } else if (event.key === 'Enter' && selected.length > 0) {
      event.preventDefault()
      void goToBookmark(selected[0])
    } else if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelected(rows.map((bookmark) => bookmark.id))
    } else if (event.ctrlKey && event.key.toLowerCase() === 'c' && selected.length > 0) {
      event.preventDefault()
      void navigator.clipboard?.writeText(targets().map(bookmarkRowText).join('\n'))
    }
  }

  const showContextMenu = (bookmark: Bookmark, event: React.MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    if (!selected.includes(bookmark.id))
      setSelected([bookmark.id])
    const chosen = selected.includes(bookmark.id) ? targets() : [bookmark]
    const items: PopupMenuEntry[] = [
      menuItem('go-to', t('Go To'), () => void goToBookmark(bookmark.id)),
      menuItem('rename', t('Rename'), () => setEditing({ id: bookmark.id, field: 'name' }), false, 'F2'),
      menuItem('labels', t('Edit Labels'), () => setEditing({ id: bookmark.id, field: 'labels' })),
      { type: 'divider', key: 'bookmark-actions' },
      menuItem('enable', t('Enable'), () => setBookmarksEnabled(chosen.map((item) => item.id), true)),
      menuItem('disable', t('Disable'), () => setBookmarksEnabled(chosen.map((item) => item.id), false)),
      menuItem('remove', t('Remove'), () => removeBookmarks(chosen.map((item) => item.id)), false, 'Del'),
      menuItem('remove-all', t('Clear Bookmarks'), clearBookmarks),
      { type: 'divider', key: 'bookmark-files' },
      menuItem('export', t('Export Bookmarks'), () => void exportBookmarks()),
    ]
    showPopupMenu({
      anchor: { x: event.clientX, y: event.clientY },
      returnFocusTo: event.currentTarget,
      title: t('Bookmarks'),
      items,
      onClose: () => undefined,
    })
  }

  return (
    <div className="bookmarks-pane" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="bookmarks-toolbar">
        <button className="icon-button" title={t('Toggle Bookmark')} aria-label={t('Toggle Bookmark')} onClick={toggleBookmarkAtCaret}><Tag size={14} /></button>
        <button className="icon-button" title={t('Previous Bookmark')} aria-label={t('Previous Bookmark')} onClick={() => stepBookmark(-1)}>↑</button>
        <button className="icon-button" title={t('Next Bookmark')} aria-label={t('Next Bookmark')} onClick={() => stepBookmark(1)}>↓</button>
        <button className="icon-button" title={t('Previous Bookmark With Same Label')} aria-label={t('Previous Bookmark With Same Label')} onClick={() => stepBookmark(-1, 'label')}>↑<Tag size={9} /></button>
        <button className="icon-button" title={t('Next Bookmark With Same Label')} aria-label={t('Next Bookmark With Same Label')} onClick={() => stepBookmark(1, 'label')}>↓<Tag size={9} /></button>
        <button className="icon-button" title={t('Previous Bookmark In Document')} aria-label={t('Previous Bookmark In Document')} onClick={() => stepBookmark(-1, 'document')}>↑▤</button>
        <button className="icon-button" title={t('Next Bookmark In Document')} aria-label={t('Next Bookmark In Document')} onClick={() => stepBookmark(1, 'document')}>↓▤</button>
        <span className="bookmarks-separator" />
        <button className="icon-button" title={t('Go To')} aria-label={t('Go To')} disabled={selected.length === 0} onClick={() => { if (selected[0]) void goToBookmark(selected[0]) }}><Play size={14} /></button>
        <button className="icon-button" title={t('Remove')} aria-label={t('Remove')} disabled={selected.length === 0} onClick={() => removeBookmarks(selected)}><Trash2 size={14} /></button>
        <button className="icon-button" title={t('Clear Bookmarks')} aria-label={t('Clear Bookmarks')} disabled={bookmarks.length === 0} onClick={clearBookmarks}><X size={14} /></button>
        <span className="bookmarks-separator" />
        <button className="icon-button" title={t('Import Bookmarks')} aria-label={t('Import Bookmarks')} onClick={() => void runImport()}><Upload size={14} /></button>
        <button className="icon-button" title={t('Export Bookmarks')} aria-label={t('Export Bookmarks')} disabled={rows.length === 0} onClick={() => void exportBookmarks()}><Download size={14} /></button>
      </div>
      <div className="bookmarks-search">
        <input
          aria-label={t('Search bookmarks')}
          placeholder={t('Search (n: name, l: label, o: location, m: module)')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="icon-button" aria-label={t('Reset Search')} title={t('Reset Search')} disabled={query === ''} onClick={() => setQuery('')}><X size={13} /></button>
      </div>
      <div className="bookmarks-table" role="table" aria-label={t('Bookmarks')}>
        <div className="bookmarks-header" role="row">
          <span role="columnheader">{t('Name')}</span>
          <span role="columnheader">{t('Labels')}</span>
          <span role="columnheader">{t('Location')}</span>
          <span role="columnheader">{t('Module')}</span>
        </div>
        <div className="bookmarks-rows">
          {rows.map((bookmark) => (
            <div
              className={`bookmark-row${selected.includes(bookmark.id) ? ' selected' : ''}${bookmark.id === activeBookmarkId ? ' active' : ''}${bookmark.enabled ? '' : ' bookmark-disabled'}`}
              role="row"
              key={bookmark.id}
              onMouseDown={(event) => selectRow(bookmark.id, event)}
              onDoubleClick={() => void goToBookmark(bookmark.id)}
              onContextMenu={(event) => showContextMenu(bookmark, event)}
            >
              <span className="bookmark-name-cell">
                <input
                  type="checkbox"
                  checked={bookmark.enabled}
                  aria-label={t(bookmark.enabled ? 'Disable {name}' : 'Enable {name}', { name: bookmark.name })}
                  onChange={() => setBookmarksEnabled([bookmark.id], !bookmark.enabled)}
                />
                {editing?.id === bookmark.id && editing.field === 'name' ? (
                  <BookmarkTextInput
                    value={bookmark.name}
                    label={t('Name')}
                    onCommit={(value) => { renameBookmark(bookmark.id, value); setEditing(undefined) }}
                    onCancel={() => setEditing(undefined)}
                  />
                ) : (
                  <span
                    title={bookmark.name}
                    onDoubleClick={(event) => { event.stopPropagation(); setEditing({ id: bookmark.id, field: 'name' }) }}
                  >{bookmark.name}</span>
                )}
              </span>
              <span className="bookmark-labels-cell">
                {editing?.id === bookmark.id && editing.field === 'labels' ? (
                  <BookmarkTextInput
                    value={bookmark.labels.join(', ')}
                    label={t('Labels')}
                    onCommit={(value) => { setBookmarkLabels(bookmark.id, value.split(',')); setEditing(undefined) }}
                    onCancel={() => setEditing(undefined)}
                  />
                ) : (
                  <span
                    title={bookmark.labels.join(', ')}
                    onDoubleClick={(event) => { event.stopPropagation(); setEditing({ id: bookmark.id, field: 'labels' }) }}
                  >{bookmark.labels.join(', ')}</span>
                )}
              </span>
              <span title={bookmarkLocation(bookmark)}>{bookmarkLocation(bookmark)}</span>
              <span title={bookmark.modulePath}>{fileName(bookmark.modulePath)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="bookmarks-footer">
        {status && <span className="bookmarks-status">{status}</span>}
        <span className="status-spacer" />
        {hiddenCount > 0 && <span>{t('{count} filtered out', { count: hiddenCount })}</span>}
        <span>{t('{count} bookmark(s)', { count: rows.length })}</span>
        <button className="icon-button" title={t('Enable/Disable Matching Bookmarks')} aria-label={t('Enable/Disable Matching Bookmarks')} disabled={rows.length === 0} onClick={toggleMatching}>
          {t(rows.some((bookmark) => bookmark.enabled) ? 'Disable Matching' : 'Enable Matching')}
        </button>
        <button className="icon-button" title={t('Remove Matching Bookmarks')} aria-label={t('Remove Matching Bookmarks')} disabled={rows.length === 0} onClick={() => removeBookmarks(rows.map((bookmark) => bookmark.id))}><Trash2 size={13} /></button>
      </div>
    </div>
  )
}

// Commits once: Escape must not be undone by the blur that follows the input being removed.
const BookmarkTextInput = ({ value, label, onCommit, onCancel }: { value: string; label: string; onCommit(value: string): void; onCancel(): void }): React.JSX.Element => {
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)
  useEffect(() => inputRef.current?.select(), [])
  const finish = (commit: boolean): void => {
    if (doneRef.current)
      return
    doneRef.current = true
    if (commit)
      onCommit(text)
    else
      onCancel()
  }
  return (
    <input
      ref={inputRef}
      className="bookmark-edit"
      aria-label={label}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter')
          finish(true)
        else if (event.key === 'Escape')
          finish(false)
      }}
    />
  )
}
