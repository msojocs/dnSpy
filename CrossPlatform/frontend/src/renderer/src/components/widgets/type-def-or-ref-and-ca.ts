import type { CustomAttributeDto, TypeDefOrRefAndCaDto, TypeSigDto } from '../../../../shared/protocol'
import type { CaError } from './ca-value'
import { customAttributeDraft, customAttributeDto, type CustomAttributeDraft } from './custom-attribute'
import { describeTypeSig, isTypeSigComplete, NOT_SET } from './type-sig-text'

/**
 * A row that is a type and the attributes on it, which is what a generic parameter's constraint and an
 * implemented interface both are — dnSpy edits the two with the same control.
 *
 * The type is missing rather than empty while the row is being built: dnSpy's `TypeSigCreator` starts
 * with no signature at all, and `HasError` is what keeps such a row from being accepted.
 */
export interface TypeDefOrRefAndCaDraft {
  type: TypeSigDto | null
  customAttributes: CustomAttributeDraft[]
}

export const typeDefOrRefAndCaDraft = (dto: TypeDefOrRefAndCaDto): TypeDefOrRefAndCaDraft => ({
  type: dto.typeDefOrRef,
  customAttributes: dto.customAttributes.map(customAttributeDraft),
})

/** Only ever called on a draft that has been accepted, which is why a missing type is an error rather
 * than a value: the dialog's OK button is disabled until one is there. */
export const typeDefOrRefAndCaDto = (draft: TypeDefOrRefAndCaDraft): TypeDefOrRefAndCaDto => {
  if (draft.type === null)
    throw new Error('A constraint or an interface needs a type.')
  return { typeDefOrRef: draft.type, customAttributes: draft.customAttributes.map(customAttributeDto) }
}

/** The row's text, which is dnSpy's `TypeDefOrRefAndCAVM.FullName`: the type and nothing else — what
 * the row is worth reading for is what it names, not the attributes on it. */
export const typeDefOrRefAndCaLabel = (draft: TypeDefOrRefAndCaDraft): string =>
  draft.type === null ? NOT_SET : describeTypeSig(draft.type, NOT_SET)

/** A fresh row for the list's Add... button: nothing named, nothing said about it. */
export const newTypeDefOrRefAndCa = (): TypeDefOrRefAndCaDraft => ({ type: null, customAttributes: [] })

/** What would keep the backend from writing this row: a type that is only half built. The custom
 * attributes are not checked here — that dialog gates its own OK button. */
export const typeDefOrRefAndCaError = (draft: TypeDefOrRefAndCaDraft): CaError | undefined =>
  isTypeSigComplete(draft.type) ? undefined : { template: 'A type is required' }
