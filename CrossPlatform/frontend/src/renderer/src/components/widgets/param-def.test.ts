import { describe, expect, it } from 'vitest'
import type { ParamDefDto } from '../../../../shared/protocol'
import {
  hasParamFlag, newParamDef, PARAM_ATTRIBUTES, PARAM_FLAGS, paramDefDraft, paramDefDto, paramDefError, paramDefLabel,
  sequenceValue, SEQUENCE_MAX, withParamFlag,
} from './param-def'

const dto = (patch: Partial<ParamDefDto> = {}): ParamDefDto => ({
  name: '',
  sequence: 1,
  attributes: 0,
  customAttributes: [],
  ...patch,
})

describe('the parameter attributes', () => {
  it('is what dnlib declares', () => {
    expect(PARAM_ATTRIBUTES).toEqual({
      In: 0x0001, Out: 0x0002, Lcid: 0x0004, Retval: 0x0008, Optional: 0x0010,
      HasDefault: 0x1000, HasFieldMarshal: 0x2000,
    })
  })

  it('is laid out as dnSpy lays the five checkboxes out', () => {
    expect(PARAM_FLAGS.map((entry) => entry.label)).toEqual(['In', 'Out', 'Lcid', 'Retval', 'Optional'])
    expect(PARAM_FLAGS.map((entry) => entry.flag)).toEqual([0x0001, 0x0002, 0x0004, 0x0008, 0x0010])
  })

  it('reads and writes one bit without touching the others', () => {
    expect(hasParamFlag(PARAM_ATTRIBUTES.In | PARAM_ATTRIBUTES.Retval, PARAM_ATTRIBUTES.Retval)).toBe(true)
    expect(hasParamFlag(PARAM_ATTRIBUTES.In, PARAM_ATTRIBUTES.Out)).toBe(false)
    expect(withParamFlag(PARAM_ATTRIBUTES.In, PARAM_ATTRIBUTES.Retval, true)).toBe(PARAM_ATTRIBUTES.In | PARAM_ATTRIBUTES.Retval)
    expect(withParamFlag(PARAM_ATTRIBUTES.In | PARAM_ATTRIBUTES.Retval, PARAM_ATTRIBUTES.In, false)).toBe(PARAM_ATTRIBUTES.Retval)
  })
})

describe('opening a row', () => {
  it('shows the sequence the way dnSpy\'s box shows it', () => {
    expect(paramDefDraft(dto({ sequence: 3 })).sequence).toBe('3')
    // The box prints hex for everything outside dnSpy's short list of round numbers.
    expect(paramDefDraft(dto({ sequence: 300 })).sequence).toBe('0x12C')
  })

  it('reads the two bits off the values rather than off the word', () => {
    // A row whose attributes disagree with what it carries opens on what it carries, which is what
    // `InitializeFrom` does — the constant is assigned after the word, and the marshalling after that.
    // The two below went over the wire, where a field with nothing in it is a null and not an absence.
    const wire = (json: string): ParamDefDto => JSON.parse(json) as ParamDefDto
    const empty = wire('{"name":"","sequence":1,"attributes":12288,"constant":null,"marshalType":null,"customAttributes":[]}')
    const draft = paramDefDraft(empty)
    expect(hasParamFlag(draft.attributes, PARAM_ATTRIBUTES.HasDefault)).toBe(false)
    expect(hasParamFlag(draft.attributes, PARAM_ATTRIBUTES.HasFieldMarshal)).toBe(false)
    expect(draft.constant).toBeNull()
    expect(draft.marshalType).toBeUndefined()

    const constant = wire('{"name":"","sequence":1,"attributes":0,"constant":{"elementType":8,"value":"1"},"marshalType":null,"customAttributes":[]}')
    const withConstant = paramDefDraft(constant)
    expect(hasParamFlag(withConstant.attributes, PARAM_ATTRIBUTES.HasDefault)).toBe(true)
    expect(withConstant.constant).toEqual({ elementType: 0x08, value: '1' })

    const marshal = wire('{"name":"","sequence":1,"attributes":0,"constant":null,"marshalType":{"nativeType":23},"customAttributes":[]}')
    expect(hasParamFlag(paramDefDraft(marshal).attributes, PARAM_ATTRIBUTES.HasFieldMarshal)).toBe(true)
  })

  it('keeps the five flags that stand for nothing but themselves', () => {
    const attributes = PARAM_ATTRIBUTES.In | PARAM_ATTRIBUTES.Out | PARAM_ATTRIBUTES.Optional
    const draft = paramDefDraft(dto({ attributes, constant: { elementType: 0x08, value: '1' } }))
    expect(draft.attributes & (PARAM_ATTRIBUTES.In | PARAM_ATTRIBUTES.Out | PARAM_ATTRIBUTES.Optional))
      .toBe(attributes)
    expect(paramDefDto(draft).attributes).toBe(attributes | PARAM_ATTRIBUTES.HasDefault)
  })
})

