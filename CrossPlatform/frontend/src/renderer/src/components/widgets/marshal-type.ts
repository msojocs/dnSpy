import type { MarshalTypeDto } from '../../../../shared/protocol'
import { isTypeSigComplete } from './type-sig-text'

/**
 * dnlib's `NativeType`. The enum is unsigned and the backend sends it as a signed `int`, so its two
 * sentinels arrive negative — `RawBlob` is `0xFFFFFFFF` and `NotInitialized` is `0xFFFFFFFE`.
 */
export const NATIVE_TYPE = {
  End: 0,
  Void: 1,
  Boolean: 2,
  I1: 3,
  U1: 4,
  I2: 5,
  U2: 6,
  I4: 7,
  U4: 8,
  I8: 9,
  U8: 10,
  R4: 11,
  R8: 12,
  SysChar: 13,
  Variant: 14,
  Currency: 15,
  Ptr: 16,
  Decimal: 17,
  Date: 18,
  BStr: 19,
  LPStr: 20,
  LPWStr: 21,
  LPTStr: 22,
  FixedSysString: 23,
  ObjectRef: 24,
  IUnknown: 25,
  IDispatch: 26,
  Struct: 27,
  IntF: 28,
  SafeArray: 29,
  FixedArray: 30,
  Int: 31,
  UInt: 32,
  NestedStruct: 33,
  ByValStr: 34,
  ANSIBStr: 35,
  TBStr: 36,
  VariantBool: 37,
  Func: 38,
  ASAny: 40,
  Array: 42,
  LPStruct: 43,
  CustomMarshaler: 44,
  Error: 45,
  IInspectable: 46,
  HString: 47,
  LPUTF8Str: 48,
  Max: 80,
  RawBlob: -1,
  NotInitialized: -2,
} as const

/** The type the marshal-type combo starts on, which is dnSpy's own default: the combo's list is sorted,
 * so the first entry is the one `EnumListVM` selects when nothing else has been picked. */
export const DEFAULT_NATIVE_TYPE = NATIVE_TYPE.ANSIBStr

/**
 * What the combo offers, which is dnSpy's `EnumVM.Create(typeof(NativeType))`: every value the enum
 * declares, sorted by name, minus `NotInitialized` — that one is a sentinel, and the two element-type
 * combos below are the only places that put it back.
 */
export const NATIVE_TYPES: { name: string, value: number }[] = [
  { name: 'ANSIBStr', value: NATIVE_TYPE.ANSIBStr },
  { name: 'Array', value: NATIVE_TYPE.Array },
  { name: 'ASAny', value: NATIVE_TYPE.ASAny },
  { name: 'Boolean', value: NATIVE_TYPE.Boolean },
  { name: 'BStr', value: NATIVE_TYPE.BStr },
  { name: 'ByValStr', value: NATIVE_TYPE.ByValStr },
  { name: 'Currency', value: NATIVE_TYPE.Currency },
  { name: 'CustomMarshaler', value: NATIVE_TYPE.CustomMarshaler },
  { name: 'Date', value: NATIVE_TYPE.Date },
  { name: 'Decimal', value: NATIVE_TYPE.Decimal },
  { name: 'End', value: NATIVE_TYPE.End },
  { name: 'Error', value: NATIVE_TYPE.Error },
  { name: 'FixedArray', value: NATIVE_TYPE.FixedArray },
  { name: 'FixedSysString', value: NATIVE_TYPE.FixedSysString },
  { name: 'Func', value: NATIVE_TYPE.Func },
  { name: 'HString', value: NATIVE_TYPE.HString },
  { name: 'I1', value: NATIVE_TYPE.I1 },
  { name: 'I2', value: NATIVE_TYPE.I2 },
  { name: 'I4', value: NATIVE_TYPE.I4 },
  { name: 'I8', value: NATIVE_TYPE.I8 },
  { name: 'IDispatch', value: NATIVE_TYPE.IDispatch },
  { name: 'IInspectable', value: NATIVE_TYPE.IInspectable },
  { name: 'Int', value: NATIVE_TYPE.Int },
  { name: 'IntF', value: NATIVE_TYPE.IntF },
  { name: 'IUnknown', value: NATIVE_TYPE.IUnknown },
  { name: 'LPStr', value: NATIVE_TYPE.LPStr },
  { name: 'LPStruct', value: NATIVE_TYPE.LPStruct },
  { name: 'LPTStr', value: NATIVE_TYPE.LPTStr },
  { name: 'LPUTF8Str', value: NATIVE_TYPE.LPUTF8Str },
  { name: 'LPWStr', value: NATIVE_TYPE.LPWStr },
  { name: 'Max', value: NATIVE_TYPE.Max },
  { name: 'NestedStruct', value: NATIVE_TYPE.NestedStruct },
  { name: 'ObjectRef', value: NATIVE_TYPE.ObjectRef },
  { name: 'Ptr', value: NATIVE_TYPE.Ptr },
  { name: 'R4', value: NATIVE_TYPE.R4 },
  { name: 'R8', value: NATIVE_TYPE.R8 },
  { name: 'RawBlob', value: NATIVE_TYPE.RawBlob },
  { name: 'SafeArray', value: NATIVE_TYPE.SafeArray },
  { name: 'Struct', value: NATIVE_TYPE.Struct },
  { name: 'SysChar', value: NATIVE_TYPE.SysChar },
  { name: 'TBStr', value: NATIVE_TYPE.TBStr },
  { name: 'U1', value: NATIVE_TYPE.U1 },
  { name: 'U2', value: NATIVE_TYPE.U2 },
  { name: 'U4', value: NATIVE_TYPE.U4 },
  { name: 'U8', value: NATIVE_TYPE.U8 },
  { name: 'UInt', value: NATIVE_TYPE.UInt },
  { name: 'Variant', value: NATIVE_TYPE.Variant },
  { name: 'VariantBool', value: NATIVE_TYPE.VariantBool },
  { name: 'Void', value: NATIVE_TYPE.Void },
]

