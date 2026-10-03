import type { MethodSigDto, TreeNode, TypeRefDto, TypeSigDto } from '../../../../shared/protocol'

/** What a slot shows before anything has been picked for it. */
export const NOT_SET = '(not set)'

/**
 * The type of a node the picker returned: the node id it was picked by, since the workspace has already
 * resolved it, plus the name a lookup would need if that no longer holds. A type's label is its full
 * name, so the namespace in front of it is what a nested name has to lose.
 */
export const referenceOf = (node: TreeNode, trail: TreeNode[]): TypeRefDto => {
  const namespace = trail.find((entry) => entry.kind === 'namespace')?.label ?? ''
  const prefix = namespace.length === 0 ? '' : `${namespace}.`
  return {
    scope: trail.find((entry) => entry.kind === 'assemblyreference')?.label ?? '',
    namespace,
    name: node.label.startsWith(prefix) ? node.label.slice(prefix.length) : node.label,
    nodeId: node.id,
  }
}

/**
 * How dnlib writes a type reference: the namespace, then the name — which for a nested type is its path
 * from the outermost declaring type. This is the same text the backend puts in a signature's `display`,
 * so a preview composed here reads like one composed there.
 */
export const describeTypeRef = (type: TypeRefDto): string =>
  type.namespace.length === 0 ? type.name : `${type.namespace}.${type.name}`

/**
 * How dnlib writes a type signature, composed from the tree the dialog assembled. It is a preview only:
 * what the backend renders when it reads the value back is the one that counts.
 */
export const describeTypeSig = (value: TypeSigDto, notSet: string = NOT_SET): string => {
  const inner = (): string => value.element ? describeTypeSig(value.element, notSet) : notSet
  const modifier = (): string => value.modifier ? describeTypeSig(value.modifier, notSet) : notSet
  switch (value.kind) {
    case 'type': return value.type ? describeTypeRef(value.type) : notSet
    case 'genericInst': {
      const genericType = value.type ? describeTypeRef(value.type) : notSet
      return `${genericType}<${(value.arguments ?? []).map((argument) => describeTypeSig(argument, notSet)).join(',')}>`
    }
    case 'szarray': return `${inner()}[]`
    case 'array': return `${inner()}[${','.repeat(Math.max(0, (value.rank ?? 0) - 1))}]`
    case 'ptr': return `${inner()}*`
    case 'byref': return `${inner()}&`
    // A pinned signature is the signature it pins; dnlib spells it no differently.
    case 'pinned': return inner()
    case 'cmodreqd': return `${modifier()} modreq(${inner()})`
    case 'cmodopt': return `${modifier()} modopt(${inner()})`
    case 'genericvar': return `!${value.genericParameterNumber ?? 0}`
    case 'genericmvar': return `!!${value.genericParameterNumber ?? 0}`
    case 'fnptr': return `method ${value.functionPointer ? describeMethodSig(value.functionPointer, notSet) : notSet}`
    case 'empty': return notSet
  }
}

/** How dnlib writes a method signature: the return type, then the parameter types. A vararg signature
 * writes the sentinel as `...` between the two lists, which is where the caller's arguments end. */
export const describeMethodSig = (value: MethodSigDto, notSet: string = NOT_SET): string => {
  const parameters = value.parameters.map((parameter) => describeTypeSig(parameter, notSet))
  const varArgs = (value.varArgParameters ?? []).map((parameter) => describeTypeSig(parameter, notSet))
  const all = varArgs.length === 0 ? parameters : [...parameters, '...', ...varArgs]
  return `${describeTypeSig(value.returnType, notSet)}(${all.join(',')})`
}

/**
 * Whether every slot of a signature holds something. A dialog will not accept a half-built one — dnSpy's
 * creator cannot even express one, since it hands back dnlib objects that are whole by construction —
 * and this is what stands in for that guarantee on this side of the wire.
 */
export const isTypeSigComplete = (value: TypeSigDto | null): boolean => {
  if (value === null || value.kind === 'empty')
    return false
  if (value.kind === 'type' && !value.type)
    return false
  if (value.kind === 'fnptr' && (!value.functionPointer || !isMethodSigComplete(value.functionPointer)))
    return false
  if (value.element && !isTypeSigComplete(value.element))
    return false
  if (value.modifier && !isTypeSigComplete(value.modifier))
    return false
  return (value.arguments ?? []).every(isTypeSigComplete)
}

export const isMethodSigComplete = (value: MethodSigDto): boolean =>
  isTypeSigComplete(value.returnType) &&
  value.parameters.every(isTypeSigComplete) &&
  (value.varArgParameters ?? []).every(isTypeSigComplete)
