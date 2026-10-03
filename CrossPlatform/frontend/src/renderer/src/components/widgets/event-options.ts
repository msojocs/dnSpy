/**
 * dnSpy's `EventDefOptions` as the event dialog edits it: the name and the attribute word, the event
 * type, the three accessor methods and the remaining lists.
 *
 * Both bits of the attribute word are boxes — unlike a property there is nothing derived to follow — and
 * the dialog has no error of its own, which is what `EventOptionsVM` says by not overriding `HasError`:
 * an event with no type is written as one with no type rather than held back.
 */

import type { AccessorRefDto, EventOptionsDto, TypeSigDto } from '../../../../shared/protocol'
import type { AccessorRefRow } from './accessor-ref'
import { customAttributeDraft, customAttributeDto, type CustomAttributeDraft } from './custom-attribute'

/** dnlib's `EventAttributes`. */
export const EVENT_ATTRIBUTES = {
  SpecialName: 0x0200,
  RTSpecialName: 0x0400,
} as const

/** The Flags box, in the order the XAML lays its two checkboxes out. */
export const EVENT_FLAGS: { label: string, flag: number }[] = [
  { label: 'SpecialName', flag: EVENT_ATTRIBUTES.SpecialName },
  { label: 'RTSpecialName', flag: EVENT_ATTRIBUTES.RTSpecialName },
]

export const hasEventFlag = (attributes: number, flag: number): boolean => (attributes & flag) !== 0

export const withEventFlag = (attributes: number, flag: number, on: boolean): number =>
  on ? attributes | flag : attributes & ~flag

/** An event row while a dialog has it open. */
export interface EventOptionsDraft {
  attributes: number
  name: string
  /** The event's type — a delegate, or nothing at all, since the dialog holds nothing back on it. */
  eventType?: TypeSigDto
  addMethod?: AccessorRefRow
  invokeMethod?: AccessorRefRow
  removeMethod?: AccessorRefRow
  otherMethods: AccessorRefRow[]
  customAttributes: CustomAttributeDraft[]
}

export const eventOptionsDraft = (dto: EventOptionsDto): EventOptionsDraft => ({
  attributes: dto.attributes,
  name: dto.name,
  eventType: dto.eventType ?? undefined,
  addMethod: dto.addMethod,
  invokeMethod: dto.invokeMethod,
  removeMethod: dto.removeMethod,
  otherMethods: dto.otherMethods ?? [],
  customAttributes: (dto.customAttributes ?? []).map(customAttributeDraft),
})

/** The rows that were actually filled in, since a row the user opened the picker on and dismissed is
 * not a method. */
const accessors = (rows: AccessorRefRow[]): AccessorRefDto[] => rows.filter((row): row is AccessorRefDto => row !== undefined)

export const eventOptionsDto = (draft: EventOptionsDraft): EventOptionsDto => ({
  attributes: draft.attributes,
  name: draft.name,
  eventType: draft.eventType,
  addMethod: draft.addMethod,
  invokeMethod: draft.invokeMethod,
  removeMethod: draft.removeMethod,
  otherMethods: accessors(draft.otherMethods),
  customAttributes: draft.customAttributes.map(customAttributeDto),
})
