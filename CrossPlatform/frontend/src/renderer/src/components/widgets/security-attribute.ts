import type { CaNamedArgumentDto, SecurityAttributeDto, TypeSigDto } from '../../../../shared/protocol'
import { caArgumentDisplay, caArgumentError, type CaError } from './ca-value'
import { describeTypeSig, isTypeSigComplete, NOT_SET } from './type-sig-text'

/**
 * A security attribute — one demand inside a declarative security row — while a dialog has it open.
 *
 * Unlike a custom attribute it has no constructor: the type *is* the attribute, and every value it sets
 * is a named field or property. The named arguments are the wire's own values rather than drafts,
 * because their rows edit in place — see `CaNamedArgumentListEditor`.
 */
export interface SecurityAttributeDraft {
  /** dnSpy's picker offers type definitions only, so this is a plain type and never a constructed one.
   * It is null until one has been picked. */
  attributeType: TypeSigDto | null
  namedArguments: CaNamedArgumentDto[]
}

export const securityAttributeDraft = (dto: SecurityAttributeDto): SecurityAttributeDraft => ({
  attributeType: dto.attributeType,
  namedArguments: dto.namedArguments,
})

/** Only ever called on a draft that has been accepted, which is why a missing type is an error rather
 * than a value: the dialog's OK button is disabled until one is there. */
export const securityAttributeDto = (draft: SecurityAttributeDraft): SecurityAttributeDto => {
  if (draft.attributeType === null)
    throw new Error('A security attribute needs a type.')
  return { attributeType: draft.attributeType, namedArguments: draft.namedArguments }
}

/**
 * The row's text, which is dnSpy's `SecurityAttributeVM.FullName`: the attribute's type and the values it
 * sets, or the placeholder for a row whose type has not been picked yet — dnSpy's own `<<<null>>>`,
 * three brackets a side, which is not the `<<no-name>>` a nameless row gets elsewhere.
 */
export const securityAttributeLabel = (draft: SecurityAttributeDraft): string =>
  `${draft.attributeType === null ? '<<<null>>>' : describeTypeSig(draft.attributeType, NOT_SET)}(${draft.namedArguments.map((named) => `${named.name} = ${caArgumentDisplay(named.argument)}`).join(', ')})`

/** A fresh row for the list's Add... button, which is `new SecurityAttribute()`: a row with no type and
 * nothing named — dnSpy's own constructor takes the type as an argument and this is what it passes. */
export const newSecurityAttribute = (): SecurityAttributeDraft => ({ attributeType: null, namedArguments: [] })

/** What would keep the backend from writing this row, which is `SecurityAttributeVM.HasError`: a type
 * that is not there, or a named argument whose value the backend's parser would not read. */
export const securityAttributeError = (draft: SecurityAttributeDraft): CaError | undefined => {
  if (!isTypeSigComplete(draft.attributeType))
    return { template: 'A type is required' }
  for (const named of draft.namedArguments) {
    const error = caArgumentError(named.argument)
    if (error)
      return error
  }
  return undefined
}
