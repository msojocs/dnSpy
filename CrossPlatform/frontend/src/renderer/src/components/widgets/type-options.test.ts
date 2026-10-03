import { describe, expect, it } from 'vitest'
import type { TypeOptionsDto, TypeSigDto } from '../../../../shared/protocol'
import { applyTypeKind, hasTypeFlag, initializeTypeKind, TYPE_ATTRIBUTES, TYPE_KINDS, typeKindOf, typeOptionsDraft, typeOptionsDto, typeOptionsError, typeVisibilities, withTypeFlag, withTypeLayout, withTypeSemantics } from './type-options'

// Every one of these carries its `valueType` the way the backend sends it, which is a flag rather than
// something left out when it is false.
const objectType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Object' }, valueType: false }
const valueType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ValueType' }, valueType: true }
const enumType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Enum' }, valueType: true }
const delegateType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'MulticastDelegate' }, valueType: false }

const kind = (label: string): number => TYPE_KINDS.find((entry) => entry.label === label)!.value

/** The word a plain public class is written with, which is what most of these start from. */
const classAttributes = TYPE_ATTRIBUTES.Public

const type = (patch: Partial<TypeOptionsDto> = {}): TypeOptionsDto => ({
  attributes: classAttributes,
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

describe('type options', () => {
  it('carries the whole model across and back, so an edit cannot drop a row it does not show', () => {
    const value = type({
      attributes: TYPE_ATTRIBUTES.Public | TYPE_ATTRIBUTES.SequentialLayout | TYPE_ATTRIBUTES.Interface |
        TYPE_ATTRIBUTES.UnicodeClass | (3 << 22) | TYPE_ATTRIBUTES.Abstract | TYPE_ATTRIBUTES.Sealed |
        TYPE_ATTRIBUTES.SpecialName | TYPE_ATTRIBUTES.RTSpecialName | TYPE_ATTRIBUTES.Import |
        TYPE_ATTRIBUTES.Serializable | TYPE_ATTRIBUTES.WindowsRuntime | TYPE_ATTRIBUTES.BeforeFieldInit |
        TYPE_ATTRIBUTES.Forwarder | TYPE_ATTRIBUTES.HasSecurity,
      packingSize: 8,
      classSize: 0x40,
      declSecurities: [{ action: 2, securityAttributes: [], customAttributes: [] }],
      genericParameters: [{ number: 0, flags: 0, name: 'T', constraints: [], customAttributes: [] }],
      interfaces: [{ typeDefOrRef: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'IDisposable' } }, customAttributes: [] }],
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
    })

    // The two fields no page edits — how many generic parameters the type has and which assembly is the
    // corlib — are read-only context, so the model that goes back does not carry them.
    const { corlibScope, ...rest } = value
    expect(corlibScope).toBe('mscorlib')
    expect(typeOptionsDto(typeOptionsDraft(value))).toEqual(rest)
  })

  it('opens with every flag the word holds, and writes them back as they are', () => {
    const value = type({
      attributes: classAttributes | TYPE_ATTRIBUTES.Abstract | TYPE_ATTRIBUTES.Serializable |
        TYPE_ATTRIBUTES.SpecialName | TYPE_ATTRIBUTES.RTSpecialName | TYPE_ATTRIBUTES.Import |
        TYPE_ATTRIBUTES.WindowsRuntime | TYPE_ATTRIBUTES.BeforeFieldInit | TYPE_ATTRIBUTES.Forwarder,
    })
    const draft = typeOptionsDraft(value)
    for (const flag of [TYPE_ATTRIBUTES.Abstract, TYPE_ATTRIBUTES.Serializable, TYPE_ATTRIBUTES.SpecialName,
      TYPE_ATTRIBUTES.RTSpecialName, TYPE_ATTRIBUTES.Import, TYPE_ATTRIBUTES.WindowsRuntime,
      TYPE_ATTRIBUTES.BeforeFieldInit, TYPE_ATTRIBUTES.Forwarder])
      expect(hasTypeFlag(draft.attributes, flag), `flag ${flag.toString(16)}`).toBe(true)
    expect(hasTypeFlag(draft.attributes, TYPE_ATTRIBUTES.Sealed)).toBe(false)

    // Turning one off leaves the rest exactly where they were.
    const edited = { ...draft, attributes: withTypeFlag(draft.attributes, TYPE_ATTRIBUTES.Serializable, false) }
    expect(typeOptionsDto(edited).attributes).toBe(value.attributes & ~TYPE_ATTRIBUTES.Serializable)
  })

  it('reads the kind out of the base type, the layout, the semantics and the two flags', () => {
    const cases: { label: string, value: TypeOptionsDto }[] = [
      { label: 'Class', value: type() },
      {
        label: 'StaticClass',
        value: type({ attributes: classAttributes | TYPE_ATTRIBUTES.Abstract | TYPE_ATTRIBUTES.Sealed }),
      },
      {
        label: 'Interface',
        value: type({
          attributes: TYPE_ATTRIBUTES.Public | TYPE_ATTRIBUTES.Interface | TYPE_ATTRIBUTES.Abstract,
          baseType: undefined,
        }),
      },
      { label: 'Struct', value: type({ attributes: classAttributes | TYPE_ATTRIBUTES.Sealed, baseType: valueType }) },
      { label: 'Enum', value: type({ attributes: classAttributes | TYPE_ATTRIBUTES.Sealed, baseType: enumType }) },
      { label: 'Delegate', value: type({ attributes: classAttributes | TYPE_ATTRIBUTES.Sealed, baseType: delegateType }) },
      // A class base type that is also sealed and abstract is not a static class: dnSpy's static class is
      // System.Object's, and nothing else's.
      { label: 'Class', value: type({ baseType: { kind: 'type', type: { scope: 'Alpha', namespace: 'Alpha', name: 'Base' } }, attributes: classAttributes | TYPE_ATTRIBUTES.Abstract | TYPE_ATTRIBUTES.Sealed }) },
      // An interface's base type is nothing at all, so the same flags over a base type are a class.
      { label: 'Class', value: type({ attributes: classAttributes | TYPE_ATTRIBUTES.Abstract }) },
      { label: 'Unknown', value: type({ attributes: TYPE_ATTRIBUTES.Public | TYPE_ATTRIBUTES.Interface, baseType: undefined }) },
    ]

    for (const entry of cases)
      expect(typeKindOf(typeOptionsDraft(entry.value)), `for ${entry.label}`).toBe(kind(entry.label))
  })

  it('takes System.Object for the corlib\'s only when the scope says it came from there', () => {
    // A type of one's own is a class, not a static one, however it is named and spelled.
    const own = type({
      attributes: classAttributes | TYPE_ATTRIBUTES.Abstract | TYPE_ATTRIBUTES.Sealed,
      baseType: { kind: 'type', type: { scope: 'Alpha', namespace: 'System', name: 'Object' } },
    })
    expect(typeKindOf(typeOptionsDraft(own))).toBe(kind('Class'))
    expect(typeKindOf(typeOptionsDraft(type({ attributes: classAttributes | TYPE_ATTRIBUTES.Abstract | TYPE_ATTRIBUTES.Sealed })))).toBe(kind('StaticClass'))
  })

  it('writes the base type, the layout, the semantics and the flags a kind is', () => {
    const start = typeOptionsDraft(type({ attributes: classAttributes | TYPE_ATTRIBUTES.SequentialLayout | TYPE_ATTRIBUTES.Abstract }))

    const struct = applyTypeKind(start, kind('Struct'))
    expect(struct.kind).toBe(kind('Struct'))
    expect(struct.baseType).toEqual(valueType)
    // A struct keeps whatever layout it had: only a kind whose layout is part of what it is writes one.
    expect(struct.attributes & TYPE_ATTRIBUTES.LayoutMask).toBe(TYPE_ATTRIBUTES.SequentialLayout)
    expect(hasTypeFlag(struct.attributes, TYPE_ATTRIBUTES.Abstract)).toBe(false)
    expect(hasTypeFlag(struct.attributes, TYPE_ATTRIBUTES.Sealed)).toBe(true)

    const iface = applyTypeKind(start, kind('Interface'))
    expect(iface.baseType).toBeUndefined()
    expect(iface.attributes & TYPE_ATTRIBUTES.LayoutMask).toBe(0)
    expect(iface.attributes & TYPE_ATTRIBUTES.ClassSemanticsMask).toBe(TYPE_ATTRIBUTES.Interface)
    expect(hasTypeFlag(iface.attributes, TYPE_ATTRIBUTES.Abstract)).toBe(true)
    expect(hasTypeFlag(iface.attributes, TYPE_ATTRIBUTES.Sealed)).toBe(false)

    const staticClass = applyTypeKind(start, kind('StaticClass'))
    expect(staticClass.baseType).toEqual(objectType)
    expect(hasTypeFlag(staticClass.attributes, TYPE_ATTRIBUTES.Abstract)).toBe(true)
    expect(hasTypeFlag(staticClass.attributes, TYPE_ATTRIBUTES.Sealed)).toBe(true)

    const delegate = applyTypeKind(start, kind('Delegate'))
    expect(delegate.baseType).toEqual(delegateType)
    expect(delegate.attributes & TYPE_ATTRIBUTES.LayoutMask).toBe(0)

    // A class keeps the base type it had — dnSpy only replaces one that cannot be a class's.
    const kept = applyTypeKind({ ...start, baseType: { kind: 'type', type: { scope: 'Alpha', namespace: 'Alpha', name: 'Base' } } }, kind('Class'))
    expect(kept.baseType).toEqual({ kind: 'type', type: { scope: 'Alpha', namespace: 'Alpha', name: 'Base' } })
    const replaced = applyTypeKind({ ...start, baseType: enumType }, kind('Class'))
    expect(replaced.baseType).toEqual(objectType)
  })

  it('brings the kind back in step with the flags, the layout, the semantics and the base type', () => {
    // What the dialog does after each of those four edits, and deliberately not after the others.
    const draft = typeOptionsDraft(type())
    const sealedOff = initializeTypeKind({ ...draft, attributes: withTypeFlag(draft.attributes, TYPE_ATTRIBUTES.Sealed, true) })
    expect(sealedOff.kind).toBe(kind('Class'))

    const abstractAndSealed = initializeTypeKind({
      ...draft,
      attributes: withTypeFlag(withTypeFlag(draft.attributes, TYPE_ATTRIBUTES.Abstract, true), TYPE_ATTRIBUTES.Sealed, true),
    })
    expect(abstractAndSealed.kind).toBe(kind('StaticClass'))

    const asInterface = initializeTypeKind({ ...draft, baseType: undefined, attributes: withTypeSemantics(withTypeLayout(draft.attributes, 0), 1) | TYPE_ATTRIBUTES.Abstract })
    expect(asInterface.kind).toBe(kind('Interface'))
  })

  it('offers only the visibilities a type\'s nesting allows', () => {
    expect(typeVisibilities(false).map((entry) => entry.label)).toEqual(['NotPublic', 'Public'])
    // A nested type's visibility is an accessibility, and it says so: its four entries are named the way
    // the metadata names the access they stand for.
    expect(typeVisibilities(true).map((entry) => entry.label)).toEqual(['Public', 'Private', 'Family', 'Assembly', 'Family and Assembly', 'Family or Assembly'])
    expect(typeVisibilities(true).map((entry) => entry.value)).toEqual([2, 3, 4, 5, 6, 7])
  })

  it('keeps a nested type\'s visibility out of the combo a top-level one is offered', () => {
    // A row that came in nested opens on one of the six; the two a top-level type has are the other half.
    const nested = typeOptionsDraft(type({ attributes: TYPE_ATTRIBUTES.NestedFamily }))
    expect(nested.isNested).toBe(true)
    expect(nested.attributes & TYPE_ATTRIBUTES.VisibilityMask).toBe(TYPE_ATTRIBUTES.NestedFamily)
    expect(typeOptionsDto(nested).attributes & TYPE_ATTRIBUTES.VisibilityMask).toBe(TYPE_ATTRIBUTES.NestedFamily)
  })

  it('reads the two sizes as boxes: an empty one is no class layout, and one that does not read is an error', () => {
    const empty = typeOptionsDraft(type())
    expect(empty.packingSize).toBe('')
    expect(empty.classSize).toBe('')
    // Both absent is the type having no layout row at all, which is what the backend writes as nothing.
    expect(typeOptionsDto(empty).packingSize).toBeUndefined()
    expect(typeOptionsDto(empty).classSize).toBeUndefined()
    expect(typeOptionsError(empty)).toBeUndefined()

    const sized = typeOptionsDraft(type({ packingSize: 8, classSize: 0x40 }))
    expect(sized.packingSize).toBe('8')
    // A value dnSpy's converter prints as hex, because it is not one of the round decimal numbers it
    // writes as they are.
    expect(typeOptionsDraft(type({ classSize: 4095 })).classSize).toBe('0xFFF')
    expect(typeOptionsDto(sized).packingSize).toBe(8)
    expect(typeOptionsDto(sized).classSize).toBe(0x40)

    const tooBig = { ...sized, packingSize: '0x10000' }
    expect(typeOptionsError(tooBig)?.template).toBe('Value must be between {min} and {max} (0x{maxHex}) inclusive')
    expect(typeOptionsError(tooBig)?.args).toEqual({ min: '0', max: '65535', maxHex: 'FFFF' })
    expect(typeOptionsError({ ...sized, classSize: 'x' })?.template).toBe('The value is not an unsigned hexadecimal or decimal integer')
  })

  it('derives the security bit from what the type declares rather than from the word', () => {
    // A word that claims the bit with nothing behind it loses it, which is what dnSpy's CopyTo does.
    const claimed = type({ attributes: classAttributes | TYPE_ATTRIBUTES.HasSecurity })
    expect(hasTypeFlag(typeOptionsDto(typeOptionsDraft(claimed)).attributes, TYPE_ATTRIBUTES.HasSecurity)).toBe(false)

    const declared = type({ declSecurities: [{ action: 2, securityAttributes: [], customAttributes: [] }] })
    expect(hasTypeFlag(typeOptionsDto(typeOptionsDraft(declared)).attributes, TYPE_ATTRIBUTES.HasSecurity)).toBe(true)

    // The one attribute that is a security declaration in this form is the bit's other source.
    const suppressed = type({
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System.Security', name: 'SuppressUnmanagedCodeSecurityAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
    })
    expect(hasTypeFlag(typeOptionsDto(typeOptionsDraft(suppressed)).attributes, TYPE_ATTRIBUTES.HasSecurity)).toBe(true)

    // Any other attribute is not one, however it is named.
    const other = type({
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
    })
    expect(hasTypeFlag(typeOptionsDto(typeOptionsDraft(other)).attributes, TYPE_ATTRIBUTES.HasSecurity)).toBe(false)
  })
})
