import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventOptionsDto, FieldOptionsDto, MethodOptionsDto, NodeOptionsDto, PropertyOptionsDto, TypeSigDto } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { NodeOptionsDialog } from './NodeOptionsDialog'
import { FIELD_ACCESSES, FIELD_ATTRIBUTES } from './widgets/field-options'
import { METHOD_ACCESSES, METHOD_ATTRIBUTES, METHOD_IMPL_ATTRIBUTES } from './widgets/method-options'

const voidType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Void' } }
const intType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Int32' }, valueType: true }

/** The access bits have no named members of their own, so they are read out of the same table the combo
 * is built from. */
const access = (label: string): number => METHOD_ACCESSES.find((entry) => entry.label === label)!.value
const fieldAccess = (label: string): number => FIELD_ACCESSES.find((entry) => entry.label === label)!.value

const method: MethodOptionsDto = {
  implAttributes: METHOD_IMPL_ATTRIBUTES.NoInlining,
  attributes: access('Public') | METHOD_ATTRIBUTES.HideBySig,
  semanticsAttributes: 0,
  name: 'MyMethod',
  methodSig: { callingConvention: 0, returnType: voidType, parameters: [], genericParameterCount: 0 },
  customAttributes: [],
  declSecurities: [],
  paramDefs: [],
  genericParameters: [],
  overrides: [],
}

const field: FieldOptionsDto = {
  attributes: fieldAccess('Public') | FIELD_ATTRIBUTES.Static,
  name: 'Count',
  fieldSig: intType,
  customAttributes: [],
  rva: 0,
}

const property: PropertyOptionsDto = {
  attributes: 0,
  name: 'Count',
  propertySig: { hasThis: true, propertyType: intType, parameters: [] },
  getMethods: [],
  setMethods: [],
  otherMethods: [],
  customAttributes: [],
}

const event: EventOptionsDto = {
  attributes: 0,
  name: 'Changed',
  eventType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'EventHandler' } },
  otherMethods: [],
  customAttributes: [],
}

const getNodeOptions = vi.fn()
const createNode = vi.fn()
const applyNodeOptions = vi.fn()

const renderDialog = (props: { kind?: 'type' | 'method' | 'field' | 'property' | 'event', nodeId?: string, ownerNodeId?: string } = {}): { onClose: () => void } => {
  const onClose = vi.fn()
  render(<NodeOptionsDialog workspaceId="ws" kind={props.kind ?? 'method'} nodeId={props.nodeId} ownerNodeId={props.ownerNodeId} onClose={onClose} />)
  return { onClose }
}

