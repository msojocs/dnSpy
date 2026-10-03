import type { MethodOptionsDto, MethodRefDto, TreeNode } from '../../../../shared/protocol'
import { describeTypeSig, referenceOf } from './type-sig-text'

/**
 * The method a picker returned, as a reference. `MethodRefDto` carries a name and a full signature
 * rather than a node id, so both come from the method's own options — the type it was found under is
 * the trail's last type, which is what the picker keeps one of in every mode.
 */
export const pickedMethodRef = (trail: TreeNode[], method: MethodOptionsDto): MethodRefDto | undefined => {
  const typeNode = [...trail].reverse().find((entry) => entry.kind === 'type')
  if (!typeNode || !method.methodSig)
    return undefined
  return {
    declaringType: { kind: 'type', type: referenceOf(typeNode, trail) },
    name: method.name,
    signature: method.methodSig,
  }
}

/**
 * How a reference reads in the box beside a picker button — dnSpy's `Constructor.FullName`, which is the
 * declaring type followed by the parameters. The name is left out because the one method a custom
 * attribute picks is always a constructor, so there is nothing the name could tell the reader.
 */
export const methodRefDisplay = (reference: MethodRefDto): string =>
  `${describeTypeSig(reference.declaringType)}(${reference.signature.parameters.map((parameter) => describeTypeSig(parameter)).join(', ')})`

/**
 * A method reference the way dnlib writes a method's full name — the return type, the declaring type,
 * the name, then the parameter types. It is what an override's row shows, and what the backend puts in
 * a reference's own `display`; this is the same text composed here, for a row that was just picked and
 * has not been near the backend yet.
 */
export const methodRefFullName = (reference: MethodRefDto): string =>
  `${describeTypeSig(reference.signature.returnType)} ${describeTypeSig(reference.declaringType)}::${reference.name}(${reference.signature.parameters.map((parameter) => describeTypeSig(parameter)).join(',')})`

/**
 * How a reference reads as a row of a list: the same full name the backend puts in the field `display`
 * when it read the row, and composed here for one that was only just picked.
 */
export const methodRefLabel = (reference: MethodRefDto): string =>
  reference.display || methodRefFullName(reference)

/**
 * A row of dnSpy's `MethodDefsVM`, whose model is a nullable `MethodDef`: Add... opens the picker on a
 * row with nothing in it — the value `MethodDefVM.FullName` calls "null" — and the row reaches the list
 * only once a method has been picked, so the empty one never outlives the dialog that made it.
 */
export type MethodRefRow = MethodRefDto | undefined

/** The row's text, which is dnSpy's `MethodDefVM.FullName` down to what it says for an empty row. */
export const methodRefRowLabel = (row: MethodRefRow): string =>
  row === undefined ? 'null' : methodRefLabel(row)
