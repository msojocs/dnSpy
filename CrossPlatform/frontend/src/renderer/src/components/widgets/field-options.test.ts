import { describe, expect, it } from 'vitest'
import type { FieldOptionsDto, TypeSigDto } from '../../../../shared/protocol'
import { FIELD_ACCESSES, FIELD_ATTRIBUTES, FIELD_FLAGS, fieldAccessOf, fieldAttributesOf, fieldOptionsDraft, fieldOptionsDto, fieldOptionsError, withFieldAccess, withFieldFlag } from './field-options'
import { NATIVE_TYPE } from './marshal-type'

const intType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Int32' }, valueType: true }

/** The access bits have no named members of their own — the combo reads them out of the table — so the
 * test reads them from the same place. */
const access = (label: string): number => FIELD_ACCESSES.find((entry) => entry.label === label)!.value

const field = (patch: Partial<FieldOptionsDto> = {}): FieldOptionsDto => ({
  attributes: access('Public') | FIELD_ATTRIBUTES.Static,
  name: 'Count',
  fieldSig: intType,
  customAttributes: [],
  rva: 0,
  ...patch,
})

describe('field options', () => {
  it('carries the whole model across and back, so an edit cannot drop a field it does not show', () => {
    const value = field({
      fieldOffset: 0x10,
      marshalType: { nativeType: NATIVE_TYPE.FixedSysString, size: 8 },
      initialValue: btoa('\x01\x02\xff'),
      implMap: { attributes: 0, name: 'MessageBoxW', moduleName: 'user32.dll' },
      constant: { elementType: 0x08, value: '3' },
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
      rva: 0x1234,
    })

    expect(fieldOptionsDto(fieldOptionsDraft(value))).toEqual({
      ...value,
      // The four bits a value stands for are derived at the point dnSpy writes them out, which is what
      // the dialog does as it hands the model over.
      attributes: value.attributes |
        FIELD_ATTRIBUTES.HasFieldMarshal | FIELD_ATTRIBUTES.HasFieldRVA |
        FIELD_ATTRIBUTES.PinvokeImpl | FIELD_ATTRIBUTES.HasDefault,
    })
  })

  it('keeps an initial value of no bytes rather than reading it as no initial value', () => {
    // An empty byte string is still a field RVA, which is why the bit is a box of its own.
    const draft = fieldOptionsDraft(field({ attributes: FIELD_ATTRIBUTES.HasFieldRVA, initialValue: '' }))
    expect(draft.hasFieldRVA).toBe(true)
    expect(draft.initialValue).toBe('')

    const written = fieldOptionsDto(draft)
    expect(written.initialValue).toBe('')
    expect(written.attributes & FIELD_ATTRIBUTES.HasFieldRVA).toBe(FIELD_ATTRIBUTES.HasFieldRVA)
  })

  it('drops the fields an attribute bit is missing for, the way dnSpy\'s CopyTo does', () => {
    // A row whose word says HasDefault but that carries no constant opens with the checkbox off, and the
    // value it has is not written; the same for the marshalling, the RVA and the P/Invoke row.
    const draft = fieldOptionsDraft(field({
      attributes: FIELD_ATTRIBUTES.HasDefault | FIELD_ATTRIBUTES.HasFieldMarshal | FIELD_ATTRIBUTES.HasFieldRVA | FIELD_ATTRIBUTES.PinvokeImpl,
    }))
    expect(draft.constant).toBeNull()
    expect(draft.marshalType).toBeUndefined()
    expect(draft.hasFieldRVA).toBe(false)
    expect(draft.initialValue).toBe('')
    expect(draft.implMap).toBeUndefined()
    expect(fieldAttributesOf(draft)).toBe(draft.attributes & ~(
      FIELD_ATTRIBUTES.HasDefault | FIELD_ATTRIBUTES.HasFieldMarshal | FIELD_ATTRIBUTES.HasFieldRVA | FIELD_ATTRIBUTES.PinvokeImpl
    ))
  })

  it('reads the three boxes back, and takes an empty offset as no offset at all', () => {
    const draft = fieldOptionsDraft(field({ fieldOffset: undefined, rva: 0x1F }))
    expect(draft.fieldOffset).toBe('')
    expect(draft.rva).toBe('0x1F')
    expect(fieldOptionsDto(draft).fieldOffset).toBeUndefined()

    const typed = { ...draft, fieldOffset: '0x20', rva: '4096', initialValue: '0102FF', hasFieldRVA: true }
    const written = fieldOptionsDto(typed)
    expect(written.fieldOffset).toBe(0x20)
    expect(written.rva).toBe(4096)
    expect(written.initialValue).toBe(btoa('\x01\x02\xff'))
  })

  it('writes the access combo into its own bits and leaves the rest of the word alone', () => {
    const attributes = access('Public') | FIELD_ATTRIBUTES.Static | FIELD_ATTRIBUTES.InitOnly
    expect(fieldAccessOf(attributes)).toBe(access('Public'))
    expect(withFieldAccess(attributes, access('Assembly'))).toBe((attributes & ~FIELD_ATTRIBUTES.FieldAccessMask) | access('Assembly'))
    expect(withFieldAccess(attributes, 0) & FIELD_ATTRIBUTES.Static).toBe(FIELD_ATTRIBUTES.Static)
  })

  it('offers the access combo in the order dnSpy\'s enum sorts into', () => {
    expect(FIELD_ACCESSES.map((entry) => entry.label))
      .toEqual(['Assembly', 'FamANDAssem', 'Family', 'FamORAssem', 'Private', 'PrivateScope', 'Public'])
  })

  it('lays the Flags box out the way the XAML does, and leaves the derived bits out of it', () => {
    expect(FIELD_FLAGS.map((entry) => entry.label))
      .toEqual(['Static', 'InitOnly', 'Literal', 'NotSerialized', 'SpecialName', 'RTSpecialName'])
    const flags = FIELD_FLAGS.map((entry) => entry.flag)
    for (const derived of [FIELD_ATTRIBUTES.HasFieldMarshal, FIELD_ATTRIBUTES.HasDefault, FIELD_ATTRIBUTES.PinvokeImpl, FIELD_ATTRIBUTES.HasFieldRVA])
      expect(flags).not.toContain(derived)
  })

  it('turns each flag box into its own bit', () => {
    const draft = fieldOptionsDraft(field())
    expect(withFieldFlag(draft.attributes, FIELD_ATTRIBUTES.InitOnly, true) & FIELD_ATTRIBUTES.InitOnly).toBe(FIELD_ATTRIBUTES.InitOnly)
    expect(withFieldFlag(draft.attributes, FIELD_ATTRIBUTES.Static, false) & FIELD_ATTRIBUTES.Static).toBe(0)
  })

  it('refuses a field with no type, which is the one thing the dialog cannot write without', () => {
    expect(fieldOptionsError(fieldOptionsDraft(field()))).toBeUndefined()
    expect(fieldOptionsError(fieldOptionsDraft(field({ fieldSig: undefined })))?.template).toBe('A type is required')
    expect(fieldOptionsError(fieldOptionsDraft(field({ fieldSig: { kind: 'empty' } })))?.template).toBe('A type is required')
  })

  it('refuses a box that does not read, and says which one', () => {
    const draft = fieldOptionsDraft(field())

    expect(fieldOptionsError({ ...draft, constant: { elementType: 0x08, value: 'x' } })?.template).toBe("'{text}' is not a valid {name}")
    expect(fieldOptionsError({ ...draft, fieldOffset: 'x' })?.template).toBe('The value is not an unsigned hexadecimal or decimal integer')
    expect(fieldOptionsError({ ...draft, rva: '' })?.template).toBe('The value is not an unsigned hexadecimal or decimal integer')
    expect(fieldOptionsError({ ...draft, rva: '0x100000000' })?.template).toBe('Value must be between {min} and {max} (0x{maxHex}) inclusive')
    // An empty offset is a field with no offset, not a number that went missing.
    expect(fieldOptionsError({ ...draft, fieldOffset: '' })).toBeUndefined()
  })

  it('refuses an initial value that is not a string of bytes, but only while the field has one', () => {
    const draft = { ...fieldOptionsDraft(field()), hasFieldRVA: true, initialValue: '01 02' }
    expect(fieldOptionsError(draft)?.template).toBe('The initial value is not a string of hexadecimal bytes')
    expect(fieldOptionsError({ ...draft, hasFieldRVA: false })).toBeUndefined()
    expect(fieldOptionsError({ ...draft, initialValue: '' })).toBeUndefined()
  })

  it('refuses a marshal type that is only half built', () => {
    const draft = { ...fieldOptionsDraft(field()), marshalType: { nativeType: NATIVE_TYPE.SafeArray, userDefinedSubType: { kind: 'empty' } satisfies TypeSigDto } }
    expect(fieldOptionsError(draft)?.template).toBe('A type is required')
  })
})
