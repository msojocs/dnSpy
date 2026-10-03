import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MethodOptionsDto, TypeSigDto } from '../../../shared/protocol'
import { MethodOptionsDialog } from './MethodOptionsDialog'
import { HAS_THIS_FLAG } from './widgets/MethodSigEditor'
import { IMPL_FLAGS, METHOD_ACCESSES, METHOD_ATTRIBUTES, METHOD_FLAGS, METHOD_IMPL_ATTRIBUTES } from './widgets/method-options'

const voidType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Void' } }
const intType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Int32' }, valueType: true }

const access = (label: string): number => METHOD_ACCESSES.find((entry) => entry.label === label)!.value

const method = (patch: Partial<MethodOptionsDto> = {}): MethodOptionsDto => ({
  implAttributes: METHOD_IMPL_ATTRIBUTES.NoInlining,
  attributes: access('Public') | METHOD_ATTRIBUTES.HideBySig | METHOD_ATTRIBUTES.NewSlot,
  semanticsAttributes: 0,
  name: 'Reset',
  methodSig: { callingConvention: 0, returnType: voidType, parameters: [intType], genericParameterCount: 0 },
  customAttributes: [],
  declSecurities: [],
  paramDefs: [],
  genericParameters: [],
  overrides: [],
  rva: 0x1234,
  ...patch,
})

