import { describe, expect, it } from 'vitest'
import type { MethodOptionsDto, TypeSigDto } from '../../../../shared/protocol'
import {
  CODE_TYPES,
  IMPL_FLAGS,
  MANAGED_TYPES,
  METHOD_ACCESSES,
  METHOD_ATTRIBUTES,
  METHOD_FLAGS,
  METHOD_IMPL_ATTRIBUTES,
  VTABLE_LAYOUTS,
  managedTypeOf,
  methodAccessOf,
  methodOptionsDraft,
  methodOptionsDto,
  methodOptionsError,
  vtableLayoutOf,
  withCodeType,
  withManagedType,
  withMethodAccess,
  withVtableLayout,
} from './method-options'
import { PARAM_ATTRIBUTES } from './param-def'

/** The access bits have no named members of their own — the combo reads them out of the table, and the
 * dialog only ever writes the masked part back — so the test reads them from the same place. */
const access = (label: string): number => METHOD_ACCESSES.find((entry) => entry.label === label)!.value

const voidType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Void' } }
const intType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Int32' }, valueType: true }

const method = (patch: Partial<MethodOptionsDto> = {}): MethodOptionsDto => ({
  implAttributes: METHOD_IMPL_ATTRIBUTES.NoInlining,
  attributes: access('Public') | METHOD_ATTRIBUTES.HideBySig | METHOD_ATTRIBUTES.NewSlot,
  semanticsAttributes: 0,
  name: 'Reset',
  methodSig: { callingConvention: 0x20, returnType: voidType, parameters: [intType], genericParameterCount: 0 },
  customAttributes: [],
  declSecurities: [],
  paramDefs: [],
  genericParameters: [],
  overrides: [],
  rva: 0x1234,
  ...patch,
})

const suppressUnmanagedCode: MethodOptionsDto['customAttributes'] = [{
  constructor: {
    declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System.Security', name: 'SuppressUnmanagedCodeSecurityAttribute' } },
    name: '.ctor',
    signature: { callingConvention: 0x20, returnType: voidType, parameters: [] },
  },
  constructorArguments: [],
  namedArguments: [],
}]