/** The element-type combo a fixed or variable array carries, which is the same list with the sentinel
 * dnSpy inserts at the top — a fixed array's element type may be left unsaid. */
export const ELEMENT_TYPES: { name: string, value: number }[] = [
  { name: '<Not Initialized>', value: NATIVE_TYPE.NotInitialized },
  ...NATIVE_TYPES,
]

/** dnlib's `VariantType`, in the order dnSpy lists it rather than sorted — this one is written out by
 * hand in `MarshalTypeVM`, with `NotInitialized` first under a name of its own. */
export const VARIANT_TYPE = {
  NotInitialized: -1,
  Empty: 0,
  Null: 1,
  I2: 2,
  I4: 3,
  R4: 4,
  R8: 5,
  CY: 6,
  Date: 7,
  BStr: 8,
  Dispatch: 9,
  Error: 10,
  Bool: 11,
  Variant: 12,
  Unknown: 13,
  Decimal: 14,
  I1: 16,
  UI1: 17,
  UI2: 18,
  UI4: 19,
  I8: 20,
  UI8: 21,
  Int: 22,
  UInt: 23,
  Void: 24,
  HResult: 25,
  Ptr: 26,
  SafeArray: 27,
  CArray: 28,
  UserDefined: 29,
  LPStr: 30,
  LPWStr: 31,
  Record: 36,
  IntPtr: 37,
  UIntPtr: 38,
  FileTime: 64,
  Blob: 65,
  Stream: 66,
  Storage: 67,
  StreamedObject: 68,
  StoredObject: 69,
  BlobObject: 70,
  CF: 71,
  CLSID: 72,
  VersionedStream: 73,
  BStrBlob: 4095,
} as const

