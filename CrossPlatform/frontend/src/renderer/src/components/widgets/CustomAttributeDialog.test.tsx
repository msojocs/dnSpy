import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MethodRefDto, TreeNode, TypeSigDto } from '../../../../shared/protocol'
import { CustomAttributeDialog } from './CustomAttributeDialog'
import { customAttributeArguments, type CustomAttributeDraft, newCustomAttribute, newNamedArgument } from './custom-attribute'

const node = (id: string, label: string, kind: string, hasChildren: boolean, icon?: string): TreeNode => ({ id, label, kind, hasChildren, icon })

/** One module, one namespace, one type under it, and two of its constructors — a parameterless one and
 * one that takes a string, which is what tells the argument rows apart. */
const TREE: Record<string, TreeNode[]> = {
  'ws:n1': [node('n2', 'System', 'namespace', true)],
  'ws:n2': [node('n4', 'System.ObsoleteAttribute', 'type', true, 'class')],
  'ws:n4': [
    node('n5', '.ctor()', 'method', false, 'method'),
    node('n6', '.ctor(System.String)', 'method', false, 'method'),
    node('n7', '.cctor()', 'method', false, 'method'),
    node('n8', 'IsError', 'method', false, 'method'),
  ],
}

const stringSig: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'String' } }

const constructorRef = (parameters: TypeSigDto[]): MethodRefDto => ({
  declaringType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'ObsoleteAttribute' } },
  name: '.ctor',
  signature: { callingConvention: 0, returnType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } }, parameters },
})

