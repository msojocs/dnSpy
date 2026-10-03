/**
 * dnSpy's `PropertyDefOptions` as the property dialog edits it: the name and the attribute word, the
 * signature, the default value, the three accessor lists and the custom attributes.
 *
 * One bit of the attribute word is not a box. `HasDefault` follows the constant it belongs to, the way
 * `PropertyOptionsVM`'s setter does with its `ConstantVM.IsEnabled` — a row whose word says HasDefault
 * but that carries no constant opens with the checkbox off, and the constant is what is written back.
 */

import type { AccessorRefDto, ConstantDto, PropertyOptionsDto, PropertySigDto } from '../../../../shared/protocol'
import type { AccessorRefRow } from './accessor-ref'
import type { CaError } from './ca-value'
import { constantFailure } from './ConstantEditor'
import { customAttributeDraft, customAttributeDto, type CustomAttributeDraft } from './custom-attribute'
import { isTypeSigComplete } from './type-sig-text'

/** dnlib's `PropertyAttributes`, which is the two flag boxes and the derived `HasDefault` bit. */
export const PROPERTY_ATTRIBUTES = {
  SpecialName: 0x0200,
  RTSpecialName: 0x0400,
  HasDefault: 0x1000,
} as const

/** The Flags box, in the order the XAML lays its two checkboxes out. */
export const PROPERTY_FLAGS: { label: string, flag: number }[] = [
  { label: 'SpecialName', flag: PROPERTY_ATTRIBUTES.SpecialName },
  { label: 'RTSpecialName', flag: PROPERTY_ATTRIBUTES.RTSpecialName },
]

export const hasPropertyFlag = (attributes: number, flag: number): boolean => (attributes & flag) !== 0

export const withPropertyFlag = (attributes: number, flag: number, on: boolean): number =>
  on ? attributes | flag : attributes & ~flag

/** A property row while a dialog has it open. */
export interface PropertyOptionsDraft {
  attributes: number
  name: string
  /** The signature, or undefined while it has not been built — which is what leaves OK disabled. */
  propertySig?: PropertySigDto
  /** The default value, which the HasDefault bit goes with — null when its checkbox is off. */
  constant: ConstantDto | null
  getMethods: AccessorRefRow[]
  setMethods: AccessorRefRow[]
  otherMethods: AccessorRefRow[]
  customAttributes: CustomAttributeDraft[]
}

const isPresent = <T,>(value: T | null | undefined): boolean => value !== undefined && value !== null

/**
 * dnSpy's `PropertyOptionsVM.InitializeFrom`: the word is taken as it came, but `HasDefault` is read off
 * the constant, so a row whose attributes say one thing and whose model says another opens on the model.
 */
export const propertyOptionsDraft = (dto: PropertyOptionsDto): PropertyOptionsDraft => ({
  attributes: withPropertyFlag(dto.attributes, PROPERTY_ATTRIBUTES.HasDefault, isPresent(dto.constant)),
  name: dto.name,
  propertySig: dto.propertySig ?? undefined,
  constant: dto.constant ?? null,
  getMethods: dto.getMethods ?? [],
  setMethods: dto.setMethods ?? [],
  otherMethods: dto.otherMethods ?? [],
  customAttributes: (dto.customAttributes ?? []).map(customAttributeDraft),
})

/** Whether every slot of the signature holds something, which is dnSpy's `MethodSigCreator.HasError`
 * standing in for a creator that cannot build a half-built signature in the first place. */
const isPropertySigComplete = (signature: PropertySigDto | undefined): boolean =>
  signature !== undefined &&
  isTypeSigComplete(signature.propertyType) &&
  signature.parameters.every(isTypeSigComplete)

/** The bits the property is written with. `HasDefault` comes from the constant rather than from the
 * word, which is what dnSpy's `PropertyOptionsVM.CopyTo` does with it as it hands the options over. */
export const propertyAttributesOf = (draft: PropertyOptionsDraft): number =>
  withPropertyFlag(draft.attributes, PROPERTY_ATTRIBUTES.HasDefault, draft.constant !== null)

/** The rows that were actually filled in, since a row the user opened the picker on and dismissed is
 * not a method. */
const accessors = (rows: AccessorRefRow[]): AccessorRefDto[] => rows.filter((row): row is AccessorRefDto => row !== undefined)

/** Only ever called on a draft that has been accepted, which is why an unfinished signature is an error
 * rather than a value: the dialog's OK button is disabled until it is whole. */
export const propertyOptionsDto = (draft: PropertyOptionsDraft): PropertyOptionsDto => ({
  attributes: propertyAttributesOf(draft),
  name: draft.name,
  propertySig: draft.propertySig,
  constant: draft.constant ?? undefined,
  getMethods: accessors(draft.getMethods),
  setMethods: accessors(draft.setMethods),
  otherMethods: accessors(draft.otherMethods),
  customAttributes: draft.customAttributes.map(customAttributeDto),
})

/** What would keep the backend from writing this property, which is dnSpy's `PropertyOptionsVM.HasError`. */
export const propertyOptionsError = (draft: PropertyOptionsDraft): CaError | undefined => {
  if (!isPropertySigComplete(draft.propertySig))
    return { template: 'The property signature is incomplete' }
  if (draft.constant !== null)
    return constantFailure(draft.constant)
  return undefined
}
