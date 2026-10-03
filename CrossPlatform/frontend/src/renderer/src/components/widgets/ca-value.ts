import type { CaArgumentDto, CaValueDto, TypeRefDto, TypeSigDto } from '../../../../shared/protocol'
import { constantTypeName, literalError } from './ConstantEditor'
import { describeTypeSig } from './type-sig-text'

/**
 * The vocabulary dnSpy's `ConstantTypeControl` edits a custom attribute value with, as far as the port
 * needs it on this side of the wire. The backend stores the same value as an `CaValueDto` — a shape with
 * a kind, not a type — so the two are converted here: the kind a value is *edited* as is the one its
 * declared type and shape imply, which is exactly what dnSpy's `CAArgumentVM.ConvertFromModel` works out.
 *
 * Which kinds are offered is dnSpy's own split. A constructor argument cannot have a null kind — the
 * constructor decides the type — and a named argument carries `Object` in the same place because it has
 * no constructor behind it to decide anything.
 */
export const CA_NULL = 'null'
export const CA_ENUM = 'Enum'
export const CA_TYPE = 'Type'
export const CA_OBJECT = 'Object'

/** A scalar kind: one of the corlib primitives a value can hold text for. */
export interface CaScalar {
  /** dnSpy's `ConstantType` member name, which is also what its combo shows. */
  id: string
  /** The name under `System` the backend rebuilds the declared type from. */
  corlib: string
  /** dnlib's `ElementType` for the values of this kind, which is how the backend reads the text back. */
  elementType: number
}

/** In dnSpy's `ConstantType` order, which is the order the kind combo shows them in. */
export const CA_SCALARS: CaScalar[] = [
  { id: 'Boolean', corlib: 'Boolean', elementType: 0x02 },
  { id: 'Char', corlib: 'Char', elementType: 0x03 },
  { id: 'SByte', corlib: 'SByte', elementType: 0x04 },
  { id: 'Byte', corlib: 'Byte', elementType: 0x05 },
  { id: 'Int16', corlib: 'Int16', elementType: 0x06 },
  { id: 'UInt16', corlib: 'UInt16', elementType: 0x07 },
  { id: 'Int32', corlib: 'Int32', elementType: 0x08 },
  { id: 'UInt32', corlib: 'UInt32', elementType: 0x09 },
  { id: 'Int64', corlib: 'Int64', elementType: 0x0A },
  { id: 'UInt64', corlib: 'UInt64', elementType: 0x0B },
  { id: 'Single', corlib: 'Single', elementType: 0x0C },
  { id: 'Double', corlib: 'Double', elementType: 0x0D },
  { id: 'String', corlib: 'String', elementType: 0x0E },
]

export const caScalar = (id: string): CaScalar | undefined => CA_SCALARS.find((scalar) => scalar.id === id)

export const caScalarOfElementType = (elementType: number): CaScalar | undefined =>
  CA_SCALARS.find((scalar) => scalar.elementType === elementType)

/** The kinds a list may offer: the array variants are every element kind with `[]` after it. */
const ARRAY_ELEMENTS = [CA_OBJECT, ...CA_SCALARS.map((scalar) => scalar.id), CA_ENUM, CA_TYPE]

/**
 * The kinds dnSpy's combo lists, in its order: the one entry that stands for "no value" (null for a
 * constructor argument, object for a named one), the scalars, the two that are picked rather than typed,
 * then every array.
 */
export const caKindList = (allowNull: boolean): string[] => [
  allowNull ? CA_NULL : CA_OBJECT,
  ...CA_SCALARS.map((scalar) => scalar.id),
  CA_ENUM,
  CA_TYPE,
  ...ARRAY_ELEMENTS.map((id) => `${id}[]`),
]

/** The kind an array holds its elements as, e.g. `Int32` for `Int32[]`; undefined for a plain kind. */
export const caArrayElementKind = (kind: string): string | undefined =>
  kind.endsWith('[]') ? kind.slice(0, -2) : undefined

// ---------------------------------------------------------------------------------------------------
// Building signatures
// ---------------------------------------------------------------------------------------------------

const typeRef = (name: string): TypeRefDto => ({ scope: '', namespace: 'System', name })

/**
 * A reference to one of the corlib's own types. The backend recognizes these by name — a primitive is a
 * shared signature singleton rather than a reference to a definition — so no scope is needed for them,
 * and `System.Type` is recognized by name for the same reason.
 */
export const corlibSig = (name: string, valueType: boolean): TypeSigDto =>
  ({ kind: 'type', type: typeRef(name), valueType })

export const systemObjectSig = (): TypeSigDto => corlibSig('Object', false)
export const systemTypeSig = (): TypeSigDto => corlibSig('Type', false)

