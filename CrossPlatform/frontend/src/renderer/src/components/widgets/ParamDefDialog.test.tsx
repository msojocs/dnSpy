import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParamDefDialog } from './ParamDefDialog'
import { newParamDef, PARAM_ATTRIBUTES, paramDefDto, type ParamDefDraft } from './param-def'

const renderDialog = (value: ParamDefDraft = newParamDef(), isNew = true): { onAccept: ReturnType<typeof vi.fn>, onCancel: ReturnType<typeof vi.fn> } => {
  const onAccept = vi.fn()
  const onCancel = vi.fn()
  render(<ParamDefDialog workspaceId="ws" value={value} isNew={isNew} onAccept={onAccept} onCancel={onCancel} />)
  return { onAccept, onCancel }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const ok = (): HTMLElement => screen.getByRole('button', { name: 'OK' })
const tab = (name: string): HTMLElement => screen.getByRole('tab', { name })
/** The row the dialog would write, which is what the list stores. */
const accepted = (onAccept: ReturnType<typeof vi.fn>): ReturnType<typeof paramDefDto> => paramDefDto(onAccept.mock.calls[0][0] as ParamDefDraft)

afterEach(cleanup)

describe('ParamDefDialog', () => {
  it('is dnSpy\'s one dialog for both, told apart by its title alone', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Create Parameter' })).toBeTruthy()
    cleanup()

    renderDialog(newParamDef(), false)
    expect(screen.getByRole('dialog', { name: 'Edit Parameter' })).toBeTruthy()
  })

  it('has the three pages dnSpy gives it, in that order', () => {
    renderDialog()
    expect(screen.getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Main', 'Marshal Type', 'Custom Attrs'])
  })

  it('opens on a row that is the return value with nothing said about it', () => {
    renderDialog()
    expect(box('Name')).toHaveValue('')
    expect(box('Sequence')).toHaveValue('0')
    expect(box('Sequence')).toHaveAttribute('title', 'Sequence 0 is return parameter, sequence 1 is first parameter, etc')
    for (const flag of ['In', 'Out', 'Lcid', 'Retval', 'Optional'])
      expect(box(flag)).not.toBeChecked()
  })

  it('writes the name and the sequence it was given', () => {
    const { onAccept } = renderDialog()
    fireEvent.change(box('Name'), { target: { value: 'count' } })
    fireEvent.change(box('Sequence'), { target: { value: '2' } })
    fireEvent.click(ok())

    const dto = accepted(onAccept)
    expect(dto.name).toBe('count')
    expect(dto.sequence).toBe(2)
    expect(dto.attributes).toBe(0)
  })

  it('carries the five flags in the word', () => {
    const { onAccept } = renderDialog()
    fireEvent.click(box('In'))
    fireEvent.click(box('Retval'))
    fireEvent.click(ok())

    expect(accepted(onAccept).attributes).toBe(PARAM_ATTRIBUTES.In | PARAM_ATTRIBUTES.Retval)
  })

  it('turns the default value into the HasDefault bit, and only while its checkbox is on', () => {
    const { onAccept } = renderDialog()
    // Nothing is there yet, so the box is off and its value box is not to be typed into.
    expect(box('Constant')).not.toBeChecked()
    expect(box('Value')).toBeDisabled()

    fireEvent.click(box('Constant'))
    expect(box('Value')).toBeEnabled()
    // An empty value is not a value: the dialog says so rather than writing a constant it cannot read.
    // The message is on the dialog's own error line as well as beside the box.
    expect(ok()).toBeDisabled()
    expect(screen.getAllByText("'' is not a valid Int32")).toHaveLength(2)

    fireEvent.change(box('Value'), { target: { value: '7' } })
    expect(ok()).toBeEnabled()
    fireEvent.click(ok())

    const dto = accepted(onAccept)
    expect(dto.attributes).toBe(PARAM_ATTRIBUTES.HasDefault)
    expect(dto.constant).toEqual({ elementType: 0x08, value: '7' })
  })

  it('says what the sequence box could not read and refuses to be accepted', () => {
    renderDialog()
    fireEvent.change(box('Sequence'), { target: { value: 'x' } })

    expect(ok()).toBeDisabled()
    expect(screen.getByText('The value is not an unsigned hexadecimal or decimal integer')).toBeTruthy()

    fireEvent.change(box('Sequence'), { target: { value: '0xFF' } })
    expect(ok()).toBeEnabled()
  })

  it('turns the marshalling into the HasFieldMarshal bit from the other page', () => {
    const { onAccept } = renderDialog()
    fireEvent.click(tab('Marshal Type'))
    expect(box('Enable')).not.toBeChecked()

    fireEvent.click(box('Enable'))
    fireEvent.click(ok())

    const dto = accepted(onAccept)
    expect(dto.attributes).toBe(PARAM_ATTRIBUTES.HasFieldMarshal)
    expect(dto.marshalType).toBeDefined()
  })

  it('leaves the marshalling off when the Enable box was never turned on', () => {
    const { onAccept } = renderDialog()
    fireEvent.click(tab('Marshal Type'))
    fireEvent.click(ok())

    const dto = accepted(onAccept)
    expect(dto.attributes).toBe(0)
    expect(dto.marshalType).toBeUndefined()
  })

  it('carries the custom attributes on the third page', () => {
    renderDialog()
    fireEvent.click(tab('Custom Attrs'))
    expect(screen.getByRole('listbox', { name: 'Custom Attributes' })).toBeTruthy()
  })

  it('puts every value back the way it opened, whichever page it is on', () => {
    const start: ParamDefDraft = { ...newParamDef(), name: 'count', sequence: '3', attributes: PARAM_ATTRIBUTES.Out }
    renderDialog(start, false)
    fireEvent.change(box('Name'), { target: { value: 'other' } })
    fireEvent.click(box('In'))

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(box('Name')).toHaveValue('count')
    expect(box('Sequence')).toHaveValue('3')
    expect(box('In')).not.toBeChecked()
    expect(box('Out')).toBeChecked()
  })

  it('writes nothing back when it is cancelled', () => {
    const { onAccept, onCancel } = renderDialog()
    fireEvent.change(box('Name'), { target: { value: 'count' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalled()
    expect(onAccept).not.toHaveBeenCalled()
  })
})
