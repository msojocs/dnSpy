import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeclSecurityDto, TypeSigDto } from '../../../../shared/protocol'
import { DeclSecurityDialog } from './DeclSecurityDialog'
import { DeclSecurityListEditor } from './DeclSecurityListEditor'
import { DECL_SEC_V1, declSecurityDraft, newDeclSecurity, type DeclSecurityDraft } from './decl-security'

const permissionSet: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System.Security.Permissions', name: 'PermissionSetAttribute' } }

const dto = (patch: Partial<DeclSecurityDto> = {}): DeclSecurityDto => ({
  action: 0x02,
  customAttributes: [],
  securityAttributes: [],
  ...patch,
})

const renderDialog = (value: DeclSecurityDraft = newDeclSecurity(), isNew = true): { onAccept: ReturnType<typeof vi.fn>, onCancel: ReturnType<typeof vi.fn> } => {
  const onAccept = vi.fn()
  const onCancel = vi.fn()
  render(
    <DeclSecurityDialog workspaceId="ws" value={value} isNew={isNew} onAccept={onAccept} onCancel={onCancel} />,
  )
  return { onAccept, onCancel }
}

const ok = (): HTMLElement => screen.getByRole('button', { name: 'OK' })

afterEach(cleanup)

describe('DeclSecurityDialog', () => {
  it('is one window for both, titled for which one it is', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Create Security Declaration' })).toBeTruthy()
    cleanup()

    renderDialog(newDeclSecurity(), false)
    expect(screen.getByRole('dialog', { name: 'Edit Security Declaration' })).toBeTruthy()
  })

  it('has dnSpy\'s two pages, in that order', () => {
    renderDialog()
    expect(screen.getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Main', 'Custom Attrs'])
  })

  it('shows the action under the name dnSpy\'s own enum gives it', () => {
    renderDialog(declSecurityDraft(dto({ action: 0x0F })))
    expect(screen.getByRole('combobox', { name: 'Action' })).toHaveValue('15')
    expect(screen.getByRole('option', { name: 'NonCasInheritance' })).toBeTruthy()
  })

  it('draws the attribute list for a V2 row and the XML box for a V1 one', () => {
    renderDialog(declSecurityDraft(dto()))
    expect(screen.getByRole('listbox', { name: 'Security Attributes' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'XML' })).toBeNull()
    cleanup()

    renderDialog(declSecurityDraft(dto({ v1XmlString: '<PermissionSet/>' })))
    expect(screen.getByRole('textbox', { name: 'XML' })).toHaveValue('<PermissionSet/>')
    expect(screen.queryByRole('listbox', { name: 'Security Attributes' })).toBeNull()
  })

  it('switches between the two forms without losing what the other holds', () => {
    const value = declSecurityDraft(dto({ securityAttributes: [{ attributeType: permissionSet, namedArguments: [] }] }))
    const { onAccept } = renderDialog(value, false)

    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: String(DECL_SEC_V1) } })
    fireEvent.change(screen.getByRole('textbox', { name: 'XML' }), { target: { value: '<PermissionSet/>' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: '1' } })
    // The list is drawn again with the row it had, which is what dnSpy's two view models do.
    const list = within(screen.getByRole('listbox', { name: 'Security Attributes' }))
    expect(list.getAllByRole('option').map((row) => row.textContent))
      .toEqual(['System.Security.Permissions.PermissionSetAttribute()'])

    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: String(DECL_SEC_V1) } })
    expect(screen.getByRole('textbox', { name: 'XML' })).toHaveValue('<PermissionSet/>')
    fireEvent.click(ok())
    expect(onAccept.mock.calls[0][0].xml).toBe('<PermissionSet/>')
  })

  it('refuses to be accepted while a row it holds is not finished', () => {
    // The row is V1 and the list is not drawn, but dnSpy checks both view models either way.
    const value: DeclSecurityDraft = {
      ...newDeclSecurity(),
      version: DECL_SEC_V1,
      xml: '<PermissionSet/>',
      securityAttributes: [{ attributeType: null, namedArguments: [] }],
    }
    renderDialog(value, false)
    expect(ok()).toBeDisabled()
    expect(screen.getByText('A type is required')).toBeTruthy()
  })

  it('accepts the row it holds, and writes nothing back when it is cancelled', () => {
    const value = declSecurityDraft(dto({ action: 0x03 }))
    const { onAccept, onCancel } = renderDialog(value, false)
    fireEvent.click(ok())
    expect(onAccept.mock.calls[0][0]).toEqual(value)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('carries the custom attributes on the second page', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('tab', { name: 'Custom Attrs' }))
    expect(screen.getByRole('listbox', { name: 'Custom Attributes' })).toBeTruthy()
  })
})

describe('DeclSecurityListEditor', () => {
  it('shows each row as the action it demands, and adds one through the dialog', () => {
    const onChange = vi.fn()
    render(
      <DeclSecurityListEditor
        workspaceId="ws"
        items={[declSecurityDraft(dto({ action: 0x02 })), declSecurityDraft(dto({ action: 0x08 }))]}
        onChange={onChange}
      />,
    )

    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(['Demand', 'RequestMinimum'])
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    expect(screen.getByRole('dialog', { name: 'Create Security Declaration' })).toBeTruthy()
  })

  it('adds a row at the end, which is the list dnSpy does not override the index of', () => {
    const onChange = vi.fn()
    render(
      <DeclSecurityListEditor
        workspaceId="ws"
        items={[declSecurityDraft(dto({ action: 0x02 }))]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    fireEvent.click(ok())
    expect(onChange.mock.calls[0][0].map((row: DeclSecurityDraft) => row.action)).toEqual([0x02, 0])
  })
})
