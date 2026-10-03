import { describe, expect, it } from 'vitest'
import type { CustomAttributeDto, GenericParamDto, TypeSigDto } from '../../../../shared/protocol'
import {
  GENERIC_PARAM_ATTRIBUTES, GENERIC_PARAM_FLAGS, GP_VARIANCES, genericParamDraft, genericParamDto, genericParamError,
  genericParamLabel, genericParamNumber, hasGenericParamFlag, newGenericParam, varianceOf, withGenericParamFlag,
  withVariance,
} from './generic-param'

const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }

/** An attribute as one arrives over the wire, where the constructor it names is always there. */
const attribute = (): CustomAttributeDto => ({
  constructor: {
    declaringType: int32,
    name: '.ctor',
    signature: {
      callingConvention: 0,
      returnType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } },
      parameters: [],
    },
  },
  constructorArguments: [],
  namedArguments: [],
})

const dto = (patch: Partial<GenericParamDto> = {}): GenericParamDto => ({
  number: 0,
  flags: 0,
  name: '',
  constraints: [],
  customAttributes: [],
  ...patch,
})

describe('the generic parameter attributes', () => {
  it('is what dnlib declares', () => {
    expect(GENERIC_PARAM_ATTRIBUTES).toEqual({
      VarianceMask: 0x0003, NonVariant: 0x0000, Covariant: 0x0001, Contravariant: 0x0002,
      ReferenceTypeConstraint: 0x0004, NotNullableValueTypeConstraint: 0x0008,
      DefaultConstructorConstraint: 0x0010, AllowByRefLike: 0x0020,
    })
  })

  it('is laid out as dnSpy lays the four checkboxes out', () => {
    expect(GENERIC_PARAM_FLAGS.map((entry) => entry.label)).toEqual(['Class', 'Struct', 'Default ctor', 'Allows ByRefLike'])
    expect(GENERIC_PARAM_FLAGS.map((entry) => entry.flag)).toEqual([0x0004, 0x0008, 0x0010, 0x0020])
  })

  it('offers the three variances in the order dnSpy\'s enum declares them', () => {
    expect(GP_VARIANCES).toEqual([
      { label: 'NonVariant', value: 0 },
      { label: 'Covariant', value: 1 },
      { label: 'Contravariant', value: 2 },
    ])
  })

  it('reads and writes one bit without touching the others', () => {
    const constraints = GENERIC_PARAM_ATTRIBUTES.ReferenceTypeConstraint | GENERIC_PARAM_ATTRIBUTES.AllowByRefLike
    expect(hasGenericParamFlag(constraints, GENERIC_PARAM_ATTRIBUTES.AllowByRefLike)).toBe(true)
    expect(hasGenericParamFlag(constraints, GENERIC_PARAM_ATTRIBUTES.NotNullableValueTypeConstraint)).toBe(false)
    expect(withGenericParamFlag(GENERIC_PARAM_ATTRIBUTES.ReferenceTypeConstraint, GENERIC_PARAM_ATTRIBUTES.AllowByRefLike, true)).toBe(constraints)
    expect(withGenericParamFlag(constraints, GENERIC_PARAM_ATTRIBUTES.ReferenceTypeConstraint, false)).toBe(GENERIC_PARAM_ATTRIBUTES.AllowByRefLike)
  })

  it('keeps every other bit where it was when the variance is picked, which is what the combo does', () => {
    // `GenericParamVM.Attributes`' setter masks the combo's value into the low bits and leaves the rest,
    // so a parameter that is covariant and allows a by-ref-like type holds both.
    expect(varianceOf(GENERIC_PARAM_ATTRIBUTES.AllowByRefLike | GENERIC_PARAM_ATTRIBUTES.Covariant)).toBe(1)
    expect(varianceOf(GENERIC_PARAM_ATTRIBUTES.Contravariant)).toBe(2)
    expect(withVariance(GENERIC_PARAM_ATTRIBUTES.AllowByRefLike | GENERIC_PARAM_ATTRIBUTES.Covariant, GENERIC_PARAM_ATTRIBUTES.Contravariant))
      .toBe(GENERIC_PARAM_ATTRIBUTES.AllowByRefLike | GENERIC_PARAM_ATTRIBUTES.Contravariant)
  })
})

