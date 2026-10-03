import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FieldOptionsDto, TypeSigDto } from '../../../shared/protocol'
import { FieldOptionsDialog } from './FieldOptionsDialog'
import { FIELD_ACCESSES, FIELD_ATTRIBUTES } from './widgets/field-options'
import { NATIVE_TYPE } from './widgets/marshal-type'

const intType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Int32' }, valueType: true }

const access = (label: string): number => FIELD_ACCESSES.find((entry) => entry.label === label)!.value

const field = (patch: Partial<FieldOptionsDto> = {}): FieldOptionsDto => ({
  attributes: access('Public') | FIELD_ATTRIBUTES.Static,
  name: 'Count',
  fieldSig: intType,
  customAttributes: [],
  rva: 0,
  ...patch,
})

const renderDialog = (value: FieldOptionsDto, isNew = true, failure?: string): { accepted: FieldOptionsDto[], onCancel: () => void } => {
  const accepted: FieldOptionsDto[] = []
  const onCancel = vi.fn()
  render(<FieldOptionsDialog workspaceId="ws" value={value} isNew={isNew} failure={failure} onAccept={(next) => { accepted.push(next) }} onCancel={onCancel} />)
  return { accepted, onCancel }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const options = (label: string): (string | undefined)[] => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((option) => option.textContent)
/** The Initial Value captions the checkbox and names the box beside it, which is how dnSpy's label binds,
 * so the two are told apart by what they are rather than by what they are called. */
const rvaCheckbox = (): HTMLInputElement => screen.getByRole('checkbox', { name: 'Initial Value' }) as HTMLInputElement
const initialValueBox = (): HTMLInputElement => screen.getByRole('textbox', { name: 'Initial Value' }) as HTMLInputElement
const group = (index: number): HTMLElement => screen.getAllByRole('group')[index] as HTMLElement
const open = (tab: string): void => { fireEvent.click(screen.getByRole('tab', { name: tab })) }
const accept = (): void => { fireEvent.click(screen.getByRole('button', { name: 'OK' })) }
const type = (name: 'Name' | 'Offset' | 'RVA', text: string): void => { fireEvent.change(box(name), { target: { value: text } }) }

afterEach(cleanup)

describe('FieldOptionsDialog', () => {
  it('draws the five pages of dnSpy\'s field window in its order', () => {
    renderDialog(field())
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Main', 'Type', 'Marshal Type', 'ImplMap', 'Custom Attrs'])
  })

  it('titles the same window for the command that opened it', () => {
    renderDialog(field(), true)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Field')

    cleanup()
    renderDialog(field(), false)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Field')
  })

  it('lays the Main page out the way the XAML does', () => {
    renderDialog(field())

    expect(box('Name')).toHaveValue('Count')
    expect(screen.getByRole('group').querySelector('legend')?.textContent).toBe('Flags')
    expect(Array.from(group(0).querySelectorAll('label')).map((label) => label.textContent))
      .toEqual(['Static', 'InitOnly', 'Literal', 'NotSerialized', 'SpecialName', 'RTSpecialName'])
    // The three bits a value stands for have no box of their own, and neither has the P/Invoke one.
    for (const derived of ['HasFieldMarshal', 'HasDefault', 'PinvokeImpl'])
      expect(screen.queryByLabelText(derived)).toBeNull()
    expect(box('Constant')).not.toBeChecked()
    expect(rvaCheckbox()).not.toBeChecked()
    expect(initialValueBox()).toBeDisabled()
    expect(screen.getByLabelText('Offset')).toHaveValue('')
    expect(box('RVA')).toHaveValue('0')
  })

  it('offers the access combo in the order dnSpy\'s enum table sorts into', () => {
    renderDialog(field())
    expect(options('Access')).toEqual(['Assembly', 'FamANDAssem', 'Family', 'FamORAssem', 'Private', 'PrivateScope', 'Public'])
  })

  it('writes the access combo and the flag boxes into the one attribute word', () => {
    const { accepted } = renderDialog(field({ attributes: access('Public') | FIELD_ATTRIBUTES.InitOnly }))

    fireEvent.change(box('Access'), { target: { value: String(access('Assembly')) } })
    fireEvent.click(box('Literal'))
    fireEvent.click(box('Static'))
    accept()

    const { attributes } = accepted[0]
    expect(attributes & FIELD_ATTRIBUTES.FieldAccessMask).toBe(access('Assembly'))
    expect(attributes & FIELD_ATTRIBUTES.Literal).toBe(FIELD_ATTRIBUTES.Literal)
    expect(attributes & FIELD_ATTRIBUTES.Static).toBe(FIELD_ATTRIBUTES.Static)
    expect(attributes & FIELD_ATTRIBUTES.InitOnly).toBe(FIELD_ATTRIBUTES.InitOnly)
  })

  it('turns the Constant checkbox into the HasDefault bit, and drops the value with it', () => {
    const withConstant = field({ attributes: FIELD_ATTRIBUTES.HasDefault, constant: { elementType: 0x08, value: '3' } })
    const { accepted } = renderDialog(withConstant)
    expect(box('Constant')).toBeChecked()
    expect(box('Value')).toHaveValue('3')

    fireEvent.click(box('Constant'))
    accept()
    expect(accepted[0].constant).toBeUndefined()
    expect(accepted[0].attributes & FIELD_ATTRIBUTES.HasDefault).toBe(0)

    cleanup()
    const without = renderDialog(field())
    fireEvent.click(box('Constant'))
    expect(box('Value')).toHaveValue('')
    fireEvent.change(box('Value'), { target: { value: '7' } })
    accept()
    expect(without.accepted[0].constant).toEqual({ elementType: 0x08, value: '7' })
    expect(without.accepted[0].attributes & FIELD_ATTRIBUTES.HasDefault).toBe(FIELD_ATTRIBUTES.HasDefault)
  })

  it('keeps the initial value while its box is off, and writes it only while it is on', () => {
    const { accepted } = renderDialog(field({ attributes: FIELD_ATTRIBUTES.HasFieldRVA, initialValue: btoa('\x01\x02') }))
    expect(rvaCheckbox()).toBeChecked()
    // The bytes are shown as hex, which is how dnSpy's box holds them.
    expect(initialValueBox()).toHaveValue('0102')

    fireEvent.click(rvaCheckbox())
    expect(initialValueBox()).toBeDisabled()
    expect(initialValueBox()).toHaveValue('0102')
    accept()
    expect(accepted[0].initialValue).toBeUndefined()
    expect(accepted[0].attributes & FIELD_ATTRIBUTES.HasFieldRVA).toBe(0)

    cleanup()
    const back = renderDialog(field())
    fireEvent.click(rvaCheckbox())
    fireEvent.change(initialValueBox(), { target: { value: 'AABB' } })
    accept()
    expect(back.accepted[0].initialValue).toBe(btoa('\xaa\xbb'))
    expect(back.accepted[0].attributes & FIELD_ATTRIBUTES.HasFieldRVA).toBe(FIELD_ATTRIBUTES.HasFieldRVA)
  })

  it('turns the ImplMap page\'s Enable box into the P/Invoke bit, and puts the entry point back', () => {
    const row = { attributes: 0, name: 'MessageBoxW', moduleName: 'user32.dll' }
    const { accepted } = renderDialog(field({ attributes: FIELD_ATTRIBUTES.PinvokeImpl, implMap: row }))
    open('ImplMap')

    expect(box('Enable')).toBeChecked()
    fireEvent.click(box('Enable'))
    fireEvent.click(box('Enable'))
    expect(box('Name')).toHaveValue('MessageBoxW')
    accept()
    expect(accepted[0].implMap).toEqual(row)
    expect(accepted[0].attributes & FIELD_ATTRIBUTES.PinvokeImpl).toBe(FIELD_ATTRIBUTES.PinvokeImpl)
  })

  it('turns the Marshal Type page\'s Enable box into the HasFieldMarshal bit', () => {
    const { accepted } = renderDialog(field({
      attributes: FIELD_ATTRIBUTES.HasFieldMarshal,
      marshalType: { nativeType: NATIVE_TYPE.FixedSysString, size: 8 },
    }))
    open('Marshal Type')

    expect(box('Enable')).toBeChecked()
    expect(box('Size')).toHaveValue('8')
    accept()
    expect(accepted[0].marshalType).toEqual({ nativeType: NATIVE_TYPE.FixedSysString, size: 8 })
    expect(accepted[0].attributes & FIELD_ATTRIBUTES.HasFieldMarshal).toBe(FIELD_ATTRIBUTES.HasFieldMarshal)

    cleanup()
    const off = renderDialog(field({
      attributes: FIELD_ATTRIBUTES.HasFieldMarshal,
      marshalType: { nativeType: NATIVE_TYPE.FixedSysString, size: 8 },
    }))
    open('Marshal Type')
    fireEvent.click(box('Enable'))
    accept()
    expect(off.accepted[0].marshalType).toBeUndefined()
    expect(off.accepted[0].attributes & FIELD_ATTRIBUTES.HasFieldMarshal).toBe(0)
  })

  it('hands the whole model back, so a page the dialog never opened is not emptied', () => {
    const { accepted } = renderDialog(field({
      fieldOffset: 0x10,
      rva: 0x1234,
      marshalType: { nativeType: NATIVE_TYPE.FixedSysString, size: 8 },
      implMap: { attributes: 0, name: 'MessageBoxW', moduleName: 'user32.dll' },
      constant: { elementType: 0x0E, value: 'hello' },
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
    }))

    type('Name', 'Other')
    accept()

    expect(accepted[0].name).toBe('Other')
    expect(accepted[0].fieldOffset).toBe(0x10)
    expect(accepted[0].rva).toBe(0x1234)
    expect(accepted[0].marshalType).toEqual({ nativeType: NATIVE_TYPE.FixedSysString, size: 8 })
    expect(accepted[0].implMap).toEqual({ attributes: 0, name: 'MessageBoxW', moduleName: 'user32.dll' })
    expect(accepted[0].constant).toEqual({ elementType: 0x0E, value: 'hello' })
    expect(accepted[0].customAttributes).toHaveLength(1)
    expect(accepted[0].fieldSig).toEqual(intType)
  })

  it('refuses a field with no type rather than letting the backend write one', () => {
    renderDialog(field({ fieldSig: undefined }))
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    expect(screen.getByText('A type is required')).toBeTruthy()
  })

  it('refuses a box that does not read, and says so until it does', () => {
    renderDialog(field())
    type('RVA', 'not a number')
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    expect(screen.getByText('The value is not an unsigned hexadecimal or decimal integer')).toBeTruthy()

    type('RVA', '0x40')
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
    expect(screen.queryByText(/not an unsigned/)).toBeNull()
  })

  it('shows why the write was refused without losing the model it was refused for', () => {
    renderDialog(field(), true, 'There is already a field with that name.')
    expect(screen.getByText('There is already a field with that name.')).toBeTruthy()
    expect(box('Name')).toHaveValue('Count')
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
  })

  it('puts every page back to what the window opened with', () => {
    renderDialog(field({ attributes: FIELD_ATTRIBUTES.Static, implMap: { attributes: 0, name: 'MessageBoxW', moduleName: 'user32.dll' } }))
    type('Name', 'Other')
    fireEvent.click(box('Static'))
    open('ImplMap')
    fireEvent.click(box('Enable'))

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    // The ImplMap page's boxes are what the reset has to put back, so they are read where they are.
    expect(box('Enable')).toBeChecked()
    expect(box('Name')).toHaveValue('MessageBoxW')
    open('Main')
    expect(box('Static')).toBeChecked()
    expect(box('Name')).toHaveValue('Count')
  })
})
