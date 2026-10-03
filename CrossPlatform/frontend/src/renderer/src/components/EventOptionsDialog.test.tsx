import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventOptionsDto, MethodOptionsDto, NodeOptionsDto, TreeNode, TypeSigDto } from '../../../shared/protocol'
import { EventOptionsDialog } from './EventOptionsDialog'
import { EVENT_ATTRIBUTES } from './widgets/event-options'

const voidType: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } }
const eventHandler: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'EventHandler' } }

const sample: TreeNode = { id: 'n1', label: 'Sample', kind: 'module', hasChildren: true, icon: 'assembly' }
const alpha: TreeNode = { id: 'n2', label: 'Alpha', kind: 'namespace', hasChildren: true }
const widget: TreeNode = { id: 'n4', label: 'Alpha.Widget', kind: 'type', hasChildren: true, icon: 'class' }
const reset: TreeNode = { id: 'n6', label: 'Reset()', kind: 'method', hasChildren: false, icon: 'method' }
const clear: TreeNode = { id: 'n7', label: 'Clear()', kind: 'method', hasChildren: false, icon: 'method' }

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

const getRoots = vi.fn(async () => ({ nodes: [sample] }))
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

const event = (patch: Partial<EventOptionsDto> = {}): EventOptionsDto => ({
  attributes: 0,
  name: 'Changed',
  eventType: eventHandler,
  otherMethods: [],
  customAttributes: [],
  ...patch,
})

