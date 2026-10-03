import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TypeSigDto } from '../../../../shared/protocol'
import { newTypeDefOrRefAndCa, typeDefOrRefAndCaDraft, type TypeDefOrRefAndCaDraft } from './type-def-or-ref-and-ca'
import { TypeDefOrRefAndCaDialog } from './TypeDefOrRefAndCaDialog'
import { TypeDefOrRefAndCAsListEditor } from './TypeDefOrRefAndCAsListEditor'

const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }

const renderDialog = (value: TypeDefOrRefAndCaDraft = newTypeDefOrRefAndCa(), isNew = true): { onAccept: ReturnType<typeof vi.fn>, onCancel: ReturnType<typeof vi.fn> } => {
  const onAccept = vi.fn()
  const onCancel = vi.fn()
  render(
    <TypeDefOrRefAndCaDialog
      workspaceId="ws"
      value={value}
      isNew={isNew}
      editTitle="Edit Interface Impl"
      createTitle="Create Interface Impl"
      onAccept={onAccept}
      onCancel={onCancel}
    />,
  )
  return { onAccept, onCancel }
}

const ok = (): HTMLElement => screen.getByRole('button', { name: 'OK' })

afterEach(cleanup)

describe('TypeDefOrRefAndCaDialog', () => {
  it('is titled for the list it was opened from, which is the only thing that tells the two apart', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Create Interface Impl' })).toBeTruthy()
    cleanup()

    renderDialog(newTypeDefOrRefAndCa(), false)
    expect(screen.getByRole('dialog', { name: 'Edit Interface Impl' })).toBeTruthy()
  })

  it('has dnSpy\'s two pages, in that order', () => {
    renderDialog()
    expect(screen.getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Type', 'Custom Attrs'])
  })

  it('refuses to be accepted before a type is there', () => {
    renderDialog()
    expect(ok()).toBeDisabled()
    expect(screen.getByText('A type is required')).toBeTruthy()
  })

  it('shows the type it was given', () => {
    renderDialog(typeDefOrRefAndCaDraft({ typeDefOrRef: int32, customAttributes: [] }))
    expect(screen.getByText('System.Int32')).toBeTruthy()
    expect(ok()).toBeEnabled()
  })

  it('carries the custom attributes on the second page', () => {
    renderDialog(typeDefOrRefAndCaDraft({ typeDefOrRef: int32, customAttributes: [] }))
    fireEvent.click(screen.getByRole('tab', { name: 'Custom Attrs' }))
    expect(screen.getByRole('listbox', { name: 'Custom Attributes' })).toBeTruthy()
  })

  it('accepts the row it holds, and writes nothing back when it is cancelled', () => {
    const value = typeDefOrRefAndCaDraft({ typeDefOrRef: int32, customAttributes: [] })
    const { onAccept, onCancel } = renderDialog(value, false)
    fireEvent.click(ok())
    expect(onAccept.mock.calls[0][0]).toEqual(value)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onAccept).toHaveBeenCalledTimes(1)
  })
})

describe('TypeDefOrRefAndCAsListEditor', () => {
  it('adds a row through the dialog, which is where the type is picked', () => {
    const onChange = vi.fn()
    render(
      <TypeDefOrRefAndCAsListEditor
        workspaceId="ws"
        items={[typeDefOrRefAndCaDraft({ typeDefOrRef: int32, customAttributes: [] })]}
        onChange={onChange}
        editTitle="Edit Generic Parameter Constraint"
        createTitle="Create Generic Parameter Constraint"
        ariaLabel="Constraints"
      />,
    )

    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(['System.Int32'])
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    expect(screen.getByRole('dialog', { name: 'Create Generic Parameter Constraint' })).toBeTruthy()
  })
})
