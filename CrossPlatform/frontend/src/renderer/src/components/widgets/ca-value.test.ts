import { describe, expect, it } from 'vitest'
import type { CaArgumentDto, CaValueDto, TypeSigDto } from '../../../../shared/protocol'
import {
  CA_ENUM, CA_NULL, CA_OBJECT, CA_TYPE,
  caArgumentDisplay, caArgumentError, caArgumentText, caArrayIsNull, caArrayText, caBoxedArgument,
  caDefaultArgument, caDefaultForType, caKindList, caKindOf, caSetArrayNull, caSetArrayText,
  caSetBoxedArgument, caSetText, corlibSig, szArraySig, systemObjectSig, systemTypeSig,
} from './ca-value'

const argument = (type: TypeSigDto, value: CaValueDto): CaArgumentDto => ({ type, value })
const primitive = (text: string, elementType: number): CaValueDto => ({ kind: 'primitive', primitive: text, elementType })

/** A type the backend would read as an enum, which is any named type outside the corlib. */
const enumSig = (name = 'Colour'): TypeSigDto => ({ kind: 'type', type: { scope: '', namespace: 'Alpha', name }, valueType: true })

describe('caKindOf', () => {
  it('reads the kind out of the declared type when it names one', () => {
    expect(caKindOf(argument(corlibSig('Int32', true), primitive('1', 0x08)))).toBe('Int32')
    expect(caKindOf(argument(corlibSig('String', false), { kind: 'null' }))).toBe('String')
    expect(caKindOf(argument(systemTypeSig(), { kind: 'type' }))).toBe(CA_TYPE)
    expect(caKindOf(argument(enumSig(), primitive('1', 0x08)))).toBe(CA_ENUM)
    expect(caKindOf(argument(szArraySig(corlibSig('Int32', true)), { kind: 'array', elements: [] }))).toBe('Int32[]')
  })

  it('falls back to the value where the declared type leaves the question open', () => {
    // `System.Object` decides nothing — what the value holds is what is shown, as dnSpy's own
    // `ConvertFromModel` leaves it.
    expect(caKindOf(argument(systemObjectSig(), primitive('1', 0x08)))).toBe('Int32')
    expect(caKindOf(argument(systemObjectSig(), { kind: 'string', text: 'x' }))).toBe('String')
    expect(caKindOf(argument(systemObjectSig(), { kind: 'type' }))).toBe(CA_TYPE)
  })

  it('reports nothing held as null for a constructor argument and object for a named one', () => {
    const empty = argument(systemObjectSig(), { kind: 'null' })
    expect(caKindOf(empty)).toBe(CA_NULL)
    expect(caKindOf(empty, false)).toBe(CA_OBJECT)
  })

  it('lists the kinds dnSpy lists, in its order', () => {
    expect(caKindList(true).slice(0, 3)).toEqual([CA_NULL, 'Boolean', 'Char'])
    expect(caKindList(false).slice(0, 3)).toEqual([CA_OBJECT, 'Boolean', 'Char'])
    // The arrays come last, and in the order dnSpy's `validTypes` lists them.
    expect(caKindList(true).slice(-4)).toEqual(['Double[]', 'String[]', 'Enum[]', 'Type[]'])
    expect(caKindList(true)).toContain('Object[]')
    expect(caKindList(true)).not.toContain('Object')
  })
})

describe('caDefaultArgument', () => {
  it('starts every kind where ModelUtils.GetDefaultValue starts it', () => {
    expect(caDefaultArgument('Boolean').value).toEqual(primitive('false', 0x02))
    expect(caDefaultArgument('Char').value).toEqual(primitive('\u0000', 0x03))
    expect(caDefaultArgument('Int64').value).toEqual(primitive('0', 0x0A))
    // A string is nothing at all, and an array is an empty one; neither is a zero.
    expect(caDefaultArgument('String').value).toEqual({ kind: 'null' })
    expect(caDefaultArgument('Int32[]').value).toEqual({ kind: 'array', elements: [] })
    expect(caDefaultArgument(CA_TYPE).value).toEqual({ kind: 'type' })
    expect(caDefaultArgument(CA_NULL).value).toEqual({ kind: 'null' })
  })

  it('keeps the enum type it was pointed at, since the kind alone cannot name one', () => {
    const next = caDefaultArgument(CA_ENUM, argument(enumSig(), primitive('1', 0x08)))
    expect(next.type).toEqual(enumSig())
    // An element type of `End` says the enum itself decides how wide the value is.
    expect(next.value).toEqual(primitive('0', 0x00))
  })

  it('defaults a declared type the way a constructor parameter of it starts', () => {
    expect(caDefaultForType(corlibSig('Int32', true))).toEqual(primitive('0', 0x08))
    // A string parameter is the null string, not the empty one.
    expect(caDefaultForType(corlibSig('String', false))).toEqual({ kind: 'null' })
    expect(caDefaultForType(enumSig())).toEqual(primitive('0', 0x00))
    expect(caDefaultForType(systemTypeSig())).toEqual({ kind: 'null' })
    expect(caDefaultForType(szArraySig(corlibSig('Int32', true)))).toEqual({ kind: 'null' })
  })
})

