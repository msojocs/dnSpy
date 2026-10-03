/**
 * dnSpy's `FieldDefOptions` as the field dialog edits it, which is the model behind every page of that
 * window: the name and the attribute word, the type, the constant, the marshalling, the P/Invoke row,
 * the field offset, the RVA and the initial value.
 *
 * Three of those are boxes rather than values. dnSpy's view model holds each of them as a text box whose
 * `StringValue` is what the user is typing — a half-typed number is a state the dialog can be in — and
 * only the OK button stops it from being written. The draft keeps that text, and reading it back into a
 * value is what `fieldOptionsDto` does.
 *
 * Two bits of the attribute word are not boxes either: `HasFieldMarshal` and `HasDefault` follow the
 * values they belong to, and `PinvokeImpl` follows the ImplMap page's Enable box, so a row added and
 * removed again leaves the word as it was. `HasFieldRVA` is the third, and it is a box: an initial value
 * is a byte string and an empty one is still a value, so what says whether there is one cannot be
 * whether the box is empty.
 */

import type { ConstantDto, CustomAttributeDto, FieldOptionsDto, ImplMapDto, MarshalTypeDto, TypeSigDto } from '../../../../shared/protocol'
import type { CaError } from './ca-value'
import { constantFailure } from './ConstantEditor'
import { customAttributeDraft, customAttributeDto, type CustomAttributeDraft } from './custom-attribute'
import { hexOfRawData, marshalTypeError, rawDataOfHex } from './marshal-type'
import { formatNumberText, parseNumberText, unsignedIntegerFailure } from './number-text'
import { isTypeSigComplete } from './type-sig-text'

/** dnlib's `FieldAttributes`, which is the access combo, the flags box and the four derived bits. */
export const FIELD_ATTRIBUTES = {
  FieldAccessMask: 0x0007,
  Static: 0x0010,
  InitOnly: 0x0020,
  Literal: 0x0040,
  NotSerialized: 0x0080,
  HasFieldRVA: 0x0100,
  SpecialName: 0x0200,
  RTSpecialName: 0x0400,
  HasFieldMarshal: 0x1000,
  PinvokeImpl: 0x2000,
  HasDefault: 0x8000,
} as const

/** The Flags box, in the order the XAML lays its two rows of three out. */
export const FIELD_FLAGS: { label: string, flag: number }[] = [
  { label: 'Static', flag: FIELD_ATTRIBUTES.Static },
  { label: 'InitOnly', flag: FIELD_ATTRIBUTES.InitOnly },
  { label: 'Literal', flag: FIELD_ATTRIBUTES.Literal },
  { label: 'NotSerialized', flag: FIELD_ATTRIBUTES.NotSerialized },
  { label: 'SpecialName', flag: FIELD_ATTRIBUTES.SpecialName },
  { label: 'RTSpecialName', flag: FIELD_ATTRIBUTES.RTSpecialName },
]

/** The access combo, which is dnSpy's `FieldAccess` enum sorted by name the way `EnumVM.Create` sorts
 * every one of its lists. The values are the bits of `FieldAttributes.FieldAccessMask`. */
export const FIELD_ACCESSES: { label: string, value: number }[] = [
  { label: 'Assembly', value: 3 },
  { label: 'FamANDAssem', value: 2 },
  { label: 'Family', value: 4 },
  { label: 'FamORAssem', value: 5 },
  { label: 'Private', value: 1 },
  { label: 'PrivateScope', value: 0 },
  { label: 'Public', value: 6 },
]

/** A field offset and an RVA are both `uint`s. */
export const FIELD_NUMBER_MAX = 0xFFFFFFFF

export const hasFieldFlag = (attributes: number, flag: number): boolean => (attributes & flag) !== 0

export const withFieldFlag = (attributes: number, flag: number, on: boolean): number =>
  on ? attributes | flag : attributes & ~flag

/** The access combo's part of the word, and what picking an entry writes back into it. */
export const fieldAccessOf = (attributes: number): number => attributes & FIELD_ATTRIBUTES.FieldAccessMask
export const withFieldAccess = (attributes: number, value: number): number =>
  (attributes & ~FIELD_ATTRIBUTES.FieldAccessMask) | value

/** A field row while a dialog has it open. */
export interface FieldOptionsDraft {
  attributes: number
  name: string
  /** The type, or undefined while nothing has been picked — dnSpy's `TypeSigCreator` starts empty, and
   * an empty one is what leaves OK disabled. */
  fieldSig?: TypeSigDto
  /** What the Offset box holds, which is text: an empty box is no offset at all. */
  fieldOffset: string
  /** The marshalling, which the HasFieldMarshal bit goes with — undefined when its Enable box is off. */
  marshalType?: MarshalTypeDto
  /** Whether the field has a field RVA. The initial value is kept while this is off, the way dnSpy's
   * control only greys its box out. */
  hasFieldRVA: boolean
  /** What the Initial Value box holds: the bytes as hex, which is how dnSpy shows them. */
  initialValue: string
  /** The P/Invoke row, which the PinvokeImpl bit goes with. */
  implMap?: ImplMapDto
  /** The default value, which the HasDefault bit goes with — null when its checkbox is off. */
  constant: ConstantDto | null
  /** What the RVA box holds, which is text for the same reason the offset box is. */
  rva: string
  customAttributes: CustomAttributeDraft[]
}

/** Whether a value arrived at all, since a row's DTO may leave one out and JSON may send it as null. */
const isPresent = <T,>(value: T | null | undefined): boolean => value !== undefined && value !== null