beforeEach(() => {
  getNodeOptions.mockReset()
  createNode.mockReset().mockResolvedValue(true)
  applyNodeOptions.mockReset().mockResolvedValue(true)
  useAppStore.setState({ createNode, applyNodeOptions, error: undefined })
  vi.stubGlobal('dnSpy', { getNodeOptions })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NodeOptionsDialog', () => {
  it('reads a new method\'s defaults from the node it will belong to', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'method', method })

    renderDialog({ ownerNodeId: 'type-1' })

    expect(await screen.findByLabelText('Name')).toHaveValue('MyMethod')
    expect(getNodeOptions).toHaveBeenCalledWith('ws', 'method', { ownerNodeId: 'type-1', isNew: true })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Method')
  })

  it('reads what an existing method holds for the edit command', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'method', method })

    renderDialog({ nodeId: 'method-1' })

    expect(await screen.findByLabelText('Name')).toHaveValue('MyMethod')
    expect(getNodeOptions).toHaveBeenCalledWith('ws', 'method', { nodeId: 'method-1' })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Method')
  })

  it('creates the model the dialog accepted under the node that owns it, and closes', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'method', method })
    const { onClose } = renderDialog({ ownerNodeId: 'type-1' })
    await screen.findByLabelText('Name')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    const [owner, options] = createNode.mock.calls[0] as [string, NodeOptionsDto]
    expect(owner).toBe('type-1')
    expect(options.kind).toBe('method')
    expect(options.method?.name).toBe('Renamed')
    expect(applyNodeOptions).not.toHaveBeenCalled()
  })

  it('writes the model over the node the edit command was opened for', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'method', method })
    const { onClose } = renderDialog({ nodeId: 'method-1' })
    await screen.findByLabelText('Name')

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    expect(applyNodeOptions.mock.calls[0][0]).toBe('method-1')
    expect(createNode).not.toHaveBeenCalled()
  })

  it('stays open with the reason when the backend refuses the write, so the model can be fixed', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'method', method })
    createNode.mockImplementation(async () => {
      useAppStore.setState({ error: 'There is already a method with that name.' })
      return false
    })
    const { onClose } = renderDialog({ ownerNodeId: 'type-1' })
    await screen.findByLabelText('Name')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(await screen.findByText('There is already a method with that name.')).toBeTruthy()
    expect(createNode.mock.calls[0][1].method.name).toBe('Renamed')
    expect(onClose).not.toHaveBeenCalled()
    // The window is still the one that was built, so the reason can be read where the work is.
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Method')
    expect(screen.getByLabelText('Name')).toHaveValue('Renamed')
  })

  it('says why when the model never arrives, and lets the window be closed', async () => {
    getNodeOptions.mockRejectedValue(new Error('The node is not a method.'))
    const { onClose } = renderDialog({ nodeId: 'method-1' })

    expect(await screen.findByText('The node is not a method.')).toBeTruthy()
    expect(screen.queryByLabelText('Name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('runs the field window off the same three calls the method one does', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'field', field })
    const { onClose } = renderDialog({ kind: 'field', ownerNodeId: 'type-1' })
    expect(await screen.findByLabelText('Name')).toHaveValue('Count')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Field')
    expect(getNodeOptions).toHaveBeenCalledWith('ws', 'field', { ownerNodeId: 'type-1', isNew: true })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    const [owner, options] = createNode.mock.calls[0] as [string, NodeOptionsDto]
    expect(owner).toBe('type-1')
    expect(options).toEqual({ kind: 'field', field: { ...field, name: 'Renamed' } })

    cleanup()
    getNodeOptions.mockResolvedValue({ kind: 'field', field })
    renderDialog({ kind: 'field', nodeId: 'field-1' })
    expect(await screen.findByLabelText('Name')).toHaveValue('Count')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Field')
  })

  it('runs the property window off the same three calls the method one does', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'property', property })
    const { onClose } = renderDialog({ kind: 'property', ownerNodeId: 'type-1' })
    expect(await screen.findByLabelText('Name')).toHaveValue('Count')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Property')
    expect(getNodeOptions).toHaveBeenCalledWith('ws', 'property', { ownerNodeId: 'type-1', isNew: true })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    const [owner, options] = createNode.mock.calls[0] as [string, NodeOptionsDto]
    expect(owner).toBe('type-1')
    expect(options).toEqual({ kind: 'property', property: { ...property, name: 'Renamed' } })

    cleanup()
    getNodeOptions.mockResolvedValue({ kind: 'property', property })
    renderDialog({ kind: 'property', nodeId: 'property-1' })
    expect(await screen.findByLabelText('Name')).toHaveValue('Count')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Property')
  })

  it('runs the event window off the same three calls the method one does', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'event', event })
    const { onClose } = renderDialog({ kind: 'event', ownerNodeId: 'type-1' })
    expect(await screen.findByLabelText('Name')).toHaveValue('Changed')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Event')
    expect(getNodeOptions).toHaveBeenCalledWith('ws', 'event', { ownerNodeId: 'type-1', isNew: true })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    const [owner, options] = createNode.mock.calls[0] as [string, NodeOptionsDto]
    expect(owner).toBe('type-1')
    expect(options).toEqual({ kind: 'event', event: { ...event, name: 'Renamed' } })

    cleanup()
    getNodeOptions.mockResolvedValue({ kind: 'event', event })
    renderDialog({ kind: 'event', nodeId: 'event-1' })
    expect(await screen.findByLabelText('Name')).toHaveValue('Changed')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Event')
  })

  it('says so rather than drawing an empty window for a kind it has no dialog for', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'type' })

    renderDialog({ kind: 'type', nodeId: 'type-1' })

    expect(await screen.findByText('The item cannot be edited.')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})
