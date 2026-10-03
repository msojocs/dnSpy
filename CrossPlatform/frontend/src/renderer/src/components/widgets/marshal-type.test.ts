import { describe, expect, it } from 'vitest'
import type { MarshalTypeDto, TypeSigDto } from '../../../../shared/protocol'
import {
  DEFAULT_NATIVE_TYPE, ELEMENT_TYPES, hexOfRawData, isArray, isCustomMarshaler, isFixedArray, isFixedSysString,
  isInterface, isRawMarshalType, isSafeArray, marshalTypeError, NATIVE_TYPE, NATIVE_TYPES, newMarshalType,
  rawDataOfHex, VARIANT_FLAGS, VARIANT_TYPE, VARIANT_TYPE_MASK, VARIANT_TYPES,
} from './marshal-type'

const stringSig: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'String' } }

/** dnSpy sorts the combo with `StringComparer.InvariantCultureIgnoreCase`, which orders `Boolean` before
 * `BStr` and `Int` before `IUnknown` — a plain code-unit sort swaps both pairs around. */
const invariantOrder = new Intl.Collator('en', { sensitivity: 'base' })

describe('the native-type list', () => {
  it('is dnlib\'s enum minus the sentinel, sorted the way dnSpy sorts a combo', () => {
    const names = NATIVE_TYPES.map((entry) => entry.name)
    expect(names).toEqual([...names].sort(invariantOrder.compare))
    expect(NATIVE_TYPES).toHaveLength(49)
    expect(NATIVE_TYPES.some((entry) => entry.value === NATIVE_TYPE.NotInitialized)).toBe(false)
    expect(NATIVE_TYPES.some((entry) => entry.value === NATIVE_TYPE.End)).toBe(true)
  })

  it('carries dnlib\'s unsigned sentinels as the signed ints the backend sends', () => {
    expect(NATIVE_TYPES.find((entry) => entry.name === 'RawBlob')?.value).toBe(-1)
    expect(NATIVE_TYPES.find((entry) => entry.name === 'Max')?.value).toBe(80)
  })

  it('starts on the first entry, which is the one dnSpy\'s combo selects by default', () => {
    expect(DEFAULT_NATIVE_TYPE).toBe(NATIVE_TYPE.ANSIBStr)
    expect(newMarshalType()).toEqual({ nativeType: NATIVE_TYPE.ANSIBStr })
  })

  it('puts the sentinel back in front of the element types, and nowhere else', () => {
    expect(ELEMENT_TYPES[0]).toEqual({ name: '<Not Initialized>', value: NATIVE_TYPE.NotInitialized })
    expect(ELEMENT_TYPES).toHaveLength(NATIVE_TYPES.length + 1)
  })
})

describe('the variant-type list', () => {
  it('is the order dnSpy writes out by hand, not a sort', () => {
    expect(VARIANT_TYPES[0]).toEqual({ name: '<Not Initialized>', value: VARIANT_TYPE.NotInitialized })
    expect(VARIANT_TYPES[1]).toEqual({ name: 'Empty', value: VARIANT_TYPE.Empty })
    const names = VARIANT_TYPES.map((entry) => entry.name)
    expect(names).not.toEqual([...names].sort(invariantOrder.compare))
  })

  it('splits a value into the element type and the four flags above it', () => {
    expect(VARIANT_TYPE_MASK).toBe(0x0FFF)
    expect(VARIANT_FLAGS.map((entry) => entry.name)).toEqual(['Vector', 'Array', 'ByRef', 'Reserved'])
    expect(VARIANT_FLAGS.map((entry) => entry.value)).toEqual([0x1000, 0x2000, 0x4000, 0x8000])
    expect(VARIANT_TYPE.BStrBlob).toBe(VARIANT_TYPE_MASK)
  })
})

describe('the raw blob', () => {
  it('shows the bytes dnSpy shows: hex, not the base64 the backend carries', () => {
    expect(hexOfRawData(btoa('\x01\x02\xff'))).toBe('0102ff')
    expect(hexOfRawData(btoa(''))).toBe('')
  })

  it('reads hex back into base64, and pads the odd byte dnSpy pads', () => {
    expect(rawDataOfHex('0102ff')).toBe(btoa('\x01\x02\xff'))
    expect(rawDataOfHex('0102FF')).toBe(btoa('\x01\x02\xff'))
  })

  it('reads an empty box as no blob, and text that is not hex as nothing at all', () => {
    expect(rawDataOfHex('')).toBeNull()
    expect(rawDataOfHex('0')).toBeUndefined()
    expect(rawDataOfHex('01 02')).toBeUndefined()
    expect(rawDataOfHex('zz')).toBeUndefined()
  })
})

describe('which payload a native type carries', () => {
  it('is decided by the native type alone', () => {
    expect(isRawMarshalType(NATIVE_TYPE.RawBlob)).toBe(true)
    expect(isFixedSysString(NATIVE_TYPE.FixedSysString)).toBe(true)
    expect(isSafeArray(NATIVE_TYPE.SafeArray)).toBe(true)
    expect(isFixedArray(NATIVE_TYPE.FixedArray)).toBe(true)
    expect(isArray(NATIVE_TYPE.Array)).toBe(true)
    expect(isCustomMarshaler(NATIVE_TYPE.CustomMarshaler)).toBe(true)
    expect(isInterface(NATIVE_TYPE.IUnknown)).toBe(true)
    expect(isInterface(NATIVE_TYPE.IDispatch)).toBe(true)
    expect(isInterface(NATIVE_TYPE.IntF)).toBe(true)
    expect(isInterface(NATIVE_TYPE.Struct)).toBe(false)
    expect(isArray(NATIVE_TYPE.FixedArray)).toBe(false)
  })
})

describe('marshalTypeError', () => {
  it('lets a finished signature through', () => {
    expect(marshalTypeError({ nativeType: NATIVE_TYPE.SafeArray, variantType: 0, userDefinedSubType: stringSig })).toBeUndefined()
    expect(marshalTypeError({ nativeType: NATIVE_TYPE.CustomMarshaler, customMarshaler: stringSig })).toBeUndefined()
  })

  it('stops a signature that is only half built', () => {
    // What the signature editor holds before anything has been picked as the element type.
    const half: TypeSigDto = { kind: 'empty' }
    expect(marshalTypeError({ nativeType: NATIVE_TYPE.SafeArray, userDefinedSubType: half })).toBe('A type is required')
    expect(marshalTypeError({ nativeType: NATIVE_TYPE.CustomMarshaler, customMarshaler: half })).toBe('A type is required')
  })

  it('says nothing about a payload the native type does not use, since the backend never reads it', () => {
    // What the signature editor holds before anything has been picked as the element type.
    const half: TypeSigDto = { kind: 'empty' }
    const value: MarshalTypeDto = { nativeType: NATIVE_TYPE.Array, userDefinedSubType: half, customMarshaler: half }
    expect(marshalTypeError(value)).toBeUndefined()
  })

  it('says nothing about an absent signature', () => {
    expect(marshalTypeError({ nativeType: NATIVE_TYPE.SafeArray })).toBeUndefined()
  })
})
