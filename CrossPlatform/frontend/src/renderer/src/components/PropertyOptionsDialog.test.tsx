import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropertyOptionsDto, TypeSigDto } from '../../../shared/protocol'
import { PropertyOptionsDialog } from './PropertyOptionsDialog'
import { PROPERTY_ATTRIBUTES } from './widgets/property-options'

const intType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Int32' }, valueType: true }
const stringType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'String' } }

const property = (patch: Partial<PropertyOptionsDto> = {}): PropertyOptionsDto => ({
  attributes: 0,
  name: 'Count',
  propertySig: { hasThis: true, propertyType: intType, parameters: [] },
  getMethods: [],
  setMethods: [],
  otherMethods: [],
  customAttributes: [],
  ...patch,
})

const renderDialog = (value: PropertyOptionsDto, isNew = true, failure?: string): { accepted: PropertyOptionsDto[], onCancel: () => void } => {
  const accepted: PropertyOptionsDto[] = []
  const onCancel = vi.fn()
  render(<PropertyOptionsDialog workspaceId="ws" value={value} isNew={isNew} failure={failure} onAccept={(next) => { accepted.push(next) }} onCancel={onCancel} />)
  return { accepted, onCancel }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const open = (tab: string): void => { fireEvent.click(screen.getByRole('tab', { name: tab })) }
const accept = (): void => { fireEvent.click(screen.getByRole('button', { name: 'OK' })) }
const rows = (list: string): HTMLElement[] => within(screen.getByRole('listbox', { name: list })).queryAllByRole('option')

afterEach(cleanup)

describe('PropertyOptionsDialog', () => {
  it('draws the six pages of dnSpy\'s property window in its order', () => {
    renderDialog(property())
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Main', 'Signature', 'Getters', 'Setters', 'Other Methods', 'Custom Attrs'])
  })

  it('titles the same window for the command that opened it', () => {
    renderDialog(property(), true)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Property')

    cleanup()
    renderDialog(property(), false)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Property')
  })

  it('lays the Main page out the way the XAML does', () => {
    renderDialog(property({ attributes: PROPERTY_ATTRIBUTES.RTSpecialName }))

    expect(box('Name')).toHaveValue('Count')
    const flags = screen.getByRole('group', { name: 'Flags' })
    expect(Array.from(flags.querySelectorAll('label')).map((label) => label.textContent)).toEqual(['SpecialName', 'RTSpecialName'])
    expect(box('SpecialName')).not.toBeChecked()
    expect(box('RTSpecialName')).toBeChecked()
    // HasDefault is not a box: dnSpy's dialog has no checkbox for it.
    expect(screen.queryByLabelText('HasDefault')).toBeNull()
    // The Constant row carries the tooltip that says what the value is for.
    expect(screen.getByRole('checkbox', { name: 'Constant' }).closest('label')).toHaveAttribute('title', 'Default value for this property')
    expect(box('Constant')).not.toBeChecked()
    expect(box('Value')).toBeDisabled()
  })

  it('turns the Constant checkbox into the HasDefault bit, both ways round', () => {
    const { accepted } = renderDialog(property({ attributes: PROPERTY_ATTRIBUTES.SpecialName, constant: { elementType: 0x08, value: '3' } }))
    expect(box('Constant')).toBeChecked()
    expect(box('Value')).toHaveValue('3')

    fireEvent.click(box('Constant'))
    accept()
    expect(accepted[0].constant).toBeUndefined()
    expect(accepted[0].attributes & PROPERTY_ATTRIBUTES.HasDefault).toBe(0)
    expect(accepted[0].attributes & PROPERTY_ATTRIBUTES.SpecialName).toBe(PROPERTY_ATTRIBUTES.SpecialName)

    cleanup()
    const back = renderDialog(property())
    fireEvent.click(box('Constant'))
    fireEvent.change(box('Value'), { target: { value: '7' } })
    accept()
    expect(back.accepted[0].constant).toEqual({ elementType: 0x08, value: '7' })
    expect(back.accepted[0].attributes & PROPERTY_ATTRIBUTES.HasDefault).toBe(PROPERTY_ATTRIBUTES.HasDefault)
  })

  it('shows each accessor list under its own page, and writes back what is left of it', () => {
    const { accepted } = renderDialog(property({
      getMethods: [{ name: 'get_Count', token: 3, display: 'int32 Type::get_Count()' }],
      otherMethods: [{ name: 'Reset', token: 5, display: 'void Type::Reset()' }],
    }))

    open('Getters')
    expect(rows('Getters').map((row) => row.textContent)).toEqual(['int32 Type::get_Count()'])
    fireEvent.click(rows('Getters')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    open('Setters')
    expect(rows('Setters')).toEqual([])

    open('Other Methods')
    expect(rows('Other Methods').map((row) => row.textContent)).toEqual(['void Type::Reset()'])

    accept()
    expect(accepted[0].getMethods).toEqual([])
    expect(accepted[0].setMethods).toEqual([])
    expect(accepted[0].otherMethods).toEqual([{ name: 'Reset', token: 5, display: 'void Type::Reset()' }])
  })

  it('labels an accessor row with the full name the backend read it out as', () => {
    renderDialog(property({ setMethods: [{ name: 'set_Count', token: 4, display: 'void Type::set_Count(int32)' }] }))
    open('Setters')
    expect(rows('Setters')[0]).toHaveAttribute('title', 'void Type::set_Count(int32)')
  })

  it('hands the whole model back, so a page the dialog never opened is not emptied', () => {
    const signature = { hasThis: true, propertyType: stringType, parameters: [intType] }
    const { accepted } = renderDialog(property({
      attributes: PROPERTY_ATTRIBUTES.SpecialName,
      propertySig: signature,
      setMethods: [{ name: 'set_Count', token: 4 }],
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
    }))

    fireEvent.change(box('Name'), { target: { value: 'Total' } })
    accept()

    expect(accepted[0].name).toBe('Total')
    expect(accepted[0].propertySig).toEqual(signature)
    expect(accepted[0].setMethods).toEqual([{ name: 'set_Count', token: 4 }])
    expect(accepted[0].customAttributes).toHaveLength(1)
  })

  it('refuses a property whose signature is not whole, which is the one thing it cannot write without', () => {
    renderDialog(property({ propertySig: { hasThis: true, propertyType: { kind: 'empty' }, parameters: [] } }))
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    expect(screen.getByText('The property signature is incomplete')).toBeTruthy()

    cleanup()
    renderDialog(property())
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
  })

  it('refuses a default value that does not read as the kind it says it is', () => {
    renderDialog(property({ constant: { elementType: 0x08, value: 'x' } }))
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    // The row says it beside the box, and the window says it again as the reason OK is down.
    expect(screen.getAllByText("'x' is not a valid Int32")).toHaveLength(2)
  })

  it('shows why the write was refused without losing the model it was refused for', () => {
    renderDialog(property(), true, 'There is already a property with that name.')
    expect(screen.getByText('There is already a property with that name.')).toBeTruthy()
    expect(box('Name')).toHaveValue('Count')
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
  })

  it('puts every page back to what the window opened with', () => {
    renderDialog(property({ constant: { elementType: 0x08, value: '1' }, getMethods: [{ name: 'get_Count', token: 3 }] }))
    fireEvent.change(box('Name'), { target: { value: 'Total' } })
    fireEvent.click(box('SpecialName'))
    fireEvent.click(box('Constant'))
    open('Getters')
    fireEvent.click(rows('Getters')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(rows('Getters')).toHaveLength(1)
    open('Main')
    expect(box('Name')).toHaveValue('Count')
    expect(box('SpecialName')).not.toBeChecked()
    expect(box('Constant')).toBeChecked()
    expect(box('Value')).toHaveValue('1')
  })
})
