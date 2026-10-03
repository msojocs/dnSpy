import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CaNamedArgumentDto } from '../../../../shared/protocol'
import { CaNamedArgumentListEditor } from './CaNamedArgumentListEditor'

const int32 = (): CaNamedArgumentDto['argument'] => ({
  type: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true },
  value: { kind: 'primitive', primitive: '0', elementType: 0x08 },
})

const property = (name: string, text = '0'): CaNamedArgumentDto => ({
  isField: false,
  name,
  argument: { ...int32(), value: { kind: 'primitive', primitive: text, elementType: 0x08 } },
})

/** The list driven the way a dialog drives it: it owns the rows and re-renders what it reports. */
const Harness = ({ initial = [] as CaNamedArgumentDto[] }): React.JSX.Element => {
  const [items, setItems] = useState(initial)
  return <CaNamedArgumentListEditor workspaceId="ws" items={items} onChange={setItems} />
}

const nameBoxes = (): HTMLInputElement[] => screen.getAllByLabelText('Name') as HTMLInputElement[]
const valueBoxes = (): HTMLInputElement[] => screen.getAllByLabelText('Value') as HTMLInputElement[]
const flagBoxes = (): HTMLSelectElement[] => screen.getAllByLabelText('Property/Field type') as HTMLSelectElement[]
const kindBoxes = (): HTMLSelectElement[] => screen.getAllByLabelText('Value type') as HTMLSelectElement[]
/** The list's rows. They carry `role="option"` like the `<option>`s inside the combos do, so the role
 * alone would not tell the two apart. */
const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.list-editor-row'))

afterEach(cleanup)

describe('CaNamedArgumentListEditor', () => {
  it('adds the named argument dnSpy starts a new one at', () => {
    render(<Harness />)

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    // `CANamedArgumentsVM.Create`: a property of type Int32 called AttributeProperty, holding zero.
    expect(flagBoxes()[0]).toHaveValue('property')
    expect(nameBoxes()[0]).toHaveValue('AttributeProperty')
    expect(kindBoxes()[0]).toHaveValue('Int32')
    expect(valueBoxes()[0]).toHaveValue('0')
  })

  it('edits a row in place, which is why it has no Edit... button', () => {
    render(<Harness initial={[property('First')]} />)

    expect(screen.queryByRole('button', { name: 'Edit...' })).toBeNull()
    fireEvent.change(nameBoxes()[0], { target: { value: 'Second' } })
    expect(nameBoxes()[0]).toHaveValue('Second')
  })

  it('keeps the box it is typing in, rather than remounting the row under the caret', () => {
    render(<Harness initial={[property('First')]} />)

    // The row's editor is a component the list renders, and one made fresh on every render would be a new
    // type each time — React would throw this input away and the caret with it.
    const box = nameBoxes()[0]
    box.focus()
    fireEvent.change(box, { target: { value: 'Second' } })

    expect(nameBoxes()[0]).toBe(box)
    expect(document.activeElement).toBe(box)
  })

  it('reads and writes the Field/Property flag', () => {
    render(<Harness initial={[property('First')]} />)

    fireEvent.change(flagBoxes()[0], { target: { value: 'field' } })
    expect(flagBoxes()[0]).toHaveValue('field')
    expect(screen.getByText('Field')).toBeTruthy()
  })

  it('starts the value over when the kind changes, as the combo of a value does', () => {
    render(<Harness initial={[property('First', '7')]} />)

    fireEvent.change(kindBoxes()[0], { target: { value: 'Boolean' } })
    expect(kindBoxes()[0]).toHaveValue('Boolean')
    // A boolean starts at the value `ModelUtils.GetDefaultValue` gives it, not at the number that was there.
    expect(valueBoxes()[0]).toHaveValue('false')
  })

  it('offers Object first and no Null, since a named argument decides its own type', () => {
    render(<Harness initial={[property('First')]} />)

    const kinds = [...kindBoxes()[0].options].map((option) => option.value)
    expect(kinds[0]).toBe('Object')
    expect(kinds).not.toContain('null')
    expect(kinds).toContain('Type[]')
  })

  it('moves a row up and down, and removes it', () => {
    render(<Harness initial={[property('First'), property('Second')]} />)

    fireEvent.click(rows()[1])
    fireEvent.click(screen.getByRole('button', { name: 'Move Up' }))
    expect(nameBoxes().map((box) => box.value)).toEqual(['Second', 'First'])

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(nameBoxes().map((box) => box.value)).toEqual(['First'])
  })
})
