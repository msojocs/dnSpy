import type { GenericParamConstraintDto, GenericParamDto, TypeSigDto } from '../../../../shared/protocol'
import type { CaError } from './ca-value'
import { customAttributeDraft, customAttributeDto, type CustomAttributeDraft } from './custom-attribute'
import { formatNumberText, parseNumberText, unsignedIntegerFailure } from './number-text'
import { typeDefOrRefAndCaDraft, typeDefOrRefAndCaDto, type TypeDefOrRefAndCaDraft } from './type-def-or-ref-and-ca'

/** dnlib's `GenericParamAttributes`, which is the variance combo, the constraints groupbox and the
 * `Allows ByRefLike` box under it. */
export const GENERIC_PARAM_ATTRIBUTES = {
  VarianceMask: 0x0003,
  NonVariant: 0x0000,
  Covariant: 0x0001,
  Contravariant: 0x0002,
  ReferenceTypeConstraint: 0x0004,
  NotNullableValueTypeConstraint: 0x0008,
  DefaultConstructorConstraint: 0x0010,
  AllowByRefLike: 0x0020,
} as const

/** What the Number box holds: a generic parameter's number is a `ushort`. */
export const GENERIC_PARAM_NUMBER_MAX = 0xFFFF

/**
 * The variance combo, which dnSpy builds by reflecting over its own `GPVariance` enum: the three names
 * are the enum's fields in the order they are declared there, and each value is the masked bits.
 */
export const GP_VARIANCES: { label: string, value: number }[] = [
  { label: 'NonVariant', value: GENERIC_PARAM_ATTRIBUTES.NonVariant },
  { label: 'Covariant', value: GENERIC_PARAM_ATTRIBUTES.Covariant },
  { label: 'Contravariant', value: GENERIC_PARAM_ATTRIBUTES.Contravariant },
]

/** The constraints groupbox, in the order dnSpy's four checkboxes are laid out in. */
export const GENERIC_PARAM_FLAGS: { label: string, flag: number }[] = [
  { label: 'Class', flag: GENERIC_PARAM_ATTRIBUTES.ReferenceTypeConstraint },
  { label: 'Struct', flag: GENERIC_PARAM_ATTRIBUTES.NotNullableValueTypeConstraint },
  { label: 'Default ctor', flag: GENERIC_PARAM_ATTRIBUTES.DefaultConstructorConstraint },
  { label: 'Allows ByRefLike', flag: GENERIC_PARAM_ATTRIBUTES.AllowByRefLike },
]

export const hasGenericParamFlag = (attributes: number, flag: number): boolean => (attributes & flag) !== 0

export const withGenericParamFlag = (attributes: number, flag: number, on: boolean): number =>
  on ? attributes | flag : attributes & ~flag

/** Which of the three the combo is on, which is the low bits of the word and nothing else. */
export const varianceOf = (attributes: number): number => attributes & GENERIC_PARAM_ATTRIBUTES.VarianceMask

/**
 * The word with the low bits replaced, which is `GenericParamVM.Attributes`' own setter: the variance
 * comes from the combo and every other bit is left where it was.
 */
export const withVariance = (attributes: number, variance: number): number =>
  (attributes & ~GENERIC_PARAM_ATTRIBUTES.VarianceMask) | (variance & GENERIC_PARAM_ATTRIBUTES.VarianceMask)

/** The text a row shows while its number is not a number, which is dnSpy's own `???`. */
const BAD_NUMBER = '???'

/**
 * A generic parameter row while a dialog has it open. It is the DTO with one field turned into text:
 * dnSpy's number box is a `UInt16VM`, whose `StringValue` is what the user is typing — text that is not
 * a number is a state the row can be in, and the OK button is what keeps it from being written.
 */
export interface GenericParamDraft {
  name: string
  /** What the Number box holds, which is text and not a number. */
  number: string
  attributes: number
  /** The `Kind` page's type: dnSpy's editor for it, and one no runtime ever reads — see the tab's
   * tooltip. It is null until a signature has been picked. */
  kind: TypeSigDto | null
  constraints: TypeDefOrRefAndCaDraft[]
  customAttributes: CustomAttributeDraft[]
}

/**
 * A constraint is the same row as an implemented interface — a type and the attributes on it — so the
 * two are the same draft, and only the DTO's field name differs.
 */
const constraintDraft = (dto: GenericParamConstraintDto): TypeDefOrRefAndCaDraft =>
  typeDefOrRefAndCaDraft({ typeDefOrRef: dto.constraint, customAttributes: dto.customAttributes })

const constraintDto = (draft: TypeDefOrRefAndCaDraft): GenericParamConstraintDto => {
  const written = typeDefOrRefAndCaDto(draft)
  return { constraint: written.typeDefOrRef, customAttributes: written.customAttributes }
}

export const genericParamDraft = (dto: GenericParamDto): GenericParamDraft => ({
  name: dto.name,
  number: formatNumberText(dto.number),
  attributes: dto.flags,
  kind: dto.kind ?? null,
  constraints: dto.constraints.map(constraintDraft),
  customAttributes: dto.customAttributes.map(customAttributeDraft),
})

/** What the Number box reads as, or undefined while it holds something that is not a number. */
export const genericParamNumber = (text: string): number | undefined =>
  parseNumberText(text, GENERIC_PARAM_NUMBER_MAX).value

/** Only ever called on a draft that has been accepted, which is why a number that does not read is an
 * error rather than a value: the dialog's OK button is disabled until it does. */
export const genericParamDto = (draft: GenericParamDraft): GenericParamDto => {
  const number = genericParamNumber(draft.number)
  if (number === undefined)
    throw new Error('A generic parameter needs a number.')
  return {
    number,
    flags: draft.attributes,
    name: draft.name,
    kind: draft.kind ?? undefined,
    constraints: draft.constraints.map(constraintDto),
    customAttributes: draft.customAttributes.map(customAttributeDto),
  }
}

/**
 * The row's text, which is dnSpy's `GenericParamVM.FullName`: the number as it names a parameter, and
 * then the name, or the placeholder for one that has none. It is composed here rather than taken from
 * the DTO's `display` because it is the number *box's* text that decides it: a row being typed into is
 * a row whose number is not a number yet.
 */
export const genericParamLabel = (draft: GenericParamDraft): string => {
  const number = genericParamNumber(draft.number)
  return `gparam(${number === undefined ? BAD_NUMBER : number}) ${draft.name.length > 0 ? draft.name : '<<no-name>>'}`
}

/** A fresh row for the list's Add... button, which is `new GenericParamOptions()`: the first parameter,
 * with nothing said about it. It is dnSpy's own default and not a placeholder — that is the row it
 * writes. */
export const newGenericParam = (): GenericParamDraft => ({
  name: '',
  number: '0',
  attributes: 0,
  kind: null,
  constraints: [],
  customAttributes: [],
})

/** What would keep the backend from writing this row, which is `GenericParamVM.HasError`: the number box
 * and nothing else. The constraints and the attributes are not checked here — each of those dialogs
 * gates its own OK button. */
export const genericParamError = (draft: GenericParamDraft): CaError | undefined =>
  unsignedIntegerFailure(draft.number, GENERIC_PARAM_NUMBER_MAX)