describe('the sequence box', () => {
  it('reads a sequence, and nothing else', () => {
    expect(sequenceValue('0')).toBe(0)
    expect(sequenceValue(' 12 ')).toBe(12)
    expect(sequenceValue('0x10')).toBe(16)
    expect(sequenceValue('1_000')).toBe(1000)
    expect(sequenceValue(String(SEQUENCE_MAX))).toBe(SEQUENCE_MAX)
    expect(sequenceValue('')).toBeUndefined()
    expect(sequenceValue('-1')).toBeUndefined()
    expect(sequenceValue('x')).toBeUndefined()
    expect(sequenceValue(String(SEQUENCE_MAX + 1))).toBeUndefined()
  })
})

describe('the row\'s text', () => {
  it('names the sequence the way dnSpy\'s FullName does', () => {
    expect(paramDefLabel(newParamDef())).toBe('param(return) <<no-name>>')
    expect(paramDefLabel({ ...newParamDef(), name: 'a', sequence: '1' })).toBe('param(1) a')
    expect(paramDefLabel({ ...newParamDef(), name: 'a', sequence: '0x12C' })).toBe('param(300) a')
  })

  it('says so while the sequence box does not hold a sequence', () => {
    expect(paramDefLabel({ ...newParamDef(), name: 'a', sequence: 'x' })).toBe('??? a')
    expect(paramDefLabel({ ...newParamDef(), name: 'a', sequence: '' })).toBe('??? a')
  })
})

describe('a fresh row', () => {
  it('is dnSpy\'s own default: the return value, and nothing said about it', () => {
    expect(newParamDef()).toEqual({
      name: '',
      sequence: '0',
      attributes: 0,
      constant: null,
      marshalType: undefined,
      customAttributes: [],
    })
  })
})

describe('writing a row back', () => {
  it('takes the two bits from what the row carries', () => {
    const written = paramDefDto({
      ...newParamDef(),
      sequence: '1',
      attributes: PARAM_ATTRIBUTES.In | PARAM_ATTRIBUTES.HasDefault,
      constant: null,
    })
    expect(written.attributes).toBe(PARAM_ATTRIBUTES.In)
    expect(written.constant).toBeUndefined()

    const withConstant = paramDefDto({ ...newParamDef(), constant: { elementType: 0x08, value: '1' } })
    expect(withConstant.attributes).toBe(PARAM_ATTRIBUTES.HasDefault)
    expect(withConstant.constant).toEqual({ elementType: 0x08, value: '1' })
  })

  it('reads the sequence back out of the box, hex and all', () => {
    expect(paramDefDto({ ...newParamDef(), sequence: '0x12C' }).sequence).toBe(300)
  })

  it('will not write a row whose sequence does not read, which is what the disabled OK button prevents', () => {
    expect(() => paramDefDto({ ...newParamDef(), sequence: 'x' })).toThrow()
  })
})

describe('what would keep a row from being written', () => {
  it('is nothing at all for a row that is merely empty', () => {
    expect(paramDefError(newParamDef())).toBeUndefined()
  })

  it('is the sequence box\'s own complaint', () => {
    expect(paramDefError({ ...newParamDef(), sequence: '' })?.template)
      .toBe('The value is not an unsigned hexadecimal or decimal integer')
    expect(paramDefError({ ...newParamDef(), sequence: '-1' })?.template).toBe('Only non-negative integers are allowed')
    expect(paramDefError({ ...newParamDef(), sequence: '65536' })).toEqual({
      template: 'Value must be between {min} and {max} (0x{maxHex}) inclusive',
      args: { min: '0', max: '65535', maxHex: 'FFFF' },
    })
  })

  it('is a default value that does not read, which only counts while the checkbox is on', () => {
    const bad = { ...newParamDef(), constant: { elementType: 0x08, value: 'nope' } }
    expect(paramDefError(bad)?.template).toBe("'{text}' is not a valid {name}")
    expect(paramDefError(bad)?.args).toEqual({ text: 'nope', name: 'Int32' })
    // The checkbox off is no constant at all, so there is nothing left to complain about.
    expect(paramDefError({ ...bad, constant: null })).toBeUndefined()
  })

  it('is a marshalling that is only half built, which only counts while its box is on', () => {
    const half = { ...newParamDef(), marshalType: { nativeType: 29, userDefinedSubType: { kind: 'empty' as const } } }
    expect(paramDefError(half)?.template).toBe('A type is required')
    expect(paramDefError({ ...half, marshalType: undefined })).toBeUndefined()
  })

  it('reports the default value before the marshalling and the sequence, as dnSpy checks them', () => {
    const both = {
      ...newParamDef(),
      sequence: 'x',
      constant: { elementType: 0x08, value: 'nope' },
      marshalType: { nativeType: 29, userDefinedSubType: { kind: 'empty' as const } },
    }
    expect(paramDefError(both)?.template).toBe("'{text}' is not a valid {name}")
    expect(paramDefError({ ...both, constant: null })?.template).toBe('A type is required')
  })
})
