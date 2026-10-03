import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeNode, TypeOptionsDto, TypeSigDto } from '../../../shared/protocol'
import { TypeOptionsDialog } from './TypeOptionsDialog'
import { TYPE_ATTRIBUTES, TYPE_KINDS } from './widgets/type-options'

const objectType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Object' }, valueType: false }
const valueType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ValueType' }, valueType: true }

const sample: TreeNode = { id: 'n1', label: 'Sample', kind: 'module', hasChildren: true, icon: 'assembly' }
const alpha: TreeNode = { id: 'n2', label: 'Alpha', kind: 'namespace', hasChildren: true }
const widget: TreeNode = { id: 'n4', label: 'Alpha.Widget', kind: 'type', hasChildren: false, icon: 'class' }
const disposableNode: TreeNode = { id: 'n5', label: 'Alpha.IThing', kind: 'type', hasChildren: false, icon: 'interface' }

const CHILDREN: Record<string, TreeNode[]> = {
  'ws:n1': [alpha],
  'ws:n2': [widget, disposableNode],
}

const getRoots = vi.fn(async () => ({ nodes: [sample] }))
const getChildren = vi.fn(async (_workspaceId: string, nodeId: string) => ({ nodes: CHILDREN[`ws:${nodeId}`] ?? [] }))

