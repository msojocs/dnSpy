import type { MethodOverrideDto, MethodRefDto } from '../../../../shared/protocol'
import { methodRefLabel } from './method-ref'
import { NOT_SET } from './type-sig-text'

/**
 * A method override while a dialog has it open, which is the DTO minus everything a row that has just
 * been added does not have. dnSpy's `MethodOverrideOptions` starts with both halves null and the picker
 * that follows fills in the declaration, so the one field a row is written from may be missing until
 * then; the body is missing for a different reason — a row being added overrides the method the dialog
 * belongs to, and the backend is what knows which method that is.
 */
export interface MethodOverrideDraft {
  methodBody?: MethodRefDto
  methodDeclaration?: MethodRefDto
}

export const methodOverrideDraft = (dto: MethodOverrideDto): MethodOverrideDraft => ({
  // A row the backend has half of arrives with a null where the other half is, and a draft says the
  // same thing with undefined.
  methodBody: dto.methodBody ?? undefined,
  methodDeclaration: dto.methodDeclaration ?? undefined,
})

/** Only ever called on a row that has been accepted, which is why a missing declaration is an error
 * rather than a value: Add... opens the picker before anything is written into the list. */
export const methodOverrideDto = (draft: MethodOverrideDraft): MethodOverrideDto => {
  if (draft.methodDeclaration === undefined)
    throw new Error('A method override needs a declaration.')
  return { methodBody: draft.methodBody, methodDeclaration: draft.methodDeclaration }
}

/**
 * The row's text, which dnSpy's `MethodOverrideVM.FullName` takes from the declaration alone — the
 * body is not shown, so an override whose body changed reads the same. The backend fills the same text
 * into the field `display`; a row that has only just been picked composes it here.
 */
export const methodOverrideLabel = (draft: MethodOverrideDraft): string =>
  draft.methodDeclaration === undefined
    ? NOT_SET
    : methodRefLabel(draft.methodDeclaration)

/** A fresh row for the list's Add... button: nothing picked, nothing overridden. */
export const newMethodOverride = (): MethodOverrideDraft => ({})
