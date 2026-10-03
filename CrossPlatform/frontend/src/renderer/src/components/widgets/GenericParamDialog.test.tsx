import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TypeSigDto } from '../../../../shared/protocol'
import { GenericParamDialog } from './GenericParamDialog'
import { GenericParamListEditor } from './GenericParamListEditor'
import { GENERIC_PARAM_ATTRIBUTES, genericParamDraft, newGenericParam, type GenericParamDraft } from './generic-param'

const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }

const renderDialog = (value: GenericParamDraft = newGenericParam(), isNew = true): { onAccept: ReturnType<typeof vi.fn>, onCancel: ReturnType<typeof vi.fn> } => {
  const onAccept = vi.fn()
  const onCancel = vi.fn()
  render(
    <GenericParamDialog workspaceId="ws" value={value} isNew={isNew} onAccept={onAccept} onCancel={onCancel} />,
  )
  return { onAccept, onCancel }
}

const ok = (): HTMLElement => screen.getByRole('button', { name: 'OK' })

afterEach(cleanup)

describe('GenericParamDialog', () => {
  it('is one window for both, titled for which one it is', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Create Generic Parameter' })).toBeTruthy()
    cleanup()

    renderDialog(newGenericParam(), false)
    expect(screen.getByRole('dialog', { name: 'Edit Generic Parameter' })).toBeTruthy()
  })

  it('has dnSpy\'s four pages, in that order', () => {
    renderDialog()
    expect(screen.getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Main', 'Constraints', 'Custom Attrs', 'Kind'])
  })

  it('says on the Kind page why the Kind page can be ignored', () => {
    renderDialog()
    expect(screen.getByRole('tab', { name: 'Kind' }).getAttribute('title'))
      .toBe('Only used if MD header version is 1.1 (0x0101). It\'s never 1.1 so ignore Kind')
  })

  it('shows the row it was given', () => {
    renderDialog(genericParamDraft({ number: 1, flags: 0, name: 'T', constraints: [], customAttributes: [] }))
    expect(screen.getByDisplayValue('T')).toBeTruthy()
    expect(screen.getByDisplayValue('1')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Variance' })).toHaveValue('0')
  })

  it('carries the four constraints and the variance through the page', () => {
    const value: GenericParamDraft = {
      ...newGenericParam(),
      number: '1',
      attributes: GENERIC_PARAM_ATTRIBUTES.ReferenceTypeConstraint | GENERIC_PARAM_ATTRIBUTES.Covariant,
    }
    const { onAccept } = renderDialog(value, false)

    expect((screen.getByRole('checkbox', { name: 'Class' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Struct' }) as HTMLInputElement).checked).toBe(false)
    // The combo and the constraints are the same word, so the combo reads the low bits of it.
    expect(screen.getByRole('combobox', { name: 'Variance' })).toHaveValue('1')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Allows ByRefLike' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Variance' }), { target: { value: '2' } })
    fireEvent.click(ok())
    expect(onAccept.mock.calls[0][0].attributes).toBe(0x0004 | 0x0020 | 0x0002)
  })

  it('edits the constraints on their own page, under the title that names them', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('tab', { name: 'Constraints' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    expect(screen.getByRole('dialog', { name: 'Create Generic Parameter Constraint' })).toBeTruthy()
  })

  it('edits the kind on its own page, which is the same signature editor the constraints use', () => {
    renderDialog({ ...newGenericParam(), kind: int32 }, false)
    fireEvent.click(screen.getByRole('tab', { name: 'Kind' }))
    expect(screen.getByText('System.Int32')).toBeTruthy()
  })

  it('refuses to be accepted while the number box does not hold a number', () => {
    renderDialog({ ...newGenericParam(), number: '' })
    expect(ok()).toBeDisabled()
    expect(screen.getByText('The value is not an unsigned hexadecimal or decimal integer')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Number' }), { target: { value: '1' } })
    expect(ok()).toBeEnabled()
  })

  it('accepts the row it holds, and writes nothing back when it is cancelled', () => {
    const value = { ...newGenericParam(), number: '1', name: 'T' }
    const { onAccept, onCancel } = renderDialog(value, false)
    fireEvent.click(ok())
    expect(onAccept.mock.calls[0][0]).toEqual(value)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('puts back what it opened with, which is what Restore Settings is for', () => {
    renderDialog({ ...newGenericParam(), number: '1', name: 'T' }, false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'TOther' } })
    expect(screen.getByDisplayValue('TOther')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByDisplayValue('T')).toBeTruthy()
  })
})

describe('GenericParamListEditor', () => {
  it('shows each row as the parameter it names, and adds one through the dialog', () => {
    const onChange = vi.fn()
    render(
      <GenericParamListEditor
        workspaceId="ws"
        items={[genericParamDraft({ number: 1, flags: 0, name: 'T', constraints: [], customAttributes: [] })]}
        onChange={onChange}
      />,
    )

    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(['gparam(1) T'])
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    expect(screen.getByRole('dialog', { name: 'Create Generic Parameter' })).toBeTruthy()
  })

  it('puts an accepted row where its number belongs rather than at the end', () => {
    const onChange = vi.fn()
    render(
      <GenericParamListEditor
        workspaceId="ws"
        items={[
          genericParamDraft({ number: 0, flags: 0, name: 'TKey', constraints: [], customAttributes: [] }),
          genericParamDraft({ number: 2, flags: 0, name: 'TValue', constraints: [], customAttributes: [] }),
        ]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Number' }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'TMiddle' } })
    fireEvent.click(ok())

    expect(onChange.mock.calls[0][0].map((row: GenericParamDraft) => row.name)).toEqual(['TKey', 'TMiddle', 'TValue'])
  })
})
