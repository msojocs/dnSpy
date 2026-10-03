import { useMemo, useState } from 'react'
import { useLanguage } from '../localization'

/**
 * The identity a row's component is rendered under, for a caller that has to bind a value this list knows
 * nothing about — the workspace a dialog edits in, say. `ListEditor` renders a row's dialog or inline
 * editor as a component of its own, and a component made fresh on every render is a different type each
 * time: React would unmount the row, taking with it whatever was typed into it. Holding the factory's
 * result here is what keeps the identity still, and `deps` is what it is allowed to change on.
 */
export const useRowComponent = <P,>(create: () => React.ComponentType<P>, deps: React.DependencyList): React.ComponentType<P> =>
  // The factory is new on every render by design — `deps`, not it, is what the identity follows.
  useMemo(create, deps) // eslint-disable-line react-hooks/exhaustive-deps

export interface ListEditorItemProps<T> {
  /** The row's value: the selected row's, or the one `create()` just made. */
  value: T
  /** Whether this is the row Add... opened, which is what picks between dnSpy's two titles. */
  isNew: boolean
  /** Takes the edited row. dnSpy's `IEdit<TVM>.Edit` returns null for Cancel and nothing is written
   * back then — the list is the only place a row lives, so nothing is written until this is called. */
  onAccept(value: T): void
  onCancel(): void
}

/** A row that *is* its editor, for a list whose `ListVM` was built with `inlineEditing: true`. */
export interface ListEditorInlineProps<T> {
  value: T
  onChange(value: T): void
  disabled?: boolean
}

interface ListEditorProps<T> {
  items: T[]
  onChange(items: T[]): void
  /** The text a row shows, which is the item VM's `FullName` — the one property `ListVMControl`'s
   * default data template binds. Ignored by an inline list, whose rows are its own editors. */
  label?(item: T): string
  /** The row Add... starts from: `ListVM<TVM,TModel>.Create()`. */
  create(): T
  /** The dialog that edits one row, for a list that opens one. It is rendered as a component of its
   * own, so it may hold state the way a dialog does. */
  itemDialog?: React.ComponentType<ListEditorItemProps<T>>
  /** The row's own editor, for a list that edits in place — `CANamedArgumentsVM` is the only one, and
   * its button pair is Add / Remove rather than Edit... / Add... / Remove. */
  inlineItem?: React.ComponentType<ListEditorInlineProps<T>>
  /** Where an accepted new row goes — dnSpy's `GetAddIndex`, the end of the list unless overridden. It
   * is handed the row as well, because that is what dnSpy's own override decides with: a parameter's row
   * sits with the other rows its sequence number belongs among. */
  addIndex?(items: T[], value: T): number
  /** dnSpy's `AddItemCanExecute`, for a list that refuses to grow. */
  canAdd?(items: T[]): boolean
  disabled?: boolean
  /** Names the list for screen readers, standing in for the label a WPF ListBox would have. */
  ariaLabel?: string
}

/**
 * dnSpy's `ListVMControl`: a single-selection list with Move Up / Move Down / Edit... / Add... / Remove
 * under it, where every row is edited in a dialog of its own. A left double-click on a row edits it, as
 * the code-behind wires up.
 *
 * The mechanics live here and the row's own fields live in the dialog the caller hands over, which is
 * the split `ListVMControl` has between itself and the `TVM` subclass behind `IEdit<TVM>`:
 *
 * - Edit... reopens the row's value; accepting replaces it in place and leaves the selection where it was.
 * - Add... opens `create()`'s value; accepting inserts it at `addIndex` and selects it.
 * - Remove and the two moves keep the selection on the row the user was working on, which is what
 *   `MyObservableCollection` does — Remove falls to the next row and only then to the previous one.
 *
 * A list built with `inlineEditing: true` — only the custom-attribute named arguments — hands its rows
 * over to `inlineItem` instead: the row *is* the editor, Add writes a fresh `create()` row straight into
 * the list, and the Edit... button has nothing left to do and goes away, which is the pair
 * `ListVMControl`'s visibility bindings pick.
 */