describe('method options', () => {
  it('carries the whole model across and back, so an edit cannot drop a field it does not show', () => {
    const value = method({
      paramDefs: [{ name: 'count', sequence: 1, attributes: 0, constant: { elementType: 8, value: '3' }, customAttributes: [] }],
      genericParameters: [{ number: 0, flags: 0, name: 'T', constraints: [], customAttributes: [] }],
      declSecurities: [{ action: 2, customAttributes: [], securityAttributes: [] }],
      overrides: [{
        methodBody: { declaringType: { kind: 'type', type: { scope: '', namespace: 'N', name: 'A' } }, name: 'Reset', signature: { callingConvention: 0x20, returnType: voidType, parameters: [] } },
        methodDeclaration: { declaringType: { kind: 'type', type: { scope: '', namespace: 'N', name: 'B' } }, name: 'Reset', signature: { callingConvention: 0x20, returnType: voidType, parameters: [] } },
      }],
    })

    expect(methodOptionsDto(methodOptionsDraft(value))).toEqual({
      ...value,
      // Two bits are derived rather than carried, both at the point dnSpy writes the model out: the
      // security bit a security row demands, and the default-value bit a constant goes with.
      attributes: value.attributes | METHOD_ATTRIBUTES.HasSecurity,
      paramDefs: (value.paramDefs ?? []).map((parameter) => ({ ...parameter, attributes: parameter.attributes | PARAM_ATTRIBUTES.HasDefault })),
    })
  })

  it('keeps the two words nothing on the Main page edits', () => {
    // The semantics a property's accessor carries and the row id the codec writes are not on any page,
    // so they have to come back out of the dialog exactly as they went in.
    const draft = methodOptionsDraft(method({ semanticsAttributes: 0x2, rva: 0x0badf00d }))
    expect(methodOptionsDto(draft).semanticsAttributes).toBe(0x2)
    expect(methodOptionsDto(draft).rva).toBe(0x0badf00d)
  })

  it('reads the owner type\'s generic parameter count but does not write it back', () => {
    // It is context for the signature editor, not part of the model: the backend knows it whenever it
    // needs it, and a value sent back would only be something to keep in step.
    const draft = methodOptionsDraft(method({ ownerGenericParameterCount: 2 }))
    expect(draft.ownerGenericParameterCount).toBe(2)
    expect(methodOptionsDto(draft).ownerGenericParameterCount).toBeUndefined()
  })

  it('derives the security bit from the rows and attributes when the model is handed over', () => {
    const bare = methodOptionsDraft(method())
    expect(methodOptionsDto(bare).attributes & METHOD_ATTRIBUTES.HasSecurity).toBe(0)

    const withRow = methodOptionsDraft(method({ declSecurities: [{ action: 2, customAttributes: [], securityAttributes: [] }] }))
    expect(methodOptionsDto(withRow).attributes & METHOD_ATTRIBUTES.HasSecurity).toBe(METHOD_ATTRIBUTES.HasSecurity)

    // The one attribute that asks for the bit on its own, which dnSpy knows by its full name.
    const withAttribute = methodOptionsDraft(method({ customAttributes: suppressUnmanagedCode }))
    expect(methodOptionsDto(withAttribute).attributes & METHOD_ATTRIBUTES.HasSecurity).toBe(METHOD_ATTRIBUTES.HasSecurity)
  })

  it('clears the security bit again when the last row is removed', () => {
    const draft = methodOptionsDraft(method({
      attributes: access('Public') | METHOD_ATTRIBUTES.HasSecurity,
      declSecurities: [{ action: 2, customAttributes: [], securityAttributes: [] }],
    }))
    expect(methodOptionsDto(draft).attributes & METHOD_ATTRIBUTES.HasSecurity).toBe(METHOD_ATTRIBUTES.HasSecurity)
    expect(methodOptionsDto({ ...draft, declSecurities: [] }).attributes & METHOD_ATTRIBUTES.HasSecurity).toBe(0)
  })

  it('does not set the security bit for any other attribute', () => {
    const draft = methodOptionsDraft(method({ customAttributes: [{ ...suppressUnmanagedCode[0], constructor: { ...suppressUnmanagedCode[0].constructor, declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } } } }] }))
    expect(methodOptionsDto(draft).attributes & METHOD_ATTRIBUTES.HasSecurity).toBe(0)
  })

  it('writes each combo into its own bits and leaves the rest of the word alone', () => {
    const impl = METHOD_IMPL_ATTRIBUTES.NoInlining | METHOD_IMPL_ATTRIBUTES.AggressiveOptimization | 4
    expect(withCodeType(impl, 2)).toBe(impl | 2)
    expect(withCodeType(impl, 0)).toBe(impl & ~3)
    expect(managedTypeOf(withManagedType(impl, 0))).toBe(0)
    expect(withManagedType(impl, 0) & METHOD_IMPL_ATTRIBUTES.NoInlining).toBe(METHOD_IMPL_ATTRIBUTES.NoInlining)

    const attributes = access('Public') | METHOD_ATTRIBUTES.Static | METHOD_ATTRIBUTES.NewSlot
    expect(methodAccessOf(withMethodAccess(attributes, 3))).toBe(3)
    expect(withMethodAccess(attributes, 3) & METHOD_ATTRIBUTES.Static).toBe(METHOD_ATTRIBUTES.Static)
    expect(vtableLayoutOf(withVtableLayout(attributes, 0))).toBe(0)
    expect(withVtableLayout(attributes, 0) & METHOD_ATTRIBUTES.MemberAccessMask).toBe(access('Public'))
  })

  it('offers the combos in the order dnSpy builds them, which is the enum sorted by name', () => {
    expect(CODE_TYPES.map((entry) => entry.label)).toEqual(['IL', 'Native', 'OPTIL', 'Runtime'])
    expect(MANAGED_TYPES.map((entry) => entry.label)).toEqual(['Managed', 'Unmanaged'])
    expect(METHOD_ACCESSES.map((entry) => entry.label)).toEqual(['Assembly', 'FamANDAssem', 'Family', 'FamORAssem', 'Private', 'PrivateScope', 'Public'])
    expect(VTABLE_LAYOUTS.map((entry) => entry.label)).toEqual(['NewSlot', 'ReuseSlot'])
  })

  it('lays the two flag group boxes out in the order the XAML does', () => {
    expect(IMPL_FLAGS.map((entry) => entry.label)).toEqual([
      'ForwardRef', 'PreserveSig', 'InternalCall',
      'Synchronized', 'NoInlining', 'AggressiveInlining',
      'NoOptimization', 'AggressiveOptimization', 'SecurityMitigations',
    ])
    expect(METHOD_FLAGS.map((entry) => entry.label)).toEqual([
      'Static', 'Final', 'Virtual',
      'HideBySig', 'CheckAccessOnOverride', 'Abstract',
      'SpecialName', 'RTSpecialName', 'UnmanagedExport',
      'RequireSecObject',
    ])
    // Neither of the two flags the dialog has no checkbox for is in a group — both are derived.
    expect(METHOD_FLAGS.map((entry) => entry.flag)).not.toContain(METHOD_ATTRIBUTES.PinvokeImpl)
    expect(METHOD_FLAGS.map((entry) => entry.flag)).not.toContain(METHOD_ATTRIBUTES.HasSecurity)
  })

  it('refuses a signature that is not whole and a P/Invoke with no library', () => {
    expect(methodOptionsError(methodOptionsDraft(method()))).toBeUndefined()

    const halfSig = methodOptionsDraft(method({ methodSig: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } }))
    expect(methodOptionsError(halfSig)?.template).toBe('The method signature is incomplete')

    const noSig = methodOptionsDraft(method({ methodSig: undefined }))
    expect(methodOptionsError(noSig)?.template).toBe('The method signature is incomplete')

    const emptyParameter = methodOptionsDraft(method({ methodSig: { callingConvention: 0x20, returnType: voidType, parameters: [{ kind: 'empty' }] } }))
    expect(methodOptionsError(emptyParameter)?.template).toBe('The method signature is incomplete')

    const pinvoke = methodOptionsDraft(method({ implMap: { attributes: 0, name: 'reset', moduleName: '' } }))
    expect(methodOptionsError(pinvoke)?.template).toBe('A P/Invoke method needs the name of the native library it calls into.')
    expect(methodOptionsError({ ...pinvoke, implMap: { attributes: 0, name: 'reset', moduleName: 'kernel32' } })).toBeUndefined()
  })
})
