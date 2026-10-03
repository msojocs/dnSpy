import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MethodOptionsDto, MethodRefDto, NodeOptionsDto, TreeNode, TypeSigDto } from '../../../../shared/protocol'
import { MethodDefsListEditor } from './MethodDefsListEditor'

const voidType: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } }

const sample: TreeNode = { id: 'n1', label: 'Sample', kind: 'module', hasChildren: true, icon: 'assembly' }
const other: TreeNode = { id: 'n9', label: 'Other', kind: 'module', hasChildren: true, icon: 'assembly' }
const alpha: TreeNode = { id: 'n2', label: 'Alpha', kind: 'namespace', hasChildren: true }
const widget: TreeNode = { id: 'n4', label: 'Alpha.Widget', kind: 'type', hasChildren: true, icon: 'class' }
const reset: TreeNode = { id: 'n6', label: 'Reset()', kind: 'method', hasChildren: false, icon: 'method' }
const clear: TreeNode = { id: 'n7', label: 'Clear()', kind: 'method', hasChildren: false, icon: 'method' }

/** One module with one namespace, one type, and the two methods a property is made of. */
const CHILDREN: Record<string, TreeNode[]> = {
  'ws:n1': [alpha],
  'ws:n2': [widget],
  'ws:n4': [reset, clear],
}

const method = (name: string): MethodOptionsDto => ({
  implAttributes: 0,
  attributes: 0,
  semanticsAttributes: 0,
  name,
  methodSig: { callingConvention: 0x20, returnType: voidType, parameters: [], genericParameterCount: 0 },
  customAttributes: [],
  declSecurities: [],
  paramDefs: [],
  genericParameters: [],
  overrides: [],
})

const getRoots = vi.fn(async () => ({ nodes: [sample, other] }))
const getChildren = vi.fn(async (_workspaceId: string, nodeId: string) => ({ nodes: CHILDREN[`ws:${nodeId}`] ?? [] }))
const getNodeOptions = vi.fn(async (_workspaceId: string, _kind: string, request: { nodeId?: string }): Promise<NodeOptionsDto> =>
  request.nodeId === 'n6' ? { kind: 'method', method: method('Reset') } : { kind: 'method', method: method('Clear') })

beforeEach(() => {
  getRoots.mockClear()
  getChildren.mockClear()
  getNodeOptions.mockClear()
  vi.stubGlobal('dnSpy', { getRoots, getChildren, getNodeOptions })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const reference = (patch: Partial<MethodRefDto> = {}): MethodRefDto => ({
  declaringType: { kind: 'type', type: { scope: '', namespace: 'Alpha', name: 'Widget', nodeId: 'n4' } },
  name: 'Reset',
  signature: { callingConvention: 0x20, returnType: voidType, parameters: [], genericParameterCount: 0 },
  ...patch,
})

const rows = (): HTMLElement[] => within(screen.getByRole('listbox')).getAllByRole('option')

const renderList = (items: MethodRefDto[] = [], rootNodeIds?: string[]): { onChange: ReturnType<typeof vi.fn> } => {
  const onChange = vi.fn()
  render(<MethodDefsListEditor workspaceId="ws" items={items} onChange={onChange} rootNodeIds={rootNodeIds} />)
  return { onChange }
}

/** Walks the picker the way a user does: open the namespace, then the type, then pick the method. */
const pickMethod = async (label: string): Promise<void> => {
  fireEvent.doubleClick(await screen.findByText('Alpha'))
  fireEvent.doubleClick(await screen.findByText('Alpha.Widget'))
  fireEvent.click(await screen.findByText(label))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'OK' }))
}

describe('MethodDefsListEditor', () => {
  it('names each row the way dnlib does, which is the full name of the method', () => {
    renderList([reference()])
    expect(rows().map((row) => row.textContent)).toEqual(['System.Void Alpha.Widget::Reset()'])
  })

  it('shows the name the backend already composed for a row it read', () => {
    renderList([reference({ display: 'void Widget::Reset()' })])
    expect(rows().map((row) => row.textContent)).toEqual(['void Widget::Reset()'])
  })

  it('is the list of methods, which is what it is called with nothing else said', () => {
    renderList()
    expect(screen.getByRole('listbox', { name: 'Methods' })).toBeTruthy()
  })

  it('picks a method into a new row, which is the only way a row is ever added', async () => {
    const { onChange } = renderList([reference()])
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))

    // There is no window for the row itself: Add... opens the method picker and nothing else.
    expect(screen.getByRole('dialog', { name: 'Pick a Method' })).toBeTruthy()
    await pickMethod('Clear()')

    await waitFor(() => { expect(onChange).toHaveBeenCalled() })
    const added: MethodRefDto[] = onChange.mock.calls[0][0]
    expect(added.map((row) => row.name)).toEqual(['Reset', 'Clear'])
    // The declaring type comes from the chain the picker walked, and the signature from the method's
    // own options — the row is a type, a name and a signature, with nothing else to it.
    expect(added[1].declaringType.type?.name).toBe('Widget')
    expect(added[1].declaringType.type?.namespace).toBe('Alpha')
    expect(added[1].signature.returnType).toEqual(voidType)
  })

  it('replaces the row Edit... was opened on, rather than adding another', async () => {
    const { onChange } = renderList([reference(), reference({ name: 'Clear' })])
    fireEvent.click(rows()[0])
    fireEvent.click(screen.getByRole('button', { name: 'Edit...' }))
    await pickMethod('Clear()')

    await waitFor(() => { expect(onChange).toHaveBeenCalled() })
    expect(onChange.mock.calls[0][0].map((row: MethodRefDto) => row.name)).toEqual(['Clear', 'Clear'])
  })

  it('leaves the list alone when the picker is dismissed', async () => {
    const { onChange } = renderList([reference()])
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(1)
  })

  it('offers only the module it was given, since an accessor has to be a method of the same one', async () => {
    renderList([], ['n1'])
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))

    expect(await screen.findByText('Sample')).toBeTruthy()
    expect(screen.queryByText('Other')).toBeNull()
  })

  it('says why when the picked method cannot be described, instead of writing a half row', async () => {
    // A node the backend will not describe as a method leaves nothing to write the row from; dnSpy
    // cannot reach this, since the picker hands back the method itself, so the port says so instead.
    getNodeOptions.mockResolvedValueOnce({ kind: 'method' })
    const { onChange } = renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    await pickMethod('Clear()')

    // The window says it twice — once as the page and once as the reason it cannot be accepted.
    expect(await screen.findAllByText('The selected method cannot be used as an accessor.')).toHaveLength(2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers every module when it was given none to choose from', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))

    expect(await screen.findByText('Other')).toBeTruthy()
  })
})
