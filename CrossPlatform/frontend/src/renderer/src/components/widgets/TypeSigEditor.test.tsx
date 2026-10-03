import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeNode, TypeSigDto } from '../../../../shared/protocol'
import { TypeSigEditor, type TypeSigEditorOptions } from './TypeSigEditor'

const node = (id: string, label: string, kind: string, hasChildren: boolean, icon?: string): TreeNode => ({ id, label, kind, hasChildren, icon })

/** One module, one namespace, and a generic and a non-generic type in it. */
const TREE: Record<string, TreeNode[]> = {
  'ws:n1': [node('n2', 'Alpha', 'namespace', true)],
  'ws:n2': [node('n4', 'Alpha.Widget', 'type', false, 'class'), node('n7', 'Alpha.Box`1', 'type', false, 'class')],
}

/** Int32, built the way a dialog would build it: a name, and nothing else to say what it is. */
const int32 = (): TypeSigDto => ({ kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' } })

const getRoots = vi.fn(async () => ({ nodes: [node('n1', 'Sample', 'module', true, 'assembly')] }))
const getChildren = vi.fn(async (_workspaceId: string, nodeId: string) => ({ nodes: TREE[`ws:${nodeId}`] ?? [] }))
// Only a generic type answers with parameters, which is what tells the editor how many arguments an
// instance of it takes.
const getNodeOptions = vi.fn(async (_workspaceId: string, _kind: string, nodeId: string) => ({
  kind: 'type',
  type: { namespace: 'Alpha', name: 'Widget', genericParameters: nodeId === 'n7' ? [{ number: 0 }, { number: 1 }] : [] },
}))

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

const dialog = (): HTMLElement => screen.getByRole('dialog')

const rowOf = (label: string): HTMLElement => {
  const row = within(dialog()).getByText(label).closest('[role="treeitem"]')
  if (!row)
    throw new Error(`No tree row holds '${label}'.`)
  return row as HTMLElement
}

/** Picks a type out of the picker the way the tree is walked: open the namespace, select, accept. */
const pickType = async (label: string): Promise<void> => {
  await screen.findByText('Sample')
  fireEvent.click(within(rowOf('Alpha')).getByRole('button'))
  fireEvent.click(await screen.findByText(label))
  fireEvent.click(within(dialog()).getByRole('button', { name: 'OK' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

const press = (label: string): void => { fireEvent.click(screen.getByRole('button', { name: label })) }

/** The editor driven the way a dialog drives it: it owns the value and re-renders what it reports. */
const Harness = ({ initial, options }: { initial: TypeSigDto | null, options?: TypeSigEditorOptions }): React.JSX.Element => {
  const [value, setValue] = useState(initial)
  return <TypeSigEditor workspaceId="ws" value={value} onChange={setValue} options={options} />
}

/** The outermost preview, which is the one the value being edited belongs to. */
const preview = (): string => document.querySelector('.typesig-preview')?.textContent ?? ''

describe('TypeSigEditor', () => {
  it('starts a signature from nothing, with only the buttons that can start one', () => {
    render(<Harness initial={null} />)

    for (const label of ['Type', 'Var', 'MVar', 'GenericInst', 'FnPtr'])
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    // Nothing to wrap and nothing to show yet.
    for (const label of ['Pointer', 'ByRef', 'SZ Array', 'CModReqd', 'CModOpt', 'Pinned'])
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    expect(document.querySelector('.typesig-preview')).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })

  it('takes the type it was picked as, named the way the backend resolves it', async () => {
    const onChange = vi.fn()
    render(<TypeSigEditor workspaceId="ws" value={null} onChange={onChange} />)

    press('Type')
    await pickType('Alpha.Widget')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual({
      kind: 'type',
      // The node id is what the backend resolves first; the name is its fallback, and it drops the
      // namespace the tree put in front of the label.
      type: { scope: '', namespace: 'Alpha', name: 'Widget', nodeId: 'n4' },
    })
  })

  it('shows the signature it holds, and wraps and unwraps it', () => {
    render(<Harness initial={int32()} />)
    expect(preview()).toBe('System.Int32')

    press('Pointer')
    expect(preview()).toBe('System.Int32*')
    press('ByRef')
    expect(preview()).toBe('System.Int32*&')

    // Remove takes the outermost shape off, one at a time, and Clear drops the whole thing.
    press('Remove')
    expect(preview()).toBe('System.Int32*')
    press('Remove')
    expect(preview()).toBe('System.Int32')
    press('Clear')
    expect(screen.queryByText('System.Int32')).toBeNull()
    expect(screen.getByRole('button', { name: 'Type' })).toBeTruthy()
  })

  it('turns what it holds into a multidimensional array of the rank and bounds it was given', () => {
    const onChange = vi.fn()
    render(<TypeSigEditor workspaceId="ws" value={int32()} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Rank'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Sizes'), { target: { value: '1, 2, 3' } })
    fireEvent.change(screen.getByLabelText('Lower Bounds'), { target: { value: '0,0,0' } })
    press('Array')

    expect(onChange.mock.calls[0][0]).toEqual({
      kind: 'array',
      element: int32(),
      rank: 3,
      sizes: [1, 2, 3],
      lowerBounds: [0, 0, 0],
    })
  })

  it('refuses a rank, a size or a bound that is not a number in range', () => {
    render(<Harness initial={int32()} />)

    fireEvent.change(screen.getByLabelText('Sizes'), { target: { value: '1,x' } })
    expect(screen.getByRole('button', { name: 'Array' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Sizes'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Rank'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Array' })).toBeDisabled()
  })

  it('adds a generic variable of the number it was given, where the owner has one', () => {
    const onChange = vi.fn()
    render(<TypeSigEditor workspaceId="ws" value={null} onChange={onChange} options={{ canAddGenericTypeVar: true }} />)

    // The method's variables are the ones this signature has no business naming.
    expect(screen.getByRole('button', { name: 'MVar' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('#'), { target: { value: '3' } })
    press('Var')

    expect(onChange.mock.calls[0][0]).toEqual({ kind: 'genericvar', genericParameterNumber: 3 })
  })

  it('offers a pinned variable only where one can live, and never wraps it again', () => {
    const onChange = vi.fn()
    const { unmount } = render(<TypeSigEditor workspaceId="ws" value={int32()} onChange={onChange} options={{ isLocal: true }} />)
    press('Pinned')
    expect(onChange.mock.calls[0][0]).toEqual({ kind: 'pinned', element: int32() })
    unmount()

    render(<TypeSigEditor workspaceId="ws" value={int32()} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Pinned' })).toBeDisabled()
  })

  it('a pinned signature is the end of the line: nothing can wrap it', () => {
    render(<Harness initial={{ kind: 'pinned', element: int32() }} options={{ isLocal: true }} />)

    for (const label of ['Pointer', 'ByRef', 'SZ Array', 'CModReqd', 'CModOpt', 'Pinned', 'Array'])
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    // A pinned variable is its inner type as far as the name goes, which is how dnlib writes one.
    expect(preview()).toBe('System.Int32')
  })

  it('gives a generic instance one argument per parameter the type declares', async () => {
    render(<Harness initial={null} />)

    press('GenericInst')
    await pickType('Alpha.Box`1')

    // Two parameters, so two slots, and each is edited by an editor of its own.
    await waitFor(() => expect(screen.getByText('Type argument 2')).toBeTruthy())
    expect(screen.getByText('Type argument 1')).toBeTruthy()
    expect(preview()).toBe('Alpha.Box`1<(not set),(not set)>')

    // Filling the first one recurses into the same editor: it starts out empty, so it offers a type.
    fireEvent.click(screen.getAllByRole('button', { name: 'Type' })[0])
    await pickType('Alpha.Widget')
    expect(preview()).toBe('Alpha.Box`1<Alpha.Widget,(not set)>')
  })

  it('reports a type that takes no arguments rather than opening slots for them', async () => {
    render(<Harness initial={null} />)

    press('GenericInst')
    await pickType('Alpha.Widget')

    await waitFor(() => expect(screen.getByText('Alpha.Widget is not a generic type')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Type' })).toBeTruthy()
  })

  it('reports a generic type the backend will not describe', async () => {
    getNodeOptions.mockRejectedValueOnce(new Error('The selected item cannot be edited.'))
    render(<Harness initial={null} />)

    press('GenericInst')
    await pickType('Alpha.Box`1')

    await waitFor(() => expect(screen.getByText('The selected item cannot be edited.')).toBeTruthy())
  })

  it('picks the modifier before it wraps the signature with it', async () => {
    const onChange = vi.fn()
    render(<TypeSigEditor workspaceId="ws" value={int32()} onChange={onChange} />)

    press('CModReqd')
    await pickType('Alpha.Widget')

    expect(onChange.mock.calls[0][0]).toEqual({
      kind: 'cmodreqd',
      modifier: { kind: 'type', type: { scope: '', namespace: 'Alpha', name: 'Widget', nodeId: 'n4' } },
      element: int32(),
    })
  })

  it('edits a function pointer with the method signature editor', () => {
    render(<Harness initial={null} />)

    press('FnPtr')

    // A function pointer is a signature of its own, so the method editor is what edits it — starting
    // out the way dnSpy's method-signature dialog does: no convention of its own, returning void.
    expect(preview()).toBe('method System.Void()')
    expect(screen.getByText('Flags')).toBeTruthy()
    expect(screen.getByText('Method Parameter Types')).toBeTruthy()
  })
})
