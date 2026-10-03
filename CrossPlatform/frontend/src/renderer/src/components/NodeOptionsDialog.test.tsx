import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MethodOptionsDto, NodeOptionsDto, TypeSigDto } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { NodeOptionsDialog } from './NodeOptionsDialog'
import { METHOD_ACCESSES, METHOD_ATTRIBUTES, METHOD_IMPL_ATTRIBUTES } from './widgets/method-options'

const voidType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Void' } }

/** The access bits have no named members of their own, so they are read out of the same table the combo
 * is built from. */
const access = (label: string): number => METHOD_ACCESSES.find((entry) => entry.label === label)!.value

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

  it('says so rather than drawing an empty window for a kind it has no dialog for', async () => {
    getNodeOptions.mockResolvedValue({ kind: 'field' })

    renderDialog({ kind: 'field', nodeId: 'field-1' })

    expect(await screen.findByText('The item cannot be edited.')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})
