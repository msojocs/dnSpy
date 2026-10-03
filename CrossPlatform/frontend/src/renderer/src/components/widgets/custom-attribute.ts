import type { CaArgumentDto, CaNamedArgumentDto, CustomAttributeDto, MethodRefDto, TypeSigDto } from '../../../../shared/protocol'
import { caArgumentDisplay, caArgumentError, caDefaultForType, type CaError } from './ca-value'
import { describeTypeSig, NOT_SET } from './type-sig-text'

/**
 * A custom attribute while a dialog has it open. It is the DTO minus the constructor's guarantee: dnSpy's
 * `CustomAttributeVM` starts with no constructor at all and refuses to be accepted until one is picked,
 * so the one field that may be missing is kept missing here rather than filled with a placeholder that
 * would have to be remembered not to send.
 */
export interface CustomAttributeDraft {
  constructor?: MethodRefDto
  constructorArguments: CaArgumentDto[]
  namedArguments: CaNamedArgumentDto[]
}

export const customAttributeDraft = (dto: CustomAttributeDto): CustomAttributeDraft => ({
  constructor: dto.constructor,
  constructorArguments: dto.constructorArguments,
  namedArguments: dto.namedArguments,
})

/** Only ever called on a draft that has been accepted, which is why a missing constructor is an error
 * rather than a value: the dialog's OK button is disabled until one is there. */
export const customAttributeDto = (draft: CustomAttributeDraft): CustomAttributeDto => {
  if (draft.constructor === undefined)
    throw new Error('A custom attribute needs a constructor.')
  return {
    constructor: draft.constructor,
    constructorArguments: draft.constructorArguments,
    namedArguments: draft.namedArguments,
  }
}

/**
 * The row's text: the attribute's type and its values, the way dnSpy's `CustomAttributeVM.FullName`
 * composes it. It is the type rather than the constructor's whole signature — what is worth reading in a
 * list is what the attribute sets, not the parameters it could have taken — and the named arguments run
 * on after the positional ones, as `CANamedArgumentVM.ToString` writes them.
 */
export const customAttributeLabel = (draft: CustomAttributeDraft): string => {
  if (draft.constructor === undefined)
    return NOT_SET
  const values = [
    ...draft.constructorArguments.map(caArgumentDisplay),
    ...draft.namedArguments.map((named) => `${named.name} = ${caArgumentDisplay(named.argument)}`),
  ]
  return `${describeTypeSig(draft.constructor.declaringType)}(${values.join(', ')})`
}

/** What would have to change for the backend to accept this attribute: a constructor, and a value the
 * backend's own parser would read for every argument it has. */
export const customAttributeError = (draft: CustomAttributeDraft): CaError | undefined => {
  if (draft.constructor === undefined)
    return { template: 'Pick a Constructor' }
  for (const argument of draft.constructorArguments) {
    const error = caArgumentError(argument)
    if (error)
      return error
  }
  for (const named of draft.namedArguments) {
    const error = caArgumentError(named.argument)
    if (error)
      return error
  }
  return undefined
}

/**
 * The values a constructor's parameters start at, which is what dnSpy builds when the constructor
 * changes: `CustomAttributeVM.CreateArguments` drops every argument and makes one per parameter again,
 * so an attribute that has just been pointed at a different constructor has no values to keep.
 */
export const customAttributeArguments = (constructor: MethodRefDto): CaArgumentDto[] =>
  constructor.signature.parameters.map((parameter) => ({ type: parameter, value: caDefaultForType(parameter) }))

/** A fresh named argument, which is dnSpy's `CANamedArgumentsVM.Create`: a property of type `Int32`
 * called `AttributeProperty`, holding zero. */
export const newNamedArgument = (): CaNamedArgumentDto => {
  const type: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }
  return { isField: false, name: 'AttributeProperty', argument: { type, value: caDefaultForType(type) } }
}

/** A fresh attribute for the list's Add... button: nothing picked, nothing to hold. The absent
 * constructor is written out rather than left off, which an object literal would otherwise read as the
 * `constructor` every object inherits. */
export const newCustomAttribute = (): CustomAttributeDraft => ({
  constructor: undefined,
  constructorArguments: [],
  namedArguments: [],
})