describe('values', () => {
  it('reads a string box as the null string when it is empty, since there is no other way to write one', () => {
    const string = argument(corlibSig('String', false), { kind: 'string', text: 'a' })
    expect(caArgumentText(string)).toBe('a')
    expect(caSetText('String', string, '').value).toEqual({ kind: 'null' })
    expect(caSetText('String', string, 'b').value).toEqual({ kind: 'string', text: 'b' })
  })

  it('writes an enum through the backend, which is what knows how wide it is', () => {
    const next = caSetText(CA_ENUM, argument(enumSig(), primitive('1', 0x08)), '2')
    expect(next.value).toEqual(primitive('2', 0x08))
    // With no width known, `End` leaves the underlying type to be resolved from the enum's own definition.
    const unknown = caSetText(CA_ENUM, argument(enumSig(), { kind: 'null' }), '2')
    expect(unknown.value).toEqual(primitive('2', 0x00))
  })

  it('tells a null array from an empty one', () => {
    const array = argument(szArraySig(corlibSig('Int32', true)), { kind: 'array', elements: [] })
    expect(caArrayIsNull(array)).toBe(false)
    expect(caArrayIsNull(caSetArrayNull(array, true))).toBe(true)
    expect(caSetArrayNull(array, true).value).toEqual({ kind: 'null' })
    expect(caSetArrayNull(array, false).value).toEqual({ kind: 'array', elements: [] })
  })

  it('reads and writes the elements of an array as one comma-separated line', () => {
    const array = argument(szArraySig(corlibSig('Int32', true)), { kind: 'null' })
    const filled = caSetArrayText('Int32[]', array, '1, 2,3')
    expect(caArrayText(filled)).toBe('1, 2, 3')
    expect(filled.value.kind === 'array' ? filled.value.elements?.map((item) => item.value) : []).toEqual([
      primitive('1', 0x08), primitive('2', 0x08), primitive('3', 0x08),
    ])
    expect(caArrayText(caSetArrayText('Int32[]', array, '  '))).toBe('')
  })

  it('unwraps a boxed value without losing the box it came in', () => {
    const boxed = argument(systemObjectSig(), { kind: 'struct', elements: [argument(corlibSig('Int32', true), primitive('7', 0x08))] })
    expect(caBoxedArgument(boxed)?.value).toEqual(primitive('7', 0x08))
    // Writing it back keeps the wrapper, which is how dnlib tells a boxed value from a bare one.
    expect(caSetBoxedArgument(boxed, argument(corlibSig('Int32', true), primitive('8', 0x08))).value.kind).toBe('struct')

    const bare = argument(systemObjectSig(), primitive('7', 0x08))
    expect(caSetBoxedArgument(bare, argument(corlibSig('Int32', true), primitive('8', 0x08))).value.kind).toBe('primitive')
  })
})

describe('caArgumentError', () => {
  it('holds every kind to what the backend will read back out of it', () => {
    expect(caArgumentError(argument(corlibSig('Int32', true), primitive('4x', 0x08)))).toBeTruthy()
    expect(caArgumentError(argument(corlibSig('Int32', true), primitive('4000000000', 0x08)))).toBeTruthy()
    expect(caArgumentError(argument(corlibSig('Int32', true), primitive('-1', 0x08)))).toBeUndefined()
    expect(caArgumentError(argument(corlibSig('Char', true), primitive('xy', 0x03)))).toBeTruthy()
    expect(caArgumentError(argument(corlibSig('Boolean', true), primitive('TRUE', 0x02)))).toBeTruthy()
  })

  it('checks only the shape of an enum value, since the width is the enum’s own business', () => {
    expect(caArgumentError(argument(enumSig(), primitive('3', 0x00)))).toBeUndefined()
    expect(caArgumentError(argument(enumSig(), primitive('3x', 0x00)))).toBeTruthy()
  })

  it('wants a type picked for a value that is a type, and something inside a boxed one', () => {
    expect(caArgumentError(argument(systemTypeSig(), { kind: 'type' }))).toEqual({ template: 'Pick a type' })
    expect(caArgumentError(argument(systemTypeSig(), { kind: 'type', referencedType: enumSig() }))).toBeUndefined()
    expect(caArgumentError(argument(systemObjectSig(), { kind: 'struct', elements: [] }))).toEqual({ template: 'A boxed value needs one inner argument' })
  })
})

describe('caArgumentDisplay', () => {
  it('reads like the value dnSpy shows in its list', () => {
    expect(caArgumentDisplay(argument(corlibSig('Int32', true), primitive('1', 0x08)))).toBe('1')
    expect(caArgumentDisplay(argument(corlibSig('String', false), { kind: 'string', text: 'a' }))).toBe('"a"')
    expect(caArgumentDisplay(argument(systemObjectSig(), { kind: 'null' }))).toBe('null')
    expect(caArgumentDisplay(argument(systemTypeSig(), { kind: 'type', referencedType: enumSig() }))).toBe('typeof(Alpha.Colour)')
    expect(caArgumentDisplay(argument(szArraySig(corlibSig('Int32', true)), { kind: 'array', elements: [argument(corlibSig('Int32', true), primitive('1', 0x08))] }))).toBe('new System.Int32[] {1}')
  })
})
