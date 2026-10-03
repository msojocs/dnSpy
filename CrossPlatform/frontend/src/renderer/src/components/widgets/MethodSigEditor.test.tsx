import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MethodSigDto, TreeNode, TypeSigDto } from '../../../../shared/protocol'
import { MethodSigEditor } from './MethodSigEditor'

const node = (id: string, label: string, kind: string, hasChildren: boolean, icon?: string): TreeNode => ({ id, label, kind, hasChildren, icon })

const TREE: Record<string, TreeNode[]> = {
  'ws:n1': [node('n2', 'Alpha', 'namespace', true)],
  'ws:n2': [node('n4', 'Alpha.Widget', 'type', false, 'class')],
}

const getRoots = vi.fn(async () => ({ nodes: [node('n1', 'Sample', 'module', true, 'assembly')] }))
const getChildren = vi.fn(async (_workspaceId: string, nodeId: string) => ({ nodes: TREE[`ws:${nodeId}`] ?? [] }))

beforeEach(() => {
  getRoots.mockClear()
  getChildren.mockClear()
  vi.stubGlobal('dnSpy', { getRoots, getChildren })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const voidType = (): TypeSigDto => ({ kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } })

const signature = (overrides: Partial<MethodSigDto> = {}): MethodSigDto => ({
  callingConvention: 0,
  returnType: voidType(),
  parameters: [],
  ...overrides,
})

/** The signature's own preview, which is the first one in the document. */
const preview = (): string => previews()[0] ?? ''

/** Every preview in the document: the signature's, then the ones its editors are showing. */
const previews = (): string[] => [...document.querySelectorAll('.typesig-preview')].map((element) => element.textContent ?? '')

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const press = (label: string): void => { fireEvent.click(screen.getByRole('button', { name: label })) }

const rowOf = (label: string): HTMLElement => {
  const row = within(screen.getByRole('dialog')).getByText(label).closest('[role="treeitem"]')
  if (!row)
    throw new Error(`No tree row holds '${label}'.`)
  return row as HTMLElement
}

const pickType = async (label: string): Promise<void> => {
  await screen.findByText('Sample')
  fireEvent.click(within(rowOf('Alpha')).getByRole('button'))
  fireEvent.click(await screen.findByText(label))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'OK' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

const Harness = ({ initial, canHaveSentinel = false }: { initial: MethodSigDto, canHaveSentinel?: boolean }): React.JSX.Element => {
  const [value, setValue] = useState(initial)
  return <MethodSigEditor workspaceId="ws" value={value} onChange={setValue} canHaveSentinel={canHaveSentinel} />
}

describe('MethodSigEditor', () => {
  it('reads the convention and the flags out of the one number that holds them', () => {
    // HasThis and the VarArg convention are different halves of the same value.
    render(<Harness initial={signature({ callingConvention: 0x20 | 5 })} />)

    expect(box('HasThis').checked).toBe(true)
    expect(box('ExplicitThis').checked).toBe(false)
    expect((screen.getByLabelText('Calling Conv') as HTMLSelectElement).value).toBe('5')
    expect(preview()).toBe('System.Void()')
  })

  it('writes a flag into the convention without disturbing the convention', () => {
    const onChange = vi.fn()
    render(<MethodSigEditor workspaceId="ws" value={signature({ callingConvention: 2 })} onChange={onChange} />)

    fireEvent.click(box('ExplicitThis'))

    expect(onChange.mock.calls[0][0].callingConvention).toBe(2 | 0x40)
  })

  it('writes the convention without disturbing the flags', () => {
    const onChange = vi.fn()
    render(<MethodSigEditor workspaceId="ws" value={signature({ callingConvention: 0x20 | 0x40 })} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Calling Conv'), { target: { value: '2' } })

    expect(onChange.mock.calls[0][0].callingConvention).toBe(0x60 | 2)
  })

  it('makes a signature generic exactly when it has generic parameters', () => {
    const onChange = vi.fn()
    const { unmount } = render(<MethodSigEditor workspaceId="ws" value={signature()} onChange={onChange} />)

    fireEvent.change(box('# Generics'), { target: { value: '2' } })
    expect(onChange.mock.calls[0][0]).toMatchObject({ callingConvention: 0x10, genericParameterCount: 2 })
    unmount()

    const clear = vi.fn()
    render(<MethodSigEditor workspaceId="ws" value={signature({ callingConvention: 0x10, genericParameterCount: 1 })} onChange={clear} />)
    fireEvent.change(box('# Generics'), { target: { value: '0' } })
    expect(clear.mock.calls[0][0]).toMatchObject({ callingConvention: 0, genericParameterCount: 0 })
  })

  it('adds a parameter once the whole of it has been assembled', async () => {
    render(<Harness initial={signature()} />)

    // The entry being assembled is empty, so it offers the same buttons a type signature does, and
    // nothing can be added until it holds something.
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    press('Type')
    await pickType('Alpha.Widget')

    // The list owns the entry being assembled, so the signature is still the one it was until that
    // entry is added — and the entry is only addable once it holds a whole signature.
    expect(previews()).toEqual(['System.Void()', 'System.Void', 'Alpha.Widget'])
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
    press('Add')

    expect(within(screen.getByRole('listbox')).getByText('Alpha.Widget')).toBeTruthy()
    expect(preview()).toBe('System.Void(Alpha.Widget)')
    // The creator is emptied for the next one, the way dnSpy clears it after every add.
    expect(screen.getByRole('button', { name: 'Type' })).toBeTruthy()
  })

  it('offers the vararg list only where a sentinel can be', () => {
    const { unmount } = render(<Harness initial={signature()} />)
    expect(screen.queryByText('Method VarArg Parameter Types')).toBeNull()
    unmount()

    render(<Harness initial={signature()} canHaveSentinel />)
    expect(screen.getByText('Method VarArg Parameter Types')).toBeTruthy()
  })

  it('clears the return type into a slot a dialog can see is empty', () => {
    const onChange = vi.fn()
    render(<MethodSigEditor workspaceId="ws" value={signature()} onChange={onChange} />)

    // The first Clear is the return type's own; the ones below it belong to the parameter creators.
    const clears = screen.getAllByRole('button', { name: 'Clear' })
    expect(clears.length).toBeGreaterThan(1)
    fireEvent.click(clears[0])

    expect(onChange.mock.calls[0][0]).toEqual({ ...signature(), returnType: { kind: 'empty' } })
  })
})