beforeEach(() => {
  getRoots.mockClear()
  getChildren.mockClear()
  vi.stubGlobal('dnSpy', { getRoots, getChildren })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const type = (patch: Partial<TypeOptionsDto> = {}): TypeOptionsDto => ({
  attributes: TYPE_ATTRIBUTES.Public,
  namespace: 'Alpha',
  name: 'MyType',
  baseType: objectType,
  customAttributes: [],
  declSecurities: [],
  genericParameters: [],
  interfaces: [],
  corlibScope: 'mscorlib',
  ...patch,
})

const renderDialog = (value = type(), isNew = true, nested = false, failure?: string): { accepted: TypeOptionsDto[], onCancel: () => void } => {
  const accepted: TypeOptionsDto[] = []
  const onCancel = vi.fn()
  render(<TypeOptionsDialog workspaceId="ws" value={value} isNew={isNew} nested={nested} failure={failure} onAccept={(next) => { accepted.push(next) }} onCancel={onCancel} />)
  return { accepted, onCancel }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const check = (label: string): HTMLInputElement => screen.getByRole('checkbox', { name: label }) as HTMLInputElement
const select = (label: string): HTMLSelectElement => screen.getByLabelText(label) as HTMLSelectElement
const options = (label: string): (string | undefined)[] => Array.from(select(label).options).map((option) => option.textContent)
const open = (tab: string): void => { fireEvent.click(screen.getByRole('tab', { name: tab })) }
const accept = (): void => { fireEvent.click(screen.getByRole('button', { name: 'OK' })) }
const okButton = (): HTMLElement => screen.getByRole('button', { name: 'OK' })
const kindOf = (label: string): string => TYPE_KINDS.find((entry) => entry.label === label)!.value.toString()

/** The one row a page's list holds, on the page opened first — every page of the window holds a list of
 * its own, and only the page being looked at is drawn. */
const rowOn = (tab: string): HTMLElement => {
  open(tab)
  return screen.getByRole('option')
}

describe('TypeOptionsDialog', () => {
  it('draws dnSpy\'s six pages in its order', () => {
    renderDialog()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Main', 'Base Type', 'Generic Params', 'Interfaces', 'Custom Attrs', 'Sec Decls'])
  })

  it('titles the same window for the command that opened it', () => {
    renderDialog(type(), true)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Type')

    cleanup()
    renderDialog(type(), true, true)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Create Nested Type')

    cleanup()
    renderDialog(type(), false)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Edit Type')
  })

  it('lays the Main page out the way the XAML does', () => {
    renderDialog()

    expect(box('Namespace')).toHaveValue('Alpha')
    expect(box('Name')).toHaveValue('MyType')
    expect(box('Packing Size')).toHaveValue('')
    expect(box('Class Size')).toHaveValue('')
    // The layout lives on the Main page: dnSpy has no page of its own for it.
    expect(screen.queryByRole('tab', { name: 'ClassLayout' })).toBeNull()

    expect(screen.getByRole('group').querySelector('legend')?.textContent).toBe('Flags')
    expect(Array.from(screen.getByRole('group').querySelectorAll('label')).map((label) => label.textContent))
      .toEqual(['Abstract', 'Sealed', 'Serializable', 'Import', 'SpecialName', 'RTSpecialName', 'WindowsRuntime', 'BeforeFieldInit', 'Forwarder'])
    // The security bit has no box: it follows what the type declares, and that is a page of its own.
    expect(screen.queryByRole('checkbox', { name: 'HasSecurity' })).toBeNull()

    expect(options('Kind')).toEqual(['Class', 'Delegate', 'Enum', 'Interface', 'StaticClass', 'Struct', 'Unknown'])
    // A top-level type's visibility is either of two, and the label says visibility rather than
    // accessibility, which is what a nested type's label says.
    expect(options('Visibility')).toEqual(['NotPublic', 'Public'])
    expect(options('Layout')).toEqual(['Auto', 'Sequential', 'Explicit'])
    expect(options('String')).toEqual(['Ansi', 'Unicode', 'Auto', 'CustomFormat'])
    expect(options('Semantics')).toEqual(['Class', 'Interface'])
    expect(options('Custom')).toEqual(['Value0', 'Value1', 'Value2', 'Value3'])
  })

  it('offers a nested type the six visibilities its accessibility can be', () => {
    renderDialog(type({ attributes: TYPE_ATTRIBUTES.NestedPublic }), true, true)
    expect(options('Accessibility')).toEqual(['Public', 'Private', 'Family', 'Assembly', 'Family and Assembly', 'Family or Assembly'])
    expect(select('Accessibility').value).toBe('2')
  })

  it('writes the type a kind stands for into the model as the kind is picked', () => {
    const { accepted } = renderDialog()

    fireEvent.change(select('Kind'), { target: { value: kindOf('Struct') } })
    expect(check('Sealed')).toBeChecked()
    expect(check('Abstract')).not.toBeChecked()

    open('Base Type')
    expect(screen.getByText('System.ValueType')).toBeTruthy()

    accept()
    expect(accepted[0].baseType).toEqual(valueType)
    expect(accepted[0].attributes & TYPE_ATTRIBUTES.ClassSemanticsMask).toBe(0)
    expect(accepted[0].attributes & TYPE_ATTRIBUTES.Sealed).toBe(TYPE_ATTRIBUTES.Sealed)
  })

  it('brings the kind back in step when it is the rest of the model that changed', () => {
    renderDialog()
    expect(select('Kind').value).toBe(kindOf('Class'))

    // Abstract and sealed over System.Object is dnSpy's static class, and the combo says so.
    fireEvent.click(check('Abstract'))
    fireEvent.click(check('Sealed'))
    expect(select('Kind').value).toBe(kindOf('StaticClass'))
  })

  it('takes a picked type for the base type, name and all', async () => {
    const { accepted } = renderDialog()
    open('Base Type')

    // Clear takes the base type back to nothing first, which is a legal type — an interface's base type
    // is nothing at all — and then the picker hands one back.
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    const picker = await screen.findByRole('dialog', { name: 'Pick a Type' })
    fireEvent.doubleClick(await within(picker).findByText('Alpha'))
    fireEvent.click(await within(picker).findByText('Alpha.IThing'))
    fireEvent.click(within(picker).getByRole('button', { name: 'OK' }))

    await waitFor(() => { expect(screen.getByText('Alpha.IThing')).toBeTruthy() })
    accept()
    // The node id is what the backend resolves it by, the namespace and name are what a lookup would
    // need if that no longer holds, and the scope is empty because the picker never left the module.
    expect(accepted[0].baseType?.type).toEqual({ scope: '', namespace: 'Alpha', name: 'IThing', nodeId: 'n5' })
  })

  it('holds OK down for a size that does not read, and for nothing else', () => {
    renderDialog()
    expect(okButton()).toBeEnabled()

    fireEvent.change(box('Packing Size'), { target: { value: '0x10000' } })
    expect(okButton()).toBeDisabled()
    // The size box has no complaint of its own to draw — dnSpy's shows one on the box's border — so the
    // reason stands where every dialog's does.
    expect(screen.getAllByText('Value must be between 0 and 65535 (0xFFFF) inclusive')).toHaveLength(1)

    fireEvent.change(box('Packing Size'), { target: { value: '8' } })
    expect(okButton()).toBeEnabled()

    // A type with no base type at all is an interface, so nothing else can hold the button down.
    open('Base Type')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(okButton()).toBeEnabled()
  })

  it('hands the whole model back with what every page was changed to', () => {
    const { accepted } = renderDialog(type({
      attributes: TYPE_ATTRIBUTES.Public | TYPE_ATTRIBUTES.Serializable | TYPE_ATTRIBUTES.SequentialLayout,
      genericParameters: [{ number: 0, flags: 0, name: 'T', constraints: [], customAttributes: [] }],
    }))

    fireEvent.change(box('Name'), { target: { value: 'Renamed' } })
    fireEvent.change(box('Namespace'), { target: { value: 'Beta' } })
    fireEvent.change(box('Packing Size'), { target: { value: '0x10' } })
    fireEvent.change(box('Class Size'), { target: { value: '32' } })
    fireEvent.click(check('Abstract'))
    fireEvent.change(box('Layout'), { target: { value: '2' } })
    fireEvent.change(box('String'), { target: { value: '3' } })
    fireEvent.change(box('Custom'), { target: { value: '1' } })

    accept()
    const written = accepted[0]
    expect(written.namespace).toBe('Beta')
    expect(written.name).toBe('Renamed')
    expect(written.packingSize).toBe(0x10)
    expect(written.classSize).toBe(32)
    // The rows the window has no page for travel through it untouched, which is what keeps an edit from
    // dropping them.
    expect(written.genericParameters).toEqual([{ number: 0, flags: 0, name: 'T', constraints: [], customAttributes: [] }])
    expect(written.attributes & TYPE_ATTRIBUTES.Abstract).toBe(TYPE_ATTRIBUTES.Abstract)
    expect(written.attributes & TYPE_ATTRIBUTES.Serializable).toBe(TYPE_ATTRIBUTES.Serializable)
    expect(written.attributes & TYPE_ATTRIBUTES.LayoutMask).toBe(TYPE_ATTRIBUTES.ExplicitLayout)
    expect(written.attributes & TYPE_ATTRIBUTES.StringFormatMask).toBe(TYPE_ATTRIBUTES.CustomFormatClass)
    expect(written.attributes & TYPE_ATTRIBUTES.CustomFormatMask).toBe(1 << 22)
  })

  it('puts every page back to what the window opened with', () => {
    const { accepted } = renderDialog()

    fireEvent.change(box('Name'), { target: { value: 'Renamed' } })
    fireEvent.change(select('Kind'), { target: { value: kindOf('Interface') } })
    fireEvent.click(check('Forwarder'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(box('Name')).toHaveValue('MyType')
    expect(check('Forwarder')).not.toBeChecked()
    expect(select('Kind').value).toBe(kindOf('Class'))

    accept()
    expect(accepted[0].name).toBe('MyType')
    expect(accepted[0].baseType).toEqual(objectType)
  })

  it('shows why the backend refused the write without losing the model', () => {
    renderDialog(type(), true, false, 'There is already a type with that name.')
    expect(screen.getByText('There is already a type with that name.')).toBeTruthy()
    expect(box('Name')).toHaveValue('MyType')
    expect(okButton()).toBeEnabled()
  })

  it('shows the four collections the type holds on their own pages, and writes them back', () => {
    const { accepted } = renderDialog(type({
      genericParameters: [{ number: 0, flags: 0, name: 'T', constraints: [], customAttributes: [] }],
      interfaces: [{ typeDefOrRef: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'IDisposable' } }, customAttributes: [] }],
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
      declSecurities: [{ action: 2, securityAttributes: [], customAttributes: [] }],
    }))

    // One row on each page, listed under the text dnSpy's row view model gives it.
    expect(rowOn('Generic Params')).toHaveTextContent('gparam(0) T')
    expect(rowOn('Interfaces')).toHaveTextContent('System.IDisposable')
    expect(rowOn('Custom Attrs')).toHaveTextContent('System.ObsoleteAttribute')
    expect(rowOn('Sec Decls')).toHaveTextContent('Demand')

    // And removing one there is what the window hands back, because the dialog rebuilds the whole list
    // rather than merging into it — a row the user removed has to go.
    for (const tab of ['Generic Params', 'Interfaces', 'Custom Attrs', 'Sec Decls']) {
      open(tab)
      fireEvent.click(screen.getByRole('option'))
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    }

    accept()
    expect(accepted[0].genericParameters).toEqual([])
    expect(accepted[0].interfaces).toEqual([])
    expect(accepted[0].customAttributes).toEqual([])
    expect(accepted[0].declSecurities).toEqual([])
  })

  it('adds a row through the page\'s own row dialogs', () => {
    const { accepted } = renderDialog()

    open('Generic Params')
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    // The row dialogs are dnSpy's, titles and all: a parameter's own window and the interface
    // implementation one, which is the same control a constraint is edited with.
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Create Generic Parameter' })).getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('option')).toHaveTextContent('gparam(0) <<no-name>>')

    open('Interfaces')
    fireEvent.click(screen.getByRole('button', { name: 'Add...' }))
    const picking = screen.getByRole('dialog', { name: 'Create Interface Impl' })
    fireEvent.click(within(picking).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryAllByRole('option')).toEqual([])

    accept()
    expect(accepted[0].genericParameters).toEqual([{ number: 0, flags: 0, name: '', constraints: [], customAttributes: [] }])
  })

  it('keeps the model in the window when it is cancelled', () => {
    const { accepted, onCancel } = renderDialog()
    fireEvent.change(box('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(accepted).toEqual([])
  })

  it('lets the base type editor use the type\'s own generic parameters, and no others', () => {
    // Var is the first button of an empty signature's row, so these are types with no base type yet.
    renderDialog(type({ baseType: undefined, typeGenericParameterCount: 1, genericParameters: [{ number: 0, flags: 0, name: 'T', constraints: [], customAttributes: [] }] }))
    open('Base Type')
    // A type with a generic parameter of its own can name it; one with none has nothing to name.
    expect(screen.getByRole('button', { name: 'Var' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'MVar' })).toBeDisabled()

    cleanup()
    renderDialog(type({ baseType: undefined, typeGenericParameterCount: 0 }))
    open('Base Type')
    expect(screen.getByRole('button', { name: 'Var' })).toBeDisabled()

    // And a type being created has not got any yet, so every Var is on offer — dnSpy hands the create
    // command no owner type at all.
    cleanup()
    renderDialog(type({ baseType: undefined, typeGenericParameterCount: undefined }), true)
    open('Base Type')
    expect(screen.getByRole('button', { name: 'Var' })).toBeEnabled()
  })
})
