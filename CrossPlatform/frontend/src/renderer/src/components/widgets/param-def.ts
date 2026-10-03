import type { ConstantDto, MarshalTypeDto, ParamDefDto } from '../../../../shared/protocol'
import type { CaError } from './ca-value'
import { constantFailure } from './ConstantEditor'
import { customAttributeDraft, customAttributeDto, type CustomAttributeDraft } from './custom-attribute'
import { marshalTypeError } from './marshal-type'
import { formatNumberText, parseNumberText, unsignedIntegerFailure } from './number-text'

/** dnlib's `ParamAttributes`, which is the flags groupbox and the two checkboxes under it. */
export const PARAM_ATTRIBUTES = {
  In: 0x0001,
  Out: 0x0002,
  Lcid: 0x0004,
  Retval: 0x0008,
  Optional: 0x0010,
  HasDefault: 0x1000,
  HasFieldMarshal: 0x2000,
} as const

/** What the Sequence box holds: a parameter's sequence is a `ushort`. */
export const SEQUENCE_MAX = 0xFFFF

/** The flags groupbox, in the order dnSpy's five checkboxes are laid out in. */
export const PARAM_FLAGS: { label: string, flag: number }[] = [
  { label: 'In', flag: PARAM_ATTRIBUTES.In },
  { label: 'Out', flag: PARAM_ATTRIBUTES.Out },
  { label: 'Lcid', flag: PARAM_ATTRIBUTES.Lcid },
  { label: 'Retval', flag: PARAM_ATTRIBUTES.Retval },
  { label: 'Optional', flag: PARAM_ATTRIBUTES.Optional },
]

/** The text a row shows while its sequence is not a number, which is dnSpy's own `???`. */
const BAD_SEQUENCE = '???'

/**
 * A parameter row while a dialog has it open. It is the DTO with one field turned into text: dnSpy's
 * sequence box is a `UInt16VM`, whose `StringValue` is what the user is typing — text that is not a
 * sequence is a state the row can be in, and the OK button is what keeps it from being written.
 */
export interface ParamDefDraft {
  name: string
  /** What the Sequence box holds, which is text and not a number. */
  sequence: string
  attributes: number
  /** The default value, which the HasDefault bit goes with — null when its checkbox is off. */
  constant: ConstantDto | null
  /** The marshalling, which the HasFieldMarshal bit goes with — undefined when its Enable box is off. */
  marshalType: MarshalTypeDto | undefined
  customAttributes: CustomAttributeDraft[]
}

export const hasParamFlag = (attributes: number, flag: number): boolean => (attributes & flag) !== 0

export const withParamFlag = (attributes: number, flag: number, on: boolean): number =>
  on ? attributes | flag : attributes & ~flag

/** Whether a value arrived at all, since a row's DTO may leave one out and JSON may send it as null. */
const isPresent = <T,>(value: T | null | undefined): boolean => value !== undefined && value !== null

/**
 * dnSpy's `ParamDefVM.InitializeFrom`: the word is taken as it came, but the two bits that a value
 * stands for are read off the value rather than off the word — a row whose attributes say HasDefault but
 * that carries no constant opens with the checkbox off, and one that carries a constant with the bit
 * clear opens with it on.
 */
export const paramDefDraft = (dto: ParamDefDto): ParamDefDraft => ({
  name: dto.name,
  sequence: formatNumberText(dto.sequence),
  attributes: withParamFlag(
    withParamFlag(dto.attributes, PARAM_ATTRIBUTES.HasDefault, isPresent(dto.constant)),
    PARAM_ATTRIBUTES.HasFieldMarshal,
    isPresent(dto.marshalType),
  ),
  constant: dto.constant ?? null,
  // A field the backend had nothing for arrives as a null, and a draft says "nothing" with undefined:
  // the two mean the same thing here, and only one of them is what the editors are written against.
  marshalType: dto.marshalType ?? undefined,
  customAttributes: dto.customAttributes.map(customAttributeDraft),
})

/** What the Sequence box reads as, or undefined while it holds something that is not a sequence. */
export const sequenceValue = (text: string): number | undefined => parseNumberText(text, SEQUENCE_MAX).value

/** The bits the row is written with, which `CopyTo` takes from the two checkboxes rather than from the
 * word: a value that is there is what the bit says. */
const writtenAttributes = (draft: ParamDefDraft): number =>
  withParamFlag(
    withParamFlag(draft.attributes, PARAM_ATTRIBUTES.HasDefault, draft.constant !== null),
    PARAM_ATTRIBUTES.HasFieldMarshal,
    draft.marshalType !== undefined,
  )

/** Only ever called on a draft that has been accepted, which is why a sequence that does not read is an
 * error rather than a value: the dialog's OK button is disabled until it does. */
export const paramDefDto = (draft: ParamDefDraft): ParamDefDto => {
  const sequence = sequenceValue(draft.sequence)
  if (sequence === undefined)
    throw new Error('A parameter needs a sequence number.')
  return {
    name: draft.name,
    sequence,
    attributes: writtenAttributes(draft),
    constant: draft.constant ?? undefined,
    marshalType: draft.marshalType,
    customAttributes: draft.customAttributes.map(customAttributeDto),
  }
}

/**
 * The row's text, which is dnSpy's `ParamDefVM.FullName`: the sequence as it names a parameter — the
 * return value is 0 and the first parameter is 1 — and then the name, or the placeholder for one that
 * has none. It is composed here rather than taken from the DTO's `display` because it is the sequence
 * *box's* text that decides it: a row being typed into is a row whose sequence is not a number yet.
 */
export const paramDefLabel = (draft: ParamDefDraft): string => {
  const sequence = sequenceValue(draft.sequence)
  const position = sequence === undefined ? BAD_SEQUENCE : sequence === 0 ? 'param(return)' : `param(${sequence})`
  return `${position} ${draft.name.length > 0 ? draft.name : '<<no-name>>'}`
}

/** A fresh row for the list's Add... button, which is `new ParamDefOptions()`: the return value, with
 * nothing said about it. It is dnSpy's own default and not a placeholder — that is the row it writes. */
export const newParamDef = (): ParamDefDraft => ({
  name: '',
  sequence: '0',
  attributes: 0,
  constant: null,
  marshalType: undefined,
  customAttributes: [],
})

const asError = (message: string | undefined): CaError | undefined =>
  message === undefined ? undefined : { template: message }

/**
 * What would keep the backend from writing this row, which is `ParamDefVM.HasError` field for field: the
 * default value's own error, the marshalling's, and a sequence box that does not hold a sequence. The
 * custom attributes are not checked here — that dialog gates its own OK button.
 */
export const paramDefError = (draft: ParamDefDraft): CaError | undefined =>
  (draft.constant === null ? undefined : constantFailure(draft.constant)) ??
  (draft.marshalType === undefined ? undefined : asError(marshalTypeError(draft.marshalType))) ??
  unsignedIntegerFailure(draft.sequence, SEQUENCE_MAX)