const renderDialog = (value: EventOptionsDto, isNew = true, failure?: string): { accepted: EventOptionsDto[], onCancel: () => void } => {
  const accepted: EventOptionsDto[] = []
  const onCancel = vi.fn()
  render(<EventOptionsDialog workspaceId="ws" value={value} isNew={isNew} failure={failure} onAccept={(next) => { accepted.push(next) }} onCancel={onCancel} />)
  return { accepted, onCancel }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const open = (tab: string): void => { fireEvent.click(screen.getByRole('tab', { name: tab })) }
const accept = (): void => { fireEvent.click(screen.getByRole('button', { name: 'OK' })) }
const clearButton = (label: string): HTMLButtonElement => screen.getByRole('button', { name: `Set to null: ${label}` }) as HTMLButtonElement

/** Walks the picker the way a user does: open the namespace, then the type, then pick the method. */
const pickMethod = async (label: string): Promise<void> => {
  fireEvent.doubleClick(await screen.findByText('Alpha'))
  fireEvent.doubleClick(await screen.findByText('Alpha.Widget'))
  fireEvent.click(await screen.findByText(label))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Pick a Method' })).getByRole('button', { name: 'OK' }))
}

describe('EventOptionsDialog', () => {
  it('draws the five pages of dnSpy\'s event window in its order', () => {
    renderDialog(event())
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Main', 'Type', 'Methods', 'Other Methods', 'Custom Attrs'])
  })

  it('titles the same window for the command that opened it', () => {
    renderDialog(event(), true)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Event')

    cleanup()
    renderDialog(event(), false)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Event')
  })

  it('lays the Main page out the way the XAML does, with no default value to follow', () => {
    renderDialog(event({ attributes: EVENT_ATTRIBUTES.SpecialName }))

    expect(box('Name')).toHaveValue('Changed')
    const flags = screen.getByRole('group', { name: 'Flags' })
    expect(Array.from(flags.querySelectorAll('label')).map((label) => label.textContent)).toEqual(['SpecialName', 'RTSpecialName'])
    expect(box('SpecialName')).toBeChecked()
    expect(box('RTSpecialName')).not.toBeChecked()
    // An event has nothing derived from a value, so neither bit is a box and there is no Constant row.
    expect(screen.queryByLabelText('HasDefault')).toBeNull()
    expect(screen.queryByLabelText('Constant')).toBeNull()
  })

  it('writes both flag boxes into the one attribute word', () => {
    const { accepted } = renderDialog(event({ attributes: EVENT_ATTRIBUTES.SpecialName }))
    fireEvent.click(box('RTSpecialName'))
    fireEvent.click(box('SpecialName'))
    accept()
    expect(accepted[0].attributes).toBe(EVENT_ATTRIBUTES.RTSpecialName)
  })

  it('lays the Methods page out as three pickers with a clear button and a box each', () => {
    renderDialog(event())
    open('Methods')

    for (const label of ['Add...', 'Invoke...', 'Remove...']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
      expect(clearButton(label)).toBeDisabled()
      expect(box(`${label} method`)).toHaveValue('null')
    }
  })

  it('picks a method into a row, which is what the read-only box then shows', async () => {
    const { accepted } = renderDialog(event())
    open('Methods')
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    await pickMethod('Reset()')

    await waitFor(() => { expect(box('Add... method')).toHaveValue('System.Void Alpha.Widget::Reset()') })
    expect(clearButton('Add...')).toBeEnabled()
    accept()
    expect(accepted[0].addMethod).toEqual({ name: 'Reset', nodeId: 'n6', display: 'System.Void Alpha.Widget::Reset()' })
  })

  it('clears a row back to null with dnSpy\'s C button, and only then', () => {
    const addMethod = { name: 'add_Changed', token: 7, display: 'void Type::add_Changed(EventHandler)' }
    const { accepted } = renderDialog(event({ addMethod }))
    open('Methods')
    expect(box('Add... method')).toHaveValue('void Type::add_Changed(EventHandler)')

    fireEvent.click(clearButton('Add...'))
    expect(box('Add... method')).toHaveValue('null')
    expect(clearButton('Add...')).toBeDisabled()
    accept()
    expect(accepted[0].addMethod).toBeUndefined()
    // The rows beside it are not the one that was cleared.
    expect(accepted[0].invokeMethod).toBeUndefined()
    expect(accepted[0].removeMethod).toBeUndefined()
  })

  it('closes the picker on Escape without closing the window under it', async () => {
    renderDialog(event())
    open('Methods')
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    expect(await screen.findByRole('dialog', { name: 'Pick a Method' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Pick a Method' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Create Event' })).toBeTruthy()
  })

  it('shows the other methods under a list of their own', () => {
    renderDialog(event({ otherMethods: [{ name: 'OnChanged', token: 10, display: 'void Type::OnChanged()' }] }))
    open('Other Methods')

    expect(within(screen.getByRole('listbox', { name: 'Other Methods' })).getAllByRole('option').map((row) => row.textContent))
      .toEqual(['void Type::OnChanged()'])
  })

  it('holds nothing back, which is what dnSpy\'s event window does by having no error of its own', () => {
    // An event with no type at all is written as it stands: EventOptionsVM never overrides HasError.
    renderDialog(event({ eventType: undefined }))
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
  })

  it('hands the whole model back, so a page the dialog never opened is not emptied', () => {
    const invokeMethod = { name: 'raise_Changed', token: 8, display: 'void Type::raise_Changed(object, EventArgs)' }
    const { accepted } = renderDialog(event({
      attributes: EVENT_ATTRIBUTES.SpecialName,
      eventType: eventHandler,
      invokeMethod,
      otherMethods: [{ name: 'OnChanged', token: 10 }],
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
    }))

    fireEvent.change(box('Name'), { target: { value: 'OnChanged' } })
    accept()

    expect(accepted[0].name).toBe('OnChanged')
    expect(accepted[0].eventType).toEqual(eventHandler)
    expect(accepted[0].invokeMethod).toEqual(invokeMethod)
    expect(accepted[0].otherMethods).toEqual([{ name: 'OnChanged', token: 10 }])
    expect(accepted[0].customAttributes).toHaveLength(1)
  })

  it('shows why the write was refused without losing the model it was refused for', () => {
    renderDialog(event(), true, 'There is already an event with that name.')
    expect(screen.getByText('There is already an event with that name.')).toBeTruthy()
    expect(box('Name')).toHaveValue('Changed')
    expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
  })

  it('puts every page back to what the window opened with', () => {
    renderDialog(event({ attributes: EVENT_ATTRIBUTES.SpecialName, addMethod: { name: 'add_Changed', token: 7 } }))
    fireEvent.change(box('Name'), { target: { value: 'OnChanged' } })
    fireEvent.click(box('RTSpecialName'))
    open('Methods')
    fireEvent.click(clearButton('Add...'))

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(box('Add... method')).toHaveValue('add_Changed')
    open('Main')
    expect(box('Name')).toHaveValue('Changed')
    expect(box('SpecialName')).toBeChecked()
    expect(box('RTSpecialName')).not.toBeChecked()
  })
})