/** The signature of an array of a type. dnSpy's constant kinds are all one-dimensional. */
export const szArraySig = (element: TypeSigDto): TypeSigDto => ({ kind: 'szarray', element })

/** The declared type each kind stands for. `Enum` is whatever the enum picker held, which is the
 * caller's to supply because the kind alone cannot name it. */
export const caKindSig = (kind: string, enumType?: TypeSigDto): TypeSigDto | undefined => {
  const scalar = caScalar(kind)
  if (scalar)
    return corlibSig(scalar.corlib, kind !== 'String')
  if (kind === CA_TYPE)
    return systemTypeSig()
  if (kind === CA_OBJECT)
    return systemObjectSig()
  if (kind === CA_ENUM)
    return enumType ?? { kind: 'empty' }
  const element = caArrayElementKind(kind)
  if (element !== undefined) {
    const elementSig = caKindSig(element, enumType)
    return elementSig ? szArraySig(elementSig) : undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------------
// Reading a kind back out of an argument
// ---------------------------------------------------------------------------------------------------

/** Whether a signature names `System.<name>`, which is how the corlib types are told apart. */
export const isSystemTypeSig = (signature: TypeSigDto | undefined, name: string): boolean =>
  signature?.kind === 'type' && signature.type?.namespace === 'System' && signature.type.name === name

/** The `System.<name>` a signature names, when it names one at all. */
const corlibName = (signature: TypeSigDto): string | undefined =>
  signature.kind === 'type' && signature.type?.namespace === 'System' ? signature.type.name : undefined

const caScalarNames: Record<string, true> = Object.fromEntries(CA_SCALARS.map((scalar) => [scalar.id, true]))

/**
 * The kind a declared type decides on its own. `System.Object` decides nothing — dnSpy's
 * `ConvertFromModel` lets such a value fall through so that what it holds is what is shown — and a named
 * type that is not the corlib's is taken for an enum, which is what `CANamedArgumentVM.GetConstantType`
 * does with it.
 */
const kindOfSignature = (signature: TypeSigDto): string | undefined => {
  switch (signature.kind) {
    case 'pinned':
    case 'cmodreqd':
    case 'cmodopt':
      return signature.element ? kindOfSignature(signature.element) : undefined
    case 'szarray':
      return signature.element ? `${kindOfSignature(signature.element) ?? CA_OBJECT}[]` : undefined
    case 'type': {
      const name = corlibName(signature)
      if (name === undefined)
        return CA_ENUM
      if (name === 'Object')
        return undefined
      return name === 'Type' ? CA_TYPE : name in caScalarNames ? name : undefined
    }
    default:
      return undefined
  }
}

/** The kind a value's own shape implies, for a declared type that leaves the question open. */
const kindOfValue = (argument: CaArgumentDto): string | undefined => {
  const value = argument.value
  switch (value.kind) {
    case 'string':
      return 'String'
    case 'type':
      return CA_TYPE
    case 'primitive':
      return caScalarOfElementType(value.elementType ?? -1)?.id
    case 'struct':
      return value.elements?.[0] ? kindOfValue(value.elements[0]) : undefined
    case 'array': {
      const element = value.elements?.[0]
      const elementKind = element ? kindOfSignature(element.type) ?? kindOfValue(element) : undefined
      return `${elementKind ?? CA_OBJECT}[]`
    }
    default:
      return undefined
  }
}

/** The kind the editor's combo shows for an argument: the declared type decides, then the value. */
export const caKindOf = (argument: CaArgumentDto, allowNull = true): string =>
  kindOfSignature(argument.type) ?? kindOfValue(argument) ?? (allowNull ? CA_NULL : CA_OBJECT)

// ---------------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------------

/** The text a scalar, string or enum box shows. */
export const caArgumentText = (argument: CaArgumentDto): string => {
  const value = argument.value
  if (value.kind === 'primitive')
    return value.primitive ?? ''
  return value.kind === 'string' ? value.text ?? '' : ''
}

const primitive = (text: string, elementType: number): CaValueDto => ({ kind: 'primitive', primitive: text, elementType })

/**
 * Puts text into an argument of a known kind. A string box that is left empty is the null string, which
 * is what dnSpy's `StringVM` — built with `allowNullString` — reads an empty box as; there is no way to
 * write an empty string through this editor, and dnSpy has none either.
 */
export const caSetText = (kind: string, argument: CaArgumentDto, text: string): CaArgumentDto => {
  const value = argument.value
  if (kind === 'String')
    return { type: argument.type, value: text === '' ? { kind: 'null' } : { kind: 'string', text } }
  const scalar = caScalar(kind)
  if (scalar)
    return { type: argument.type, value: primitive(text, scalar.elementType) }
  if (kind === CA_ENUM) {
    // An element type of `End` says the enum decides, which is how the backend finds an enum's real
    // underlying type — dnSpy reads it from the model the same way.
    return { type: argument.type, value: primitive(text, value.elementType ?? 0x00) }
  }
  return argument
}

/** Whether an array's elements are held as `CAArgument` rows — a type, another object — and so are
 * picked rather than typed. */
export const caArrayIsPicked = (elementKind: string): boolean => elementKind === CA_OBJECT || elementKind === CA_TYPE

/** The text an array box shows: its elements, separated by commas, as dnSpy's list fields do. */
export const caArrayText = (argument: CaArgumentDto): string => {
  const elements = argument.value.kind === 'array' ? argument.value.elements ?? [] : []
  return elements.map((element) => caArgumentText(element)).join(', ')
}

/** The array a comma-separated box holds, with each element read as the kind's own type. */
export const caSetArrayText = (kind: string, argument: CaArgumentDto, text: string): CaArgumentDto => {
  const elementKind = caArrayElementKind(kind)
  const elementSig = argument.type.kind === 'szarray' ? argument.type.element : undefined
  if (elementKind === undefined || !elementSig)
    return argument
  const elements = text.trim() === ''
    ? []
    : text.split(',').map((part) => caSetText(elementKind, { type: elementSig, value: { kind: 'null' } }, part.trim()))
  return { type: argument.type, value: { kind: 'array', elements } }
}

/** Whether the whole array is null, which is a checkbox rather than an empty box — an empty box is an
 * array with no elements, and dnSpy tells the two apart the same way. */
export const caArrayIsNull = (argument: CaArgumentDto): boolean => argument.value.kind === 'null'

export const caSetArrayNull = (argument: CaArgumentDto, isNull: boolean): CaArgumentDto =>
  ({ type: argument.type, value: isNull ? { kind: 'null' } : { kind: 'array', elements: [] } })

/** The single argument a boxed object value wraps. A value that was read from a blob arrives wrapped,
 * which is how dnlib keeps the difference between a boxed value and a bare one; one that was typed in
 * is bare, and stays that way. */
export const caBoxedArgument = (argument: CaArgumentDto): CaArgumentDto | undefined => {
  const value = argument.value
  if (value.kind === 'struct')
    return value.elements?.[0]
  return { type: argument.type, value }
}

/** Puts a boxed object's inner argument back, keeping the wrapper only when it was there to begin with. */
export const caSetBoxedArgument = (argument: CaArgumentDto, inner: CaArgumentDto): CaArgumentDto => {
  if (argument.value.kind !== 'struct')
    return { type: argument.type, value: inner.value }
  const elementType = inner.value.kind === 'primitive' ? inner.value.elementType : undefined
  return { type: argument.type, value: { kind: 'struct', elements: [inner], elementType } }
}

// ---------------------------------------------------------------------------------------------------
// The default a kind starts at, and what a value has to say to be accepted
// ---------------------------------------------------------------------------------------------------

/**
 * A fresh value of a kind, which is where picking a kind in the combo lands. dnSpy starts from
 * `ModelUtils.GetDefaultValue` of the kind's type — zero for a number, `false` for a boolean, `'\0'` for
 * a character, nothing at all for a string — and this is the same set.
 */
export const caDefaultArgument = (kind: string, previous?: CaArgumentDto): CaArgumentDto => {
  const enumType = previous && isEnumArgument(previous) ? previous.type : undefined
  const type = caKindSig(kind, enumType) ?? previous?.type ?? systemObjectSig()
  if (kind === CA_NULL)
    return { type, value: { kind: 'null' } }
  if (kind === CA_ENUM)
    return { type, value: primitive('0', 0x00) }
  if (kind === CA_TYPE)
    return { type, value: { kind: 'type' } }
  if (kind === CA_OBJECT)
    return { type, value: primitive('0', 0x08) }
  const scalar = caScalar(kind)
  if (scalar)
    return { type, value: defaultForScalar(scalar) }
  const elementKind = caArrayElementKind(kind)
  if (elementKind !== undefined)
    return { type, value: { kind: 'array', elements: [] } }
  return { type, value: { kind: 'null' } }
}

/** What a scalar starts at: a number at zero, a boolean at false, a character at `'\0'`, and a string at
 * nothing at all — `ModelUtils.GetDefaultValue` reads a string parameter as the null string, not as the
 * empty one, and dnSpy's own box shows the same. */
const defaultForScalar = (scalar: CaScalar): CaValueDto =>
  scalar.id === 'String' ? { kind: 'null' } : primitive(defaultText(scalar), scalar.elementType)

const defaultText = (scalar: CaScalar): string => {
  switch (scalar.id) {
    case 'Boolean': return 'false'
    // dnSpy's default character is `(char)0`, which is what its box shows and writes back.
    case 'Char': return '\u0000'
    default: return '0'
  }
}

/** Whether an argument's declared type is a named type that is not one of the corlib's — an enum, as far
 * as `CANamedArgumentVM.GetConstantType` is concerned. */
export const isEnumArgument = (argument: CaArgumentDto): boolean =>
  argument.type.kind === 'type' && argument.type.type !== undefined && argument.type.type.namespace !== 'System'

/** A message to show, as the template its callers localize plus the placeholders to fill in. */
export interface CaError {
  template: string
  args?: Record<string, string>
}

const notAValue = (elementType: number, text: string): CaError | undefined => {
  const template = literalError(elementType, text)
  return template === undefined ? undefined : { template, args: { text, name: constantTypeName(elementType) } }
}

/**
 * What would have to change for the backend to accept this argument. It is the same set of rules the
 * backend's own parser applies — an integral value has to fit its type, a character is one character, a
 * boolean is `true` or `false` — checked here so that a value that cannot be written is refused before
 * the dialog closes rather than after.
 */
export const caArgumentError = (argument: CaArgumentDto): CaError | undefined => caValueError(argument.value)

const caValueError = (value: CaValueDto): CaError | undefined => {
  switch (value.kind) {
    case 'null':
      return undefined
    case 'string':
      return undefined
    case 'type':
      return value.referencedType ? undefined : { template: 'Pick a type' }
    case 'struct': {
      const inner = value.elements?.[0]
      return inner ? caValueError(inner.value) : { template: 'A boxed value needs one inner argument' }
    }
    case 'array':
      for (const element of value.elements ?? []) {
        const error = caValueError(element.value)
        if (error)
          return error
      }
      return undefined
    default: {
      const elementType = value.elementType ?? 0
      if (elementType === 0x00) {
        // The enum decides, and this side has no way to ask it which type it is backed by, so only the
        // shape of an integer can be checked here. dnSpy reads the real underlying type from the model.
        return /^-?\d+$/.test(value.primitive ?? '') ? undefined : { template: "'{text}' is not a valid integer", args: { text: value.primitive ?? '' } }
      }
      return notAValue(elementType, value.primitive ?? '')
    }
  }
}

/** The declared type of an enum argument, for the picker button that reads it back. */
export const caEnumType = (argument: CaArgumentDto): TypeSigDto | undefined =>
  isEnumArgument(argument) ? argument.type : undefined

/**
 * The value a fresh argument of a given declared type starts at — dnSpy's `ModelUtils.GetDefaultValue`,
 * which is what it calls for each parameter of a constructor the user has just picked. Everything that
 * is not a number is nothing at all: a string, an array, a `System.Type` and an object all start out
 * null, and an enum starts at zero of whatever type backs it.
 */
export const caDefaultForType = (type: TypeSigDto): CaValueDto => {
  const kind = kindOfSignature(type)
  const scalar = kind === undefined ? undefined : caScalar(kind)
  if (scalar)
    return defaultForScalar(scalar)
  if (kind === CA_ENUM)
    return primitive('0', 0x00)
  return { kind: 'null' }
}

/**
 * How an argument reads in the list row above the buttons — dnSpy's `DlgUtils.ValueToString`, which is
 * what a custom attribute's own `FullName` calls for each of its arguments. It is a label and nothing
 * more: the backend composes the one a saved attribute is shown under, and this only has to agree with
 * it closely enough to be read while the dialog is open.
 */
export const caArgumentDisplay = (argument: CaArgumentDto): string => caValueDisplay(argument.type, argument.value)

const caValueDisplay = (type: TypeSigDto, value: CaValueDto): string => {
  switch (value.kind) {
    case 'null':
      return 'null'
    case 'string':
      return `"${value.text ?? ''}"`
    case 'type':
      return value.referencedType ? `typeof(${describeTypeSig(value.referencedType)})` : 'typeof()'
    // A boxed value is shown as the value it holds: the wrapper is dnlib's way of spelling "boxed",
    // and dnSpy's own display drops it the same way.
    case 'struct':
      return value.elements?.[0] ? caValueDisplay(value.elements[0].type, value.elements[0].value) : 'null'
    case 'array': {
      const element = type.kind === 'szarray' && type.element ? describeTypeSig(type.element) : 'object'
      return `new ${element}[] {${(value.elements ?? []).map((item) => caValueDisplay(item.type, item.value)).join(', ')}}`
    }
    default:
      return value.primitive ?? ''
  }
}