describe('opening a row', () => {
  it('shows the number the way dnSpy\'s box shows it', () => {
    expect(genericParamDraft(dto({ number: 1 })).number).toBe('1')
    // The box prints hex for everything outside dnSpy's short list of round numbers.
    expect(genericParamDraft(dto({ number: 300 })).number).toBe('0x12C')
  })

  it('takes the word as it came, unlike a parameter, which reads two of its bits off the values', () => {
    const draft = genericParamDraft(dto({ flags: GENERIC_PARAM_ATTRIBUTES.Covariant | GENERIC_PARAM_ATTRIBUTES.ReferenceTypeConstraint }))
    expect(draft.attributes).toBe(0x0005)
  })

  it('takes the kind and the constraints it was given', () => {
    const draft = genericParamDraft(dto({
      kind: int32,
      constraints: [{ constraint: int32, customAttributes: [attribute()] }],
      customAttributes: [attribute()],
    }))
    expect(draft.kind).toEqual(int32)
    // A constraint is the same row as an implemented interface, so it opens as one of those drafts and
    // only the DTO's field name differs.
    expect(draft.constraints[0].type).toEqual(int32)
    expect(draft.constraints[0].customAttributes).toHaveLength(1)
    expect(draft.customAttributes).toHaveLength(1)
  })

  it('opens the kind page empty for a row that has none, which is a kind no runtime reads anyway', () => {
    expect(genericParamDraft(dto()).kind).toBeNull()
    // It went over the wire, where a field with nothing in it is a null and not an absence.
    const wire = (json: string): GenericParamDto => JSON.parse(json) as GenericParamDto
    expect(genericParamDraft(wire('{"number":0,"flags":0,"name":"","kind":null,"constraints":[],"customAttributes":[]}')).kind).toBeNull()
  })
})

describe('the row\'s text', () => {
  it('is the number and the name, which is dnSpy\'s FullName', () => {
    expect(genericParamLabel(genericParamDraft(dto({ number: 1, name: 'T' })))).toBe('gparam(1) T')
    expect(genericParamLabel(genericParamDraft(dto({ number: 0 })))).toBe('gparam(0) <<no-name>>')
  })

  it('says so while the number box holds something that is not a number', () => {
    expect(genericParamLabel({ ...newGenericParam(), number: '' })).toBe('gparam(???) <<no-name>>')
  })
})

describe('a fresh row', () => {
  it('is the first parameter, with nothing said about it', () => {
    expect(newGenericParam()).toEqual({ name: '', number: '0', attributes: 0, kind: null, constraints: [], customAttributes: [] })
    expect(genericParamDraft(genericParamDto(newGenericParam()))).toEqual(newGenericParam())
  })

  it('reads a number the way the box writes one', () => {
    expect(genericParamNumber('1')).toBe(1)
    expect(genericParamNumber('0x10')).toBe(16)
    expect(genericParamNumber('&H10')).toBe(16)
    expect(genericParamNumber('')).toBeUndefined()
    expect(genericParamNumber('nope')).toBeUndefined()
  })
})

describe('what keeps a row from being accepted', () => {
  it('is the number box and nothing else, which is `GenericParamVM.HasError`', () => {
    expect(genericParamError(newGenericParam())).toBeUndefined()
    // A kind that is half built and a constraint with no type are the pages' own business.
    expect(genericParamError({ ...newGenericParam(), kind: { kind: 'empty' } })).toBeUndefined()
    expect(genericParamError({ ...newGenericParam(), constraints: [{ type: null, customAttributes: [] }] })).toBeUndefined()
  })

  it('counts an empty box as an error, since a parameter has a number whether the box says one or not', () => {
    expect(genericParamError({ ...newGenericParam(), number: '' })?.template)
      .toBe('The value is not an unsigned hexadecimal or decimal integer')
    expect(genericParamError({ ...newGenericParam(), number: 'x' })?.template)
      .toBe('The value is not an unsigned hexadecimal or decimal integer')
    expect(genericParamError({ ...newGenericParam(), number: '-1' })?.template)
      .toBe('Only non-negative integers are allowed')
  })

  it('reports the range a number outside a ushort gets, the way every number box reports it', () => {
    const error = genericParamError({ ...newGenericParam(), number: '0x10000' })
    expect(error?.template).toBe('Value must be between {min} and {max} (0x{maxHex}) inclusive')
    expect(error?.args).toEqual({ min: '0', max: '65535', maxHex: 'FFFF' })
    expect(genericParamError({ ...newGenericParam(), number: '0xFFFF' })).toBeUndefined()
  })
})

describe('writing a row back', () => {
  it('writes the number, the word, the name and the kind', () => {
    const written = genericParamDto({
      ...newGenericParam(),
      name: 'T',
      number: '0x10',
      attributes: GENERIC_PARAM_ATTRIBUTES.Covariant,
      kind: int32,
    })
    expect(written).toEqual({
      number: 16,
      flags: 1,
      name: 'T',
      kind: int32,
      constraints: [],
      customAttributes: [],
    })
  })

  it('writes a kind that was never picked as nothing rather than as an empty signature', () => {
    expect(genericParamDto(newGenericParam()).kind).toBeUndefined()
  })

  it('will not write a row with no readable number, which is what the disabled OK button prevents', () => {
    expect(() => genericParamDto({ ...newGenericParam(), number: '' })).toThrow('A generic parameter needs a number.')
  })

  it('reads back as the row it was written from, which is what the list does with it', () => {
    const draft = genericParamDraft(dto({
      number: 2,
      name: 'TResult',
      flags: GENERIC_PARAM_ATTRIBUTES.Contravariant,
      kind: int32,
      constraints: [{ constraint: int32, customAttributes: [] }],
    }))
    expect(genericParamDraft(genericParamDto(draft))).toEqual(draft)
  })
})