export const VARIANT_TYPES: { name: string, value: number }[] = [
  { name: '<Not Initialized>', value: VARIANT_TYPE.NotInitialized },
  { name: 'Empty', value: VARIANT_TYPE.Empty },
  { name: 'Null', value: VARIANT_TYPE.Null },
  { name: 'I2', value: VARIANT_TYPE.I2 },
  { name: 'I4', value: VARIANT_TYPE.I4 },
  { name: 'R4', value: VARIANT_TYPE.R4 },
  { name: 'R8', value: VARIANT_TYPE.R8 },
  { name: 'CY', value: VARIANT_TYPE.CY },
  { name: 'Date', value: VARIANT_TYPE.Date },
  { name: 'BStr', value: VARIANT_TYPE.BStr },
  { name: 'Dispatch', value: VARIANT_TYPE.Dispatch },
  { name: 'Error', value: VARIANT_TYPE.Error },
  { name: 'Bool', value: VARIANT_TYPE.Bool },
  { name: 'Variant', value: VARIANT_TYPE.Variant },
  { name: 'Unknown', value: VARIANT_TYPE.Unknown },
  { name: 'Decimal', value: VARIANT_TYPE.Decimal },
  { name: 'I1', value: VARIANT_TYPE.I1 },
  { name: 'UI1', value: VARIANT_TYPE.UI1 },
  { name: 'UI2', value: VARIANT_TYPE.UI2 },
  { name: 'UI4', value: VARIANT_TYPE.UI4 },
  { name: 'I8', value: VARIANT_TYPE.I8 },
  { name: 'UI8', value: VARIANT_TYPE.UI8 },
  { name: 'Int', value: VARIANT_TYPE.Int },
  { name: 'UInt', value: VARIANT_TYPE.UInt },
  { name: 'Void', value: VARIANT_TYPE.Void },
  { name: 'HResult', value: VARIANT_TYPE.HResult },
  { name: 'Ptr', value: VARIANT_TYPE.Ptr },
  { name: 'SafeArray', value: VARIANT_TYPE.SafeArray },
  { name: 'CArray', value: VARIANT_TYPE.CArray },
  { name: 'UserDefined', value: VARIANT_TYPE.UserDefined },
  { name: 'LPStr', value: VARIANT_TYPE.LPStr },
  { name: 'LPWStr', value: VARIANT_TYPE.LPWStr },
  { name: 'Record', value: VARIANT_TYPE.Record },
  { name: 'IntPtr', value: VARIANT_TYPE.IntPtr },
  { name: 'UIntPtr', value: VARIANT_TYPE.UIntPtr },
  { name: 'FileTime', value: VARIANT_TYPE.FileTime },
  { name: 'Blob', value: VARIANT_TYPE.Blob },
  { name: 'Stream', value: VARIANT_TYPE.Stream },
  { name: 'Storage', value: VARIANT_TYPE.Storage },
  { name: 'StreamedObject', value: VARIANT_TYPE.StreamedObject },
  { name: 'StoredObject', value: VARIANT_TYPE.StoredObject },
  { name: 'BlobObject', value: VARIANT_TYPE.BlobObject },
  { name: 'CF', value: VARIANT_TYPE.CF },
  { name: 'CLSID', value: VARIANT_TYPE.CLSID },
  { name: 'VersionedStream', value: VARIANT_TYPE.VersionedStream },
  { name: 'BStrBlob', value: VARIANT_TYPE.BStrBlob },
]

/** The half of a safe array's variant type that names the element, and the four flags above it. */
export const VARIANT_TYPE_MASK = 0x0FFF
export const VARIANT_FLAGS: { name: string, value: number }[] = [
  { name: 'Vector', value: 0x1000 },
  { name: 'Array', value: 0x2000 },
  { name: 'ByRef', value: 0x4000 },
  { name: 'Reserved', value: 0x8000 },
]

/** What a size, a parameter number or a flags box holds: dnlib's compressed unsigned range. */
export const COMPRESSED_UINT32_MAX = 0x1FFFFFFF

export const isRawMarshalType = (nativeType: number): boolean => nativeType === NATIVE_TYPE.RawBlob
export const isFixedSysString = (nativeType: number): boolean => nativeType === NATIVE_TYPE.FixedSysString
export const isSafeArray = (nativeType: number): boolean => nativeType === NATIVE_TYPE.SafeArray
export const isFixedArray = (nativeType: number): boolean => nativeType === NATIVE_TYPE.FixedArray
export const isArray = (nativeType: number): boolean => nativeType === NATIVE_TYPE.Array
export const isCustomMarshaler = (nativeType: number): boolean => nativeType === NATIVE_TYPE.CustomMarshaler
/** The three interface marshallers, which are the ones that carry a parameter index. */
export const isInterface = (nativeType: number): boolean =>
  nativeType === NATIVE_TYPE.IUnknown || nativeType === NATIVE_TYPE.IDispatch || nativeType === NATIVE_TYPE.IntF

/** A fresh marshal type for the Enable checkbox: the combo's own default and nothing else. */
export const newMarshalType = (): MarshalTypeDto => ({ nativeType: DEFAULT_NATIVE_TYPE })

/** The raw blob: the backend carries the bytes base64-encoded and dnSpy shows them as hex. */
export const hexOfRawData = (rawData: string): string =>
  [...atob(rawData)].map((character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')

export const rawDataOfHex = (hex: string): string | null | undefined => {
  const trimmed = hex.trim()
  if (trimmed.length === 0)
    return null
  if (!/^([0-9a-fA-F]{2})*$/.test(trimmed))
    return undefined
  return btoa(trimmed.replace(/(..)/g, (pair) => String.fromCharCode(Number.parseInt(pair, 16))))
}

/** What would keep the backend from writing this marshal type: a signature that is only half built. */
export const marshalTypeError = (value: MarshalTypeDto): string | undefined => {
  if (isSafeArray(value.nativeType) && value.userDefinedSubType && !isTypeSigComplete(value.userDefinedSubType))
    return 'A type is required'
  if (isCustomMarshaler(value.nativeType) && value.customMarshaler && !isTypeSigComplete(value.customMarshaler))
    return 'A type is required'
  return undefined
}
