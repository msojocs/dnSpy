import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecurityAttributeDto, TreeNode, TypeSigDto } from '../../../../shared/protocol'
import { SecurityAttributeDialog } from './SecurityAttributeDialog'
import { SecurityAttributeListEditor } from './SecurityAttributeListEditor'
import { newSecurityAttribute, securityAttributeDraft, type SecurityAttributeDraft } from './security-attribute'

const permissionSet: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System.Security.Permissions', name: 'PermissionSetAttribute' } }

const permissionSetNode: TreeNode = {
  id: 'type:PermissionSetAttribute',
  kind: 'type',
  label: 'PermissionSetAttribute',
  hasChildren: false,
  icon: 'type',
}

const getRoots = vi.fn(async () => ({ nodes: [permissionSetNode] }))

beforeEach(() => {
  getRoots.mockClear()
  Object.defineProperty(window, 'dnSpy', { configurable: true, value: { ...window.dnSpy, getRoots, getChildren: async () => ({ nodes: [] }) } })
})

afterEach(cleanup)

const renderDialog = (value: SecurityAttributeDraft = newSecurityAttribute(), isNew = true): { onAccept: ReturnType<typeof vi.fn>, onCancel: ReturnType<typeof vi.fn> } => {
  const onAccept = vi.fn()
  const onCancel = vi.fn()
  render(
    <SecurityAttributeDialog workspaceId="ws" value={value} isNew={isNew} onAccept={onAccept} onCancel={onCancel} />,
  )
  return { onAccept, onCancel }
}

const ok = (): HTMLElement => screen.getByRole('button', { name: 'OK' })

describe('SecurityAttributeDialog', () => {
  it('is one window for both, titled for which one it is', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Create Security Attribute' })).toBeTruthy()
    cleanup()

    renderDialog(newSecurityAttribute(), false)
    expect(screen.getByRole('dialog', { name: 'Edit Security Attribute' })).toBeTruthy()
  })

  it('has no pages of its own, which is what dnSpy\'s control is', () => {
    renderDialog()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('listbox', { name: 'Named Arguments' })).toBeTruthy()
  })

  it('shows the type the row has, and will not be accepted without one', () => {
    renderDialog(securityAttributeDraft({ attributeType: permissionSet, namedArguments: [] }))
    expect(screen.getByDisplayValue('System.Security.Permissions.PermissionSetAttribute')).toBeTruthy()
    expect(ok()).toBeEnabled()
    cleanup()

    renderDialog()
    expect(ok()).toBeDisabled()
    expect(screen.getByText('A type is required')).toBeTruthy()
  })

  it('picks the type from the explorer tree, which is the only way it is ever set', async () => {
    const { onAccept } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Pick a Type' }))
    expect(screen.getByRole('dialog', { name: 'Pick a Type' })).toBeTruthy()

    const picker = within(await screen.findByRole('dialog', { name: 'Pick a Type' }))
    fireEvent.click(picker.getByText('PermissionSetAttribute'))
    fireEvent.click(picker.getByRole('button', { name: 'OK' }))

    // Picking fills the box — with the namespace the tree led through, which this node has none of —
    // and the row is written when the dialog it belongs to is accepted.
    await waitFor(() => { expect(screen.getByDisplayValue('PermissionSetAttribute')).toBeTruthy() })
    fireEvent.click(ok())
    expect(onAccept.mock.calls[0][0].attributeType.type.name).toBe('PermissionSetAttribute')
  })

  it('accepts the row it holds, and writes nothing back when it is cancelled', () => {
    const value = securityAttributeDraft({ attributeType: permissionSet, namedArguments: [] })
    const { onAccept, onCancel } = renderDialog(value, false)
    fireEvent.click(ok())
    expect(onAccept.mock.calls[0][0]).toEqual(value)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onAccept).toHaveBeenCalledTimes(1)
  })
})

describe('SecurityAttributeListEditor', () => {
  it('shows each row as what it demands, and adds one through the dialog', () => {
    const onChange = vi.fn()
    const items: SecurityAttributeDto[] = [{ attributeType: permissionSet, namedArguments: [] }]
    render(
      <SecurityAttributeListEditor
        workspaceId="ws"
        items={items.map(securityAttributeDraft)}
        onChange={onChange}
      />,
    )

    expect(screen.getAllByRole('option').map((row) => row.textContent))
      .toEqual(['System.Security.Permissions.PermissionSetAttribute()'])
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    expect(screen.getByRole('dialog', { name: 'Create Security Attribute' })).toBeTruthy()
  })
})
