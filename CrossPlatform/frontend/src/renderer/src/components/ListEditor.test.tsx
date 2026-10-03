import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListEditor, type ListEditorItemProps } from './ListEditor'

interface Row { name: string }

/**
 * The item dialog every one of these lists opens: a text box and the two buttons. It stands in for
 * `MethodOptionsDialog` and friends, which are the same shape — a value in, and an accepted value or a
 * cancel out. It holds the draft itself, the way `OptionsShell` does, so nothing reaches the list until
 * OK.
 */
const rowDialog = ({ value, isNew, onAccept, onCancel }: ListEditorItemProps<Row>): React.JSX.Element => {
  const [draft, setDraft] = useState(value)
  return (
    <div role="dialog" aria-label={isNew ? 'Add' : 'Edit'}>
      <label>Name<input aria-label="Name" value={draft.name} onChange={(event) => { setDraft({ name: event.target.value }) }} /></label>
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" onClick={() => { onAccept(draft) }}>OK</button>
    </div>
  )
}

/** The editor driven the way a dialog drives it: it owns the list and re-renders what it reports. */
const Harness = ({ initial, ...rest }: { initial: Row[] } & Partial<Parameters<typeof ListEditor<Row>>[0]>): React.JSX.Element => {
  const [items, setItems] = useState(initial)
  return <ListEditor {...rest} items={items} onChange={setItems} label={(row) => row.name} create={() => ({ name: 'new' })} itemDialog={rowDialog} />
}

const rows = (): string[] => screen.queryAllByRole('option').map((row) => row.textContent ?? '')
/** The listbox row the user is on, which is what every button acts on. */
const selected = (): string => screen.getByRole('option', { selected: true }).textContent ?? ''
const press = (name: string): void => { fireEvent.click(screen.getByRole('button', { name })) }
/** Runs the open item dialog: types a name into its box and accepts it. */
const fillAndAccept = (name: string): void => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  press('OK')
}

afterEach(cleanup)

describe('ListEditor', () => {
  it('offers a row nothing to act on until one is picked, and folds the moves in behind it', () => {
    render(<Harness initial={[{ name: 'one' }, { name: 'two' }]} />)

    for (const name of ['Edit...', 'Remove', 'Move Up', 'Move Down'])
      expect(screen.getByRole('button', { name })).toBeDisabled()
    // Add... is the one thing that works with nothing selected, which is how a list is started.
    expect(screen.getByRole('button', { name: 'Add...' })).toBeEnabled()

    fireEvent.click(screen.getByText('two'))
    expect(screen.getByRole('button', { name: 'Edit...' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled()
    // The last row cannot move down and the first cannot move up: dnSpy's CanExecute pair.
    expect(screen.getByRole('button', { name: 'Move Down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Up' })).toBeEnabled()
  })

  it('moves the picked row and stays on it', () => {
    render(<Harness initial={[{ name: 'one' }, { name: 'two' }, { name: 'three' }]} />)

    fireEvent.click(screen.getByText('three'))
    press('Move Up')
    expect(rows()).toEqual(['one', 'three', 'two'])
    expect(selected()).toBe('three')

    press('Move Down')
    expect(rows()).toEqual(['one', 'two', 'three'])
    expect(selected()).toBe('three')
  })

  it('drops the picked row and falls to the next one, and to the last one only at the end', () => {
    render(<Harness initial={[{ name: 'one' }, { name: 'two' }, { name: 'three' }]} />)

    fireEvent.click(screen.getByText('one'))
    press('Remove')
    expect(rows()).toEqual(['two', 'three'])
    expect(selected()).toBe('two')

    fireEvent.click(screen.getByText('three'))
    press('Remove')
    expect(rows()).toEqual(['two'])
    // There is no next row, so the selection backs up rather than leaving the list unselected.
    expect(selected()).toBe('two')

    press('Remove')
    expect(rows()).toEqual([])
    for (const name of ['Edit...', 'Remove', 'Move Up', 'Move Down'])
      expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  it('opens the picked row and writes back only what the dialog accepted', () => {
    render(<Harness initial={[{ name: 'one' }]} />)

    fireEvent.click(screen.getByText('one'))
    press('Edit...')
    // The dialog starts from the row it was opened on, which is the clone dnSpy hands the editor.
    expect(screen.getByDisplayValue('one')).toBeTruthy()

    fillAndAccept('renamed')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(rows()).toEqual(['renamed'])
    expect(selected()).toBe('renamed')
  })

  it('takes a cancelled dialog as leaving the row alone', () => {
    render(<Harness initial={[{ name: 'one' }]} />)

    fireEvent.click(screen.getByText('one'))
    press('Edit...')
    fillAndAccept('renamed')
    // The row is the only place a value lives, so a draft the user backs out of never gets there.
    expect(rows()).toEqual(['renamed'])

    press('Edit...')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'discarded' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(rows()).toEqual(['renamed'])
  })

  it('puts a new row at the end and selects it', () => {
    render(<Harness initial={[{ name: 'one' }]} />)

    press('Add...')
    expect(screen.getByRole('dialog', { name: 'Add' })).toBeTruthy()
    expect(screen.getByDisplayValue('new')).toBeTruthy()

    fillAndAccept('two')
    expect(rows()).toEqual(['one', 'two'])
    expect(selected()).toBe('two')
  })

  it('edits a row on a double-click, which is what the control wires up', () => {
    render(<Harness initial={[{ name: 'one' }]} />)

    // A double-click picks the row as it opens it, so the row a stale selection pointed at is not the
    // one being edited.
    fireEvent.doubleClick(screen.getByText('one'))
    expect(screen.getByRole('dialog', { name: 'Edit' })).toBeTruthy()
  })

  it('lets a list say where a new row goes and when it may not grow', () => {
    // The index is decided by the row being placed among the others, which is what dnSpy's own
    // `GetAddIndex` gets to look at: here the rows are kept in name order as they arrive.
    const addIndex = (items: { name: string }[], value: { name: string }): number => {
      const at = items.findIndex((item) => item.name > value.name)
      return at === -1 ? items.length : at
    }
    render(
      <Harness
        initial={[{ name: 'one' }]}
        addIndex={addIndex}
        canAdd={(items) => items.length < 3}
      />,
    )

    press('Add...')
    fillAndAccept('aaa')
    press('Add...')
    fillAndAccept('mmm')
    expect(rows()).toEqual(['aaa', 'mmm', 'one'])
    // The list is as long as it is allowed to be, so Add... goes quiet rather than failing later.
    expect(screen.getByRole('button', { name: 'Add...' })).toBeDisabled()
  })

  it('lets the moves and the add go quiet without taking the list away', () => {
    render(<Harness initial={[{ name: 'one' }]} disabled />)

    for (const name of ['Edit...', 'Add...', 'Remove', 'Move Up', 'Move Down'])
      expect(screen.getByRole('button', { name })).toBeDisabled()
    // The rows are still there to read; only acting on them is off.
    expect(rows()).toEqual(['one'])
  })
})