/**
 * dnSpy's `FieldOptionsVM.InitializeFrom`: the word is taken as it came, but the bits a value stands for
 * are read off the value — a row whose attributes say HasDefault but that carries no constant opens with
 * the checkbox off, and one that carries a constant with the bit clear opens with it on.
 */
export const fieldOptionsDraft = (dto: FieldOptionsDto): FieldOptionsDraft => ({
  attributes: withFieldFlag(
    withFieldFlag(
      withFieldFlag(
        withFieldFlag(dto.attributes, FIELD_ATTRIBUTES.HasFieldMarshal, isPresent(dto.marshalType)),
        FIELD_ATTRIBUTES.HasDefault,
        isPresent(dto.constant),
      ),
      FIELD_ATTRIBUTES.PinvokeImpl,
      isPresent(dto.implMap),
    ),
    FIELD_ATTRIBUTES.HasFieldRVA,
    isPresent(dto.initialValue),
  ),
  name: dto.name,
  // A field the backend had nothing for arrives as a null, and a draft says "nothing" with undefined: the
  // two mean the same thing here, and only one of them is what the editors are written against.
  fieldSig: dto.fieldSig ?? undefined,
  fieldOffset: dto.fieldOffset === undefined || dto.fieldOffset === null ? '' : formatNumberText(dto.fieldOffset),
  marshalType: dto.marshalType ?? undefined,
  // The bit and the bytes are read together: a row whose attributes say HasFieldRVA but that carries no
  // bytes has no initial value to show, and one that carries the bytes has one whether or not the bit is
  // set. An initial value of no bytes at all would be the one case this cannot tell apart, and the
  // backend carries it as an empty string rather than as nothing, which is what the presence test reads.
  hasFieldRVA: isPresent(dto.initialValue),
  initialValue: isPresent(dto.initialValue) ? hexOfRawData(dto.initialValue as string) : '',
  implMap: dto.implMap ?? undefined,
  constant: dto.constant ?? null,
  rva: formatNumberText(dto.rva ?? 0),
  customAttributes: dto.customAttributes.map(customAttributeDraft),
})

/** What the Offset box reads as, or undefined while it holds something that is not a number. */
export const fieldOffsetValue = (text: string): number | undefined => parseNumberText(text, FIELD_NUMBER_MAX).value

/** The bits the field is written with. The three derived ones are taken from the values rather than from
 * the word, which is what dnSpy's `CopyTo` does with them as it hands the options over. */
export const fieldAttributesOf = (draft: FieldOptionsDraft): number =>
  withFieldFlag(
    withFieldFlag(
      withFieldFlag(
        withFieldFlag(draft.attributes, FIELD_ATTRIBUTES.HasFieldMarshal, draft.marshalType !== undefined),
        FIELD_ATTRIBUTES.PinvokeImpl,
        draft.implMap !== undefined,
      ),
      FIELD_ATTRIBUTES.HasDefault,
      draft.constant !== null,
    ),
    FIELD_ATTRIBUTES.HasFieldRVA,
    draft.hasFieldRVA,
  )

/**
 * Only ever called on a draft that has been accepted, which is why text that does not read is an error
 * rather than a value: the dialog's OK button is disabled until it does.
 */
export const fieldOptionsDto = (draft: FieldOptionsDraft): FieldOptionsDto => {
  const rva = fieldOffsetValue(draft.rva)
  if (rva === undefined)
    throw new Error('A field needs an RVA.')
  return {
    attributes: fieldAttributesOf(draft),
    name: draft.name,
    fieldSig: draft.fieldSig,
    fieldOffset: fieldOffsetValue(draft.fieldOffset),
    marshalType: draft.marshalType,
    // dnSpy's `CopyTo`: the bytes are written only while the field has a field RVA, and an empty box is
    // an initial value of no bytes rather than none at all — which is what keeps the bit on when the
    // dialog is opened again. A box that does not read as hex is an error, so OK was disabled.
    initialValue: draft.hasFieldRVA ? rawDataOfHex(draft.initialValue) ?? '' : undefined,
    implMap: draft.implMap,
    constant: draft.constant ?? undefined,
    customAttributes: draft.customAttributes.map(customAttributeDto),
    rva,
  }
}

/** What would keep the backend from writing this field, which is dnSpy's `FieldOptionsVM.HasError`. */
export const fieldOptionsError = (draft: FieldOptionsDraft): CaError | undefined => {
  if (draft.fieldSig === undefined || !isTypeSigComplete(draft.fieldSig))
    return { template: 'A type is required' }
  const literal = draft.constant === null ? undefined : constantFailure(draft.constant)
  if (literal !== undefined)
    return literal
  if (draft.marshalType !== undefined) {
    const template = marshalTypeError(draft.marshalType)
    if (template !== undefined)
      return { template }
  }
  if (draft.hasFieldRVA && rawDataOfHex(draft.initialValue) === undefined)
    return { template: 'The initial value is not a string of hexadecimal bytes' }
  // An empty Offset box is the field having no offset, which is not an error; an empty RVA box is a
  // number that is not there, which is.
  const offset = draft.fieldOffset.trim().length === 0 ? undefined : unsignedIntegerFailure(draft.fieldOffset, FIELD_NUMBER_MAX)
  if (offset !== undefined)
    return offset
  return unsignedIntegerFailure(draft.rva, FIELD_NUMBER_MAX)
}
