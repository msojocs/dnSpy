import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParamDefListEditor } from './ParamDefListEditor'
import { newParamDef, type ParamDefDraft } from './param-def'

/** The list driven the way a dialog drives it: it owns the rows and re-renders what it reports. */
const renderList = (initial: ParamDefDraft[] = []): { rows: () => ParamDefDraft[] } => {
  let latest = initial
  const Harness = (): React.JSX.Element => {
    const [items, setItems] = useState(initial)
    latest = items
    return <ParamDefListEditor workspaceId="ws" items={items} onChange={setItems} />
  }
  render(<Harness />)
  return { rows: () => latest }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const rowTexts = (): string[] => screen.getAllByRole('option').map((row) => row.textContent ?? '')

/** Adds a row with the name and sequence the dialog is filled in with, and accepts it. */
const add = (name: string, sequence: string): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
  fireEvent.change(box('Name'), { target: { value: name } })
  fireEvent.change(box('Sequence'), { target: { value: sequence } })
  fireEvent.click(screen.getByRole('button', { name: 'OK' }))
}

const row = (name: string, sequence: string): ParamDefDraft => ({ ...newParamDef(), name, sequence })

afterEach(cleanup)

describe('ParamDefListEditor', () => {
  it('names each row the way dnSpy\'s FullName does', () => {
    renderList([{ ...newParamDef(), name: 'count', sequence: '1' }, newParamDef()])
    expect(rowTexts()).toEqual(['param(1) count', 'param(return) <<no-name>>'])
  })

  it('puts a new row where its sequence belongs rather than at the end', () => {
    // dnSpy's own `GetAddIndex`: the first row with a greater sequence is the one it goes in front of.
    const { rows } = renderList([row('a', '1'), row('b', '3')])

    add('c', '2')
    expect(rowTexts()).toEqual(['param(1) a', 'param(2) c', 'param(3) b'])
    expect(rows().map((item) => item.name)).toEqual(['a', 'c', 'b'])
  })

  it('keeps two rows of the same sequence in the order they were added', () => {
    renderList([row('a', '1')])
    add('b', '1')
    expect(rowTexts()).toEqual(['param(1) a', 'param(1) b'])
  })

  it('puts a row whose sequence is past the end of the list last', () => {
    renderList([row('a', '1')])
    add('b', '12')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(rowTexts()[1]).toBe('param(12) b')
  })

  it('goes quiet on the buttons a list without a selected row cannot use', () => {
    renderList()
    for (const name of ['Edit...', 'Remove', 'Move Up', 'Move Down'])
      expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add...' })).toBeEnabled()
  })

  it('edits the row a double-click opens, and leaves the others alone', () => {
    const { rows } = renderList([row('a', '1'), row('b', '2')])
    fireEvent.doubleClick(screen.getByText('param(1) a'))
    fireEvent.change(box('Name'), { target: { value: 'z' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(rows().map((item) => item.name)).toEqual(['z', 'b'])
    // An edited row stays where it was rather than being re-sorted into place.
    expect(rowTexts()).toEqual(['param(1) z', 'param(2) b'])
  })

  it('opens a row on the value it holds, which is what Edit... shows', () => {
    renderList([{ ...newParamDef(), name: 'count', sequence: '0x12C' }])
    fireEvent.click(screen.getAllByRole('option')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Edit...' }))

    expect(box('Name')).toHaveValue('count')
    expect(box('Sequence')).toHaveValue('0x12C')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('is disabled along with everything in it', () => {
    const onChange = vi.fn()
    render(<ParamDefListEditor workspaceId="ws" items={[row('a', '1')]} onChange={onChange} disabled />)

    expect(screen.getByRole('listbox', { name: 'Parameters' })).toHaveAttribute('aria-disabled', 'true')
    for (const name of ['Edit...', 'Add...', 'Remove', 'Move Up', 'Move Down'])
      expect(screen.getByRole('button', { name })).toBeDisabled()
  })
})