const getRoots = vi.fn(async () => ({ nodes: [node('n1', 'Sample', 'module', true, 'assembly')] }))
const getChildren = vi.fn(async (_workspaceId: string, nodeId: string) => ({ nodes: TREE[`ws:${nodeId}`] ?? [] }))
// The method the dialog reads its constructor's name and signature out of.
const getNodeOptions = vi.fn(async (_workspaceId: string, _kind: string, request: { nodeId?: string }) => ({
  kind: 'method',
  method: {
    implAttributes: 0,
    attributes: 0,
    semanticsAttributes: 0,
    name: '.ctor',
    methodSig: {
      callingConvention: request.nodeId === 'n6' ? 0 : 0,
      returnType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } } as TypeSigDto,
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

const renderDialog = (value: CustomAttributeDraft = newCustomAttribute()): { onAccept: ReturnType<typeof vi.fn>, onCancel: ReturnType<typeof vi.fn> } => {
  const onAccept = vi.fn()
  const onCancel = vi.fn()
  render(<CustomAttributeDialog workspaceId="ws" value={value} isNew onAccept={onAccept} onCancel={onCancel} />)
  return { onAccept, onCancel }
}

/** The picker, which is the second dialog on screen while it is open. */
const picker = (): HTMLElement => screen.getByRole('dialog', { name: 'Pick a Constructor' })

const pickerRow = (label: string): HTMLElement => {
  const row = within(picker()).getByText(label).closest('[role="treeitem"]')
  if (!row)
    throw new Error(`No tree row holds '${label}'.`)
  return row as HTMLElement
}

const expand = (label: string): void => {
  fireEvent.click(within(pickerRow(label)).getByRole('button'))
}

/** Picks a constructor the way the tree is walked: open the namespace, open the type, pick, accept. */
const pickConstructor = async (label: string): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: 'Pick a Constructor' }))
  await screen.findByText('Sample')
  expand('System')
  await screen.findByText('System.ObsoleteAttribute')
  expand('System.ObsoleteAttribute')
  fireEvent.click(await screen.findByText(label))
  fireEvent.click(within(picker()).getByRole('button', { name: 'OK' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pick a Constructor' })).toBeNull())
}

const ok = (): HTMLElement => screen.getByRole('button', { name: 'OK' })

/** One of the dialog's two groupboxes, since a named argument has a kind combo of its own. */
const group = (legend: string): HTMLElement => {
  const found = screen.getByText(legend).closest('fieldset')
  if (!found)
    throw new Error(`No groupbox is labelled '${legend}'.`)
  return found as HTMLElement
}

const kindBoxes = (): HTMLSelectElement[] => within(group('Constructor Arguments')).queryAllByLabelText('Value type') as HTMLSelectElement[]
const valueBoxes = (): HTMLInputElement[] => within(group('Constructor Arguments')).queryAllByLabelText('Value') as HTMLInputElement[]

afterEach(cleanup)

describe('CustomAttributeDialog', () => {
  it('refuses to be accepted before a constructor is picked', () => {
    renderDialog()

    expect(ok()).toBeDisabled()
    expect(screen.getByText('Pick a Constructor')).toBeTruthy()
    expect(screen.getByLabelText('Constructor')).toHaveValue('(not set)')
  })

  it('builds one argument per parameter of the constructor it is pointed at', async () => {
    renderDialog()
    await pickConstructor('.ctor(System.String)')

    expect(screen.getByLabelText('Constructor')).toHaveValue('System.ObsoleteAttribute(System.String)')
    // One parameter, so one row, of the kind that parameter is — a string, which starts out null.
    expect(kindBoxes()).toHaveLength(1)
    expect(kindBoxes()[0]).toHaveValue('String')
    // A string parameter starts at the null string, which is an empty box rather than a box holding 0.
    expect(valueBoxes()[0]).toHaveValue('')
    expect(ok()).toBeEnabled()
  })

  it('drops the arguments of the constructor it had when it is pointed at another', async () => {
    const start: CustomAttributeDraft = {
      constructor: constructorRef([stringSig]),
      constructorArguments: customAttributeArguments(constructorRef([stringSig])),
      namedArguments: [newNamedArgument()],
    }
    renderDialog(start)
    expect(kindBoxes()).toHaveLength(1)

    await pickConstructor('.ctor()')
    // The parameterless constructor takes nothing, but the named arguments are the user's own and stay.
    expect(kindBoxes()).toHaveLength(0)
    expect((screen.getAllByLabelText('Name') as HTMLInputElement[])).toHaveLength(1)
  })

  it('accepts a whole attribute once its constructor is there', async () => {
    const { onAccept, onCancel } = renderDialog()
    await pickConstructor('.ctor(System.String)')
    fireEvent.click(ok())

    const draft = onAccept.mock.calls[0][0] as CustomAttributeDraft
    expect(draft.constructor?.name).toBe('.ctor')
    expect(draft.constructor?.declaringType.type?.name).toBe('ObsoleteAttribute')
    expect(draft.constructor?.signature.parameters).toEqual([stringSig])
    expect(draft.constructorArguments).toHaveLength(1)
    expect(draft.constructorArguments[0].type).toEqual(stringSig)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('writes nothing back when it is cancelled', () => {
    const { onAccept, onCancel } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalled()
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('puts the attribute back the way it opened', async () => {
    const start: CustomAttributeDraft = {
      constructor: constructorRef([stringSig]),
      constructorArguments: customAttributeArguments(constructorRef([stringSig])),
      namedArguments: [],
    }
    renderDialog(start)
    await pickConstructor('.ctor()')
    expect(kindBoxes()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(kindBoxes()).toHaveLength(1)
    expect(screen.getByLabelText('Constructor')).toHaveValue('System.ObsoleteAttribute(System.String)')
  })

  it('offers only instance constructors to pick', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Pick a Constructor' }))
    await screen.findByText('Sample')
    expand('System')
    await screen.findByText('System.ObsoleteAttribute')
    expand('System.ObsoleteAttribute')
    await screen.findByText('.ctor()')

    expect(pickerRow('.ctor(System.String)')).toHaveAttribute('aria-disabled', 'false')
    // The tree is `VisibleMembersFlags.InstanceConstructor`: a static constructor and a plain method are
    // not answers and not even shown, since nothing below them could be either.
    expect(within(picker()).queryByText('.cctor()')).toBeNull()
    expect(within(picker()).queryByText('IsError')).toBeNull()
  })
})
