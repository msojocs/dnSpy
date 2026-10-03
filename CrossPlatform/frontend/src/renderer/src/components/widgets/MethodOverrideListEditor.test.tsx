import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MethodRefDto, TreeNode, TypeSigDto } from '../../../../shared/protocol'
import { MethodOverrideListEditor } from './MethodOverrideListEditor'
import type { MethodOverrideDraft } from './method-override'

const node = (id: string, label: string, kind: string, hasChildren: boolean, icon?: string): TreeNode => ({ id, label, kind, hasChildren, icon })

/** One module, one namespace, one type under it, and two of its methods — which one is picked is what
 * tells the rows apart. */
const TREE: Record<string, TreeNode[]> = {
  'ws:n1': [node('n2', 'System', 'namespace', true)],
  'ws:n2': [node('n4', 'System.Base', 'type', true, 'class')],
  'ws:n4': [
    node('n5', 'Run()', 'method', false, 'method'),
    node('n6', 'Run(System.String)', 'method', false, 'method'),
  ],
}

const stringSig: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'String' } }
const voidSig: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } }

const getRoots = vi.fn(async () => ({ nodes: [node('n1', 'Sample', 'module', true, 'assembly')] }))
const getChildren = vi.fn(async (_workspaceId: string, nodeId: string) => ({ nodes: TREE[`ws:${nodeId}`] ?? [] }))
// The method the dialog reads its name and signature out of, which is all a reference to it is made of.
const getNodeOptions = vi.fn(async (_workspaceId: string, _kind: string, request: { nodeId?: string }) => ({
  kind: 'method',
  method: {
    implAttributes: 0,
    attributes: 0,
    semanticsAttributes: 0,
    name: 'Run',
    methodSig: {
      callingConvention: 0,
      returnType: voidSig,
      parameters: request.nodeId === 'n6' ? [stringSig] : [],
    },
    customAttributes: [],
    declSecurities: [],
    paramDefs: [],
    genericParameters: [],
    overrides: [],
  },
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

const reference = (parameters: TypeSigDto[], display?: string): MethodRefDto => ({
  declaringType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Base' } },
  name: 'Run',
  signature: { callingConvention: 0, returnType: voidSig, parameters },
  display,
})

/** The editor driven the way the method dialog drives it: it owns the list and re-renders what it
 * reports, since a row only appears once the list has taken the change. */
const renderList = (initial: MethodOverrideDraft[] = []): { changes: MethodOverrideDraft[][] } => {
  const changes: MethodOverrideDraft[][] = []
  const Harness = (): React.JSX.Element => {
    const [items, setItems] = useState(initial)
    return (
      <MethodOverrideListEditor
        workspaceId="ws"
        items={items}
        onChange={(next) => { changes.push(next); setItems(next) }}
      />
    )
  }
  render(<Harness />)
  return { changes }
}

const picker = (): HTMLElement => screen.getByRole('dialog', { name: 'Pick a Method' })

const pickerRow = (label: string): HTMLElement => {
  const row = within(picker()).getByText(label).closest('[role="treeitem"]')
  if (!row)
    throw new Error(`No tree row holds '${label}'.`)
  return row as HTMLElement
}

const expand = (label: string): void => {
  fireEvent.click(within(pickerRow(label)).getByRole('button'))
}

/** Picks a method the way the tree is walked: open the namespace, open the type, pick, accept. */
const pickMethod = async (label: string, accept = true): Promise<void> => {
  await screen.findByText('Sample')
  expand('System')
  await screen.findByText('System.Base')
  expand('System.Base')
  fireEvent.click(await screen.findByText(label))
  fireEvent.click(within(picker()).getByRole('button', { name: accept ? 'OK' : 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pick a Method' })).toBeNull())
}

const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.list-editor-row'))

describe('MethodOverrideListEditor', () => {
  it('goes straight to the method picker, since an override is the method it names', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))

    expect(picker()).toBeTruthy()
  })

  it('writes nothing when the picker is cancelled', async () => {
    const { changes } = renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    await pickMethod('Run(System.String)', false)

    expect(changes).toEqual([])
    expect(rows()).toHaveLength(0)
  })

  it('adds a row for the method that was picked, with no body — the method being edited is its body', async () => {
    const { changes } = renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    await pickMethod('Run(System.String)')

    expect(changes).toHaveLength(1)
    expect(changes[0][0].methodDeclaration?.name).toBe('Run')
    expect(changes[0][0].methodDeclaration?.signature.parameters).toEqual([stringSig])
    expect(changes[0][0].methodDeclaration?.declaringType.type?.name).toBe('Base')
    expect(changes[0][0].methodBody).toBeUndefined()
  })

  it('names the row the way dnlib names the method it overrides', async () => {
    const { changes } = renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    await pickMethod('Run(System.String)')

    expect(rows()[0].textContent).toBe('System.Void System.Base::Run(System.String)')
    expect(changes).toHaveLength(1)
  })

  it('points an existing row at another method and keeps the body it came with', async () => {
    const body = reference([])
    const { changes } = renderList([{ methodBody: body, methodDeclaration: reference([]) }])
    expect(rows()[0].textContent).toBe('System.Void System.Base::Run()')

    fireEvent.click(rows()[0])
    fireEvent.click(screen.getByRole('button', { name: 'Edit...' }))
    await pickMethod('Run(System.String)')

    expect(changes).toHaveLength(1)
    expect(changes[0][0].methodBody).toBe(body)
    expect(changes[0][0].methodDeclaration?.signature.parameters).toEqual([stringSig])
  })

  it('shows the row the backend named rather than composing one of its own', () => {
    renderList([{ methodDeclaration: reference([], 'System.Void System.Base::Run()') }])
    expect(rows()[0].textContent).toBe('System.Void System.Base::Run()')
  })
})