const renderDialog = (value: MethodOptionsDto, isNew = true, failure?: string): { accepted: MethodOptionsDto[]; onCancel: () => void } => {
  const accepted: MethodOptionsDto[] = []
  const onCancel = vi.fn()
  render(<MethodOptionsDialog workspaceId="ws" value={value} isNew={isNew} failure={failure} onAccept={(next) => { accepted.push(next) }} onCancel={onCancel} />)
  return { accepted, onCancel }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const combo = (label: string): HTMLSelectElement => screen.getByLabelText(label) as HTMLSelectElement
const options = (label: string): (string | undefined)[] => Array.from(combo(label).options).map((option) => option.textContent)
const group = (index: number): HTMLElement => screen.getAllByRole('group')[index] as HTMLElement
/** The captions of a group box, in the order it draws them — which for both flag groups is what the XAML
 * puts in each cell, read left to right and top to bottom. */
const captions = (index: number): string[] => Array.from(group(index).querySelectorAll('label')).map((label) => label.textContent ?? '')
const open = (tab: string): void => { fireEvent.click(screen.getByRole('tab', { name: tab })) }
const accept = (): void => { fireEvent.click(screen.getByRole('button', { name: 'OK' })) }

afterEach(cleanup)

describe('MethodOptionsDialog', () => {
  it('draws the eight pages of dnSpy\'s method window in its order', () => {
    renderDialog(method())
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Main', 'Signature', 'Params', 'Generic Params', 'ImplMap', 'Overrides', 'Custom Attrs', 'Sec Decls'])
  })

  it('titles the same window for the command that opened it', () => {
    renderDialog(method(), true)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Method')

    cleanup()
    renderDialog(method(), false)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Method')
  })

  it('lays the Main page\'s two flag boxes out the way the XAML does', () => {
    renderDialog(method())

    expect(box('Name')).toHaveValue('Reset')
    // The ImplFlags box has a literal header, so its fieldset carries no caption at all.
    expect(group(0).querySelector('legend')).toBeNull()
    expect(group(1).querySelector('legend')?.textContent).toBe('Flags')
    expect(captions(0)).toEqual(IMPL_FLAGS.map((entry) => entry.label))
    expect(captions(1)).toEqual(METHOD_FLAGS.map((entry) => entry.label))
  })

  it('keeps the two derived flags out of the boxes, because nothing on the page writes them', () => {
    renderDialog(method())
    expect(screen.queryByLabelText('PinvokeImpl')).toBeNull()
    expect(screen.queryByLabelText('HasSecurity')).toBeNull()
  })

  it('offers the four combos with the entries dnSpy\'s enum tables sort into', () => {
    renderDialog(method())

    expect(options('CodeType')).toEqual(['IL', 'Native', 'OPTIL', 'Runtime'])
    expect(options('ManagedType')).toEqual(['Managed', 'Unmanaged'])
    expect(options('Access')).toEqual(['Assembly', 'FamANDAssem', 'Family', 'FamORAssem', 'Private', 'PrivateScope', 'Public'])
    expect(options('VtableLayout')).toEqual(['NewSlot', 'ReuseSlot'])
    expect(combo('Access')).toHaveValue(String(access('Public')))
  })

  it('writes each flag box and combo into its own bits and leaves the rest of the word alone', () => {
    const { accepted } = renderDialog(method({ implAttributes: METHOD_IMPL_ATTRIBUTES.NoInlining | METHOD_IMPL_ATTRIBUTES.AggressiveOptimization }))

    fireEvent.click(box('AggressiveInlining'))
    fireEvent.change(combo('CodeType'), { target: { value: '2' } })
    fireEvent.change(combo('ManagedType'), { target: { value: '1' } })
    fireEvent.click(box('Synchronized'))
    accept()

    const { implAttributes } = accepted[0]
    expect(implAttributes & METHOD_IMPL_ATTRIBUTES.AggressiveInlining).toBe(METHOD_IMPL_ATTRIBUTES.AggressiveInlining)
    expect(implAttributes & METHOD_IMPL_ATTRIBUTES.CodeTypeMask).toBe(2)
    expect(implAttributes & METHOD_IMPL_ATTRIBUTES.ManagedMask).toBe(METHOD_IMPL_ATTRIBUTES.ManagedMask)
    expect(implAttributes & METHOD_IMPL_ATTRIBUTES.Synchronized).toBe(METHOD_IMPL_ATTRIBUTES.Synchronized)
    expect(implAttributes & METHOD_IMPL_ATTRIBUTES.NoInlining).toBe(METHOD_IMPL_ATTRIBUTES.NoInlining)
    expect(implAttributes & METHOD_IMPL_ATTRIBUTES.AggressiveOptimization).toBe(METHOD_IMPL_ATTRIBUTES.AggressiveOptimization)
  })

  it('keeps the method\'s static bit and its signature\'s HasThis flag in step, both ways round', () => {
    const { accepted } = renderDialog(method({ attributes: access('Public') }))

    // A method with no `this` is static, and the checkbox writes that into the signature.
    fireEvent.click(box('Static'))
    accept()
    expect(accepted[0].attributes & METHOD_ATTRIBUTES.Static).toBe(METHOD_ATTRIBUTES.Static)
    expect(accepted[0].methodSig?.callingConvention).toBe(0)

    cleanup()
    const back = renderDialog(method({ attributes: access('Public') | METHOD_ATTRIBUTES.Static }))
    fireEvent.click(box('Static'))
    accept()
    expect(back.accepted[0].attributes & METHOD_ATTRIBUTES.Static).toBe(0)
    expect(back.accepted[0].methodSig?.callingConvention).toBe(HAS_THIS_FLAG)
  })

  it('turns the ImplMap page\'s Enable box into the P/Invoke bit, and puts the entry point back', () => {
    const row = { attributes: 0, name: 'MessageBoxW', moduleName: 'user32.dll' }
    const { accepted } = renderDialog(method({ attributes: access('Public') | METHOD_ATTRIBUTES.PinvokeImpl, implMap: row }))
    open('ImplMap')

    expect(box('Enable')).toBeChecked()
    fireEvent.click(box('Enable'))
    expect(box('Name')).toBeDisabled()
    // Off and on again shows what was there: dnSpy's control only greys its boxes out.
    fireEvent.click(box('Enable'))
    expect(box('Name')).toHaveValue('MessageBoxW')
    accept()
    expect(accepted[0].implMap).toEqual(row)
    expect(accepted[0].attributes & METHOD_ATTRIBUTES.PinvokeImpl).toBe(METHOD_ATTRIBUTES.PinvokeImpl)

    cleanup()
    const off = renderDialog(method({ attributes: access('Public') | METHOD_ATTRIBUTES.PinvokeImpl, implMap: row }))
    open('ImplMap')
    fireEvent.click(box('Enable'))
    accept()
    expect(off.accepted[0].implMap).toBeUndefined()
    expect(off.accepted[0].attributes & METHOD_ATTRIBUTES.PinvokeImpl).toBe(0)
  })

  it('settles the security bit from the rows when the model is handed over', () => {
    const { accepted } = renderDialog(method({ declSecurities: [{ action: 2, customAttributes: [], securityAttributes: [] }] }))
    accept()
    expect(accepted[0].attributes & METHOD_ATTRIBUTES.HasSecurity).toBe(METHOD_ATTRIBUTES.HasSecurity)
  })

  it('hands the whole model back, so a page the dialog never opened is not emptied', () => {
    const { accepted } = renderDialog(method({
      paramDefs: [{ name: 'count', sequence: 1, attributes: 0, customAttributes: [] }],
      genericParameters: [{ number: 0, flags: 0, name: 'T', constraints: [], customAttributes: [] }],
      overrides: [{
        methodBody: { declaringType: { kind: 'type', type: { scope: '', namespace: 'N', name: 'A' } }, name: 'Reset', signature: { callingConvention: 0, returnType: voidType, parameters: [] } },
        methodDeclaration: { declaringType: { kind: 'type', type: { scope: '', namespace: 'N', name: 'B' } }, name: 'Reset', signature: { callingConvention: 0, returnType: voidType, parameters: [] } },
      }],
      rva: 0x0badf00d,
      semanticsAttributes: 0x2,
    }))

    changeName('Other')
    accept()

    expect(accepted[0].name).toBe('Other')
    expect(accepted[0].paramDefs).toHaveLength(1)
    expect(accepted[0].genericParameters).toHaveLength(1)
    expect(accepted[0].overrides).toHaveLength(1)
    // The two words no page shows have to come out exactly as they went in.
    expect(accepted[0].rva).toBe(0x0badf00d)
    expect(accepted[0].semanticsAttributes).toBe(0x2)
  })

  it('shows why the write was refused without losing the model it was refused for', () => {
    renderDialog(method(), true, 'There is already a method with that name.')

    expect(screen.getByText('There is already a method with that name.')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toHaveValue('Reset')
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
  })

  it('lets the page\'s own complaint take the strip back once the page has one', () => {
    renderDialog(method({ methodSig: { callingConvention: 0, returnType: { kind: 'empty' }, parameters: [] } }), true, 'There is already a method with that name.')

    expect(screen.queryByText('There is already a method with that name.')).toBeNull()
    expect(screen.getByText('The method signature is incomplete')).toBeTruthy()
  })

  it('refuses a signature that is not whole rather than letting the backend write one', () => {
    renderDialog(method({ methodSig: { callingConvention: 0, returnType: { kind: 'empty' }, parameters: [] } }))

    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    expect(screen.getByText('The method signature is incomplete')).toBeTruthy()
  })

  it('says a P/Invoke needs its library, and stops saying it once one is there', () => {
    renderDialog(method({ implMap: { attributes: 0, name: 'MessageBoxW', moduleName: '' } }))
    expect(screen.getByText('A P/Invoke method needs the name of the native library it calls into.')).toBeTruthy()

    open('ImplMap')
    fireEvent.change(box('Module'), { target: { value: 'user32.dll' } })
    expect(screen.queryByText(/native library/)).toBeNull()
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
  })

  it('puts every page back to what the window opened with', () => {
    renderDialog(method())
    changeName('Other')

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(box('Name')).toHaveValue('Reset')
  })

  it('closes without accepting anything when it is cancelled', () => {
    const { accepted, onCancel } = renderDialog(method())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(accepted).toEqual([])
  })
})

const changeName = (name: string): void => { fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } }) }