export const ListEditor = <T,>({ items, onChange, label, create, itemDialog, inlineItem, addIndex, canAdd, disabled = false, ariaLabel }: ListEditorProps<T>): React.JSX.Element => {
  const { t } = useLanguage()
  const ItemDialog = itemDialog
  const InlineItem = inlineItem
  const inline = InlineItem !== undefined
  const [selected, setSelected] = useState(-1)
  // The row being edited, plus where it sits — null when Add... opened it, since it has no place yet.
  // `opened` counts openings so that each one keyed to it mounts a dialog of its own: a dialog holds its
  // draft in state, and the instance left over from the last row would still be showing that row.
  const [editing, setEditing] = useState<{ opened: number, index: number | null, value: T, isNew: boolean }>()
  const open = (index: number | null, value: T, isNew: boolean): void => {
    setEditing({ opened: (editing?.opened ?? 0) + 1, index, value, isNew })
  }

  const active = selected >= 0 && selected < items.length ? selected : -1
  const canEdit = !disabled && active >= 0
  const canCreate = !disabled && (canAdd?.(items) ?? true)
  const canRemove = !disabled && active >= 0
  const canMoveUp = !disabled && active > 0
  const canMoveDown = !disabled && active >= 0 && active < items.length - 1

  const insert = (value: T): void => {
    const index = addIndex ? addIndex(items, value) : items.length
    onChange([...items.slice(0, index), value, ...items.slice(index)])
    setSelected(index)
  }

  const accept = (value: T): void => {
    if (!editing) {
      return
    }
    if (editing.index === null) {
      insert(value)
    }
    else {
      onChange(items.map((current, index) => index === editing.index ? value : current))
      setSelected(editing.index)
    }
    setEditing(undefined)
  }

  const remove = (): void => {
    if (!canRemove) {
      return
    }
    onChange(items.filter((_, index) => index !== active))
    setSelected(active < items.length - 1 ? active : items.length - 2)
  }

  const move = (delta: number): void => {
    const target = active + delta
    if (disabled || active < 0 || target < 0 || target >= items.length) {
      return
    }
    const moved = [...items]
    ;[moved[active], moved[target]] = [moved[target], moved[active]]
    onChange(moved)
    setSelected(target)
  }

  return (
    <div className="list-editor">
      <div className="list-editor-list" role="listbox" aria-label={ariaLabel} aria-disabled={disabled}>
        {items.map((item, index) => (
          <div
            key={index}
            role="option"
            aria-selected={index === active}
            className={`list-editor-row${index === active ? ' selected' : ''}${inline ? ' inline' : ''}`}
            title={label?.(item)}
            onClick={() => { setSelected(index) }}
            onDoubleClick={inline ? undefined : () => { setSelected(index); open(index, item, false) }}
          >
            {inline && InlineItem
              ? <InlineItem value={item} disabled={disabled} onChange={(value) => { onChange(items.map((current, at) => at === index ? value : current)) }} />
              : label?.(item)}
          </div>
        ))}
      </div>
      <div className="list-editor-buttons">
        <button type="button" disabled={!canMoveUp} title={t('Move Up')} aria-label={t('Move Up')} onClick={() => { move(-1) }}>↑</button>
        <button type="button" disabled={!canMoveDown} title={t('Move Down')} aria-label={t('Move Down')} onClick={() => { move(1) }}>↓</button>
        {!inline && <button type="button" disabled={!canEdit} onClick={() => { open(active, items[active], false) }}>{t('Edit...')}</button>}
        {inline
          ? <button type="button" disabled={!canCreate} onClick={() => { insert(create()) }}>{t('Add')}</button>
          : <button type="button" disabled={!canCreate} onClick={() => { open(null, create(), true) }}>{t('Add...')}</button>}
        <button type="button" disabled={!canRemove} onClick={remove}>{t('Remove')}</button>
      </div>
      {editing && ItemDialog && (
        <ItemDialog
          key={editing.opened}
          value={editing.value}
          isNew={editing.isNew}
          onAccept={accept}
          onCancel={() => { setEditing(undefined) }}
        />
      )}
    </div>
  )
}
