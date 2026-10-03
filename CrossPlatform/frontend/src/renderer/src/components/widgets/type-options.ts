/**
 * dnSpy's `TypeDefOptions` as the type dialog edits it: the attribute word the six combinations and the
 * nine flag boxes are carved out of, the namespace and name, the layout, the base type, and the four
 * collections the window rebuilds rather than merges.
 *
 * Two of those six combinations are not free: the layout and the semantics are what tell the kind combo
 * what it is looking at, so changing either re-derives it, and picking a kind writes the layout, the
 * semantics, the flags and the base type back. That is dnSpy's `InitializeTypeKind` and
 * `OnTypeKindChanged2`, kept apart here the same way, including which edits trigger which: a flag or the
 * base type re-derives the kind, a name does not.
 *
 * The packing size and the class size are boxes rather than values — dnSpy's view model holds each as a
 * `NullableUInt16VM`/`NullableUInt32VM`, whose empty state is the type having no class layout at all.
 */

import type { TypeOptionsDto, TypeRefDto, TypeSigDto } from '../../../../shared/protocol'
import type { CaError } from './ca-value'
import { customAttributeDto, type CustomAttributeDraft, customAttributeDraft } from './custom-attribute'
import { declSecurityDraft, declSecurityDto, type DeclSecurityDraft } from './decl-security'
import { genericParamDraft, genericParamDto, type GenericParamDraft } from './generic-param'
import { formatNumberText, parseNumberText, unsignedIntegerFailure } from './number-text'
import { typeDefOrRefAndCaDto, typeDefOrRefAndCaDraft, type TypeDefOrRefAndCaDraft } from './type-def-or-ref-and-ca'
import { describeTypeSig } from './type-sig-text'

/** dnlib's `TypeAttributes`: the five masks the combinations live in, the nine flags that are boxes, and
 * the one bit that follows the security declarations. */
export const TYPE_ATTRIBUTES = {
  NotPublic: 0x000000,
  Public: 0x000001,
  NestedPublic: 0x000002,
  NestedPrivate: 0x000003,
  NestedFamily: 0x000004,
  NestedAssembly: 0x000005,
  NestedFamANDAssem: 0x000006,
  NestedFamORAssem: 0x000007,
  VisibilityMask: 0x000007,
  AutoLayout: 0x000000,
  SequentialLayout: 0x000008,
  ExplicitLayout: 0x000010,
  LayoutMask: 0x000018,
  Class: 0x000000,
  ClassSemanticsMask: 0x000020,
  Interface: 0x000020,
  Abstract: 0x000080,
  Sealed: 0x000100,
  SpecialName: 0x000400,
  RTSpecialName: 0x000800,
  Import: 0x001000,
  Serializable: 0x002000,
  WindowsRuntime: 0x004000,
  AnsiClass: 0x000000,
  UnicodeClass: 0x010000,
  AutoClass: 0x020000,
  CustomFormatClass: 0x030000,
  StringFormatMask: 0x030000,
  HasSecurity: 0x040000,
  BeforeFieldInit: 0x100000,
  Forwarder: 0x200000,
  CustomFormatMask: 0xC00000,
} as const

/** The Flags group box, in the order the XAML lays its three rows of three out. */
export const TYPE_FLAGS: { label: string, flag: number }[] = [
  { label: 'Abstract', flag: TYPE_ATTRIBUTES.Abstract },
  { label: 'Sealed', flag: TYPE_ATTRIBUTES.Sealed },
  { label: 'Serializable', flag: TYPE_ATTRIBUTES.Serializable },
  { label: 'Import', flag: TYPE_ATTRIBUTES.Import },
  { label: 'SpecialName', flag: TYPE_ATTRIBUTES.SpecialName },
  { label: 'RTSpecialName', flag: TYPE_ATTRIBUTES.RTSpecialName },
  { label: 'WindowsRuntime', flag: TYPE_ATTRIBUTES.WindowsRuntime },
  { label: 'BeforeFieldInit', flag: TYPE_ATTRIBUTES.BeforeFieldInit },
  { label: 'Forwarder', flag: TYPE_ATTRIBUTES.Forwarder },
]

/** dnSpy's own `TypeKind`, which is not a metadata enum but the answer to "what sort of type is this" —
 * listed the way `EnumVM.Create` lists every enum it is given, sorted by name. */
export const TYPE_KINDS: { label: string, value: number }[] = [
  { label: 'Class', value: 1 },
  { label: 'Delegate', value: 6 },
  { label: 'Enum', value: 5 },
  { label: 'Interface', value: 3 },
  { label: 'StaticClass', value: 2 },
  { label: 'Struct', value: 4 },
  { label: 'Unknown', value: 0 },
]

const KIND_UNKNOWN = 0
const KIND_CLASS = 1
const KIND_STATIC_CLASS = 2
const KIND_INTERFACE = 3
const KIND_STRUCT = 4
const KIND_ENUM = 5
const KIND_DELEGATE = 6

/**
 * dnSpy's `TypeVisibility` combo, which is hand-written rather than reflected: the values are the bits of
 * `TypeAttributes.VisibilityMask` and the names are what its box shows, so a nested `NestedPublic` reads
 * simply "Public" beside the label that says the visibility is an accessibility.
 *
 * There is no sorting here, and the nesting is not a filter over this list at the end but the two halves
 * of it: dnSpy builds the list and then removes what a non-nested type cannot be, which comes to the
 * first two entries for a top-level type and the last six for a nested one.
 */
export const TYPE_VISIBILITIES: { label: string, value: number }[] = [
  { label: 'NotPublic', value: 0 },
  { label: 'Public', value: 1 },
  { label: 'Public', value: 2 },
  { label: 'Private', value: 3 },
  { label: 'Family', value: 4 },
  { label: 'Assembly', value: 5 },
  { label: 'Family and Assembly', value: 6 },
  { label: 'Family or Assembly', value: 7 },
]

/** What the visibility combo holds for a type that is nested, or one that is not. */
export const typeVisibilities = (isNested: boolean): { label: string, value: number }[] =>
  isNested ? TYPE_VISIBILITIES.slice(2) : TYPE_VISIBILITIES.slice(0, 2)

/** The layout combo, which counts from the `LayoutMask` bit the value is shifted down from. */
export const TYPE_LAYOUTS: { label: string, value: number }[] = [
  { label: 'Auto', value: 0 },
  { label: 'Sequential', value: 1 },
  { label: 'Explicit', value: 2 },
]

/** The semantics combo, which `EnumVM.Create` sorts by name: Class and then Interface, which is also the
 * order they are declared in. */
export const TYPE_SEMANTICS: { label: string, value: number }[] = [
  { label: 'Class', value: 0 },
  { label: 'Interface', value: 1 },
]

/** The string format combo, hand-written in declaration order like the visibility one. */
export const TYPE_STRING_FORMATS: { label: string, value: number }[] = [
  { label: 'Ansi', value: 0 },
  { label: 'Unicode', value: 1 },
  { label: 'Auto', value: 2 },
  { label: 'CustomFormat', value: 3 },
]

/** The custom format combo, which is dnSpy's four-value enum and is already in name order. */
export const TYPE_CUSTOM_FORMATS: { label: string, value: number }[] = [
  { label: 'Value0', value: 0 },
  { label: 'Value1', value: 1 },
  { label: 'Value2', value: 2 },
  { label: 'Value3', value: 3 },
]

/** What the Packing Size box holds: a `ushort`, since that is what a class layout's packing size is. */
export const TYPE_PACKING_SIZE_MAX = 0xFFFF
/** What the Class Size box holds: a `uint`. */
export const TYPE_CLASS_SIZE_MAX = 0xFFFFFFFF

export const hasTypeFlag = (attributes: number, flag: number): boolean => (attributes & flag) !== 0

export const withTypeFlag = (attributes: number, flag: number, on: boolean): number =>
  on ? attributes | flag : attributes & ~flag

/** Each combo's part of the word, and what picking an entry writes back into it. The value a combo holds
 * is the bits shifted down, which is what dnSpy's `EnumListVM` stores, and the shift is undone here. */
export const typeVisibilityOf = (attributes: number): number => attributes & TYPE_ATTRIBUTES.VisibilityMask
export const typeLayoutOf = (attributes: number): number => (attributes & TYPE_ATTRIBUTES.LayoutMask) >> 3
export const typeSemanticsOf = (attributes: number): number => (attributes & TYPE_ATTRIBUTES.ClassSemanticsMask) >> 5
export const typeStringFormatOf = (attributes: number): number => (attributes & TYPE_ATTRIBUTES.StringFormatMask) >> 16
export const typeCustomFormatOf = (attributes: number): number => (attributes & TYPE_ATTRIBUTES.CustomFormatMask) >> 22

export const withTypeVisibility = (attributes: number, value: number): number =>
  (attributes & ~TYPE_ATTRIBUTES.VisibilityMask) | (value & TYPE_ATTRIBUTES.VisibilityMask)
export const withTypeLayout = (attributes: number, value: number): number =>
  (attributes & ~TYPE_ATTRIBUTES.LayoutMask) | ((value << 3) & TYPE_ATTRIBUTES.LayoutMask)
export const withTypeSemantics = (attributes: number, value: number): number =>
  (attributes & ~TYPE_ATTRIBUTES.ClassSemanticsMask) | ((value << 5) & TYPE_ATTRIBUTES.ClassSemanticsMask)
export const withTypeStringFormat = (attributes: number, value: number): number =>
  (attributes & ~TYPE_ATTRIBUTES.StringFormatMask) | ((value << 16) & TYPE_ATTRIBUTES.StringFormatMask)
export const withTypeCustomFormat = (attributes: number, value: number): number =>
  (attributes & ~TYPE_ATTRIBUTES.CustomFormatMask) | ((value << 22) & TYPE_ATTRIBUTES.CustomFormatMask)

/** A type row while a dialog has it open. */
export interface TypeOptionsDraft {
  /** The whole attribute word. The five masks inside it are read out through the combos' own selectors,
   * which is how dnSpy's view model keeps the two in step. */
  attributes: number
  /** The kind the combo shows. It is derived from the rest and kept here rather than recomputed on every
   * render, because dnSpy deliberately does not re-derive it while a kind is being applied. */
  kind: number
  namespace: string
  name: string
  /** What the Packing Size box holds — empty is the type having no packing size. */
  packingSize: string
  classSize: string
  /** The base type, or undefined while there is none — an interface has none, and dnSpy's `TypeSigCreator`
   * starts empty. */
  baseType?: TypeSigDto
  isNested: boolean
  /** The corlib's simple name, which is what tells a base type that came from the corlib from one that
   * was merely named the same. */
  corlibScope?: string
  customAttributes: CustomAttributeDraft[]
  declSecurities: DeclSecurityDraft[]
  genericParameters: GenericParamDraft[]
  interfaces: TypeDefOrRefAndCaDraft[]
}

/**
 * dnSpy's `TypeOptionsVM.InitializeFrom`: the word is taken as it came, the five combos are read back out
 * of it, and the kind is derived from what that comes to.
 */
export const typeOptionsDraft = (dto: TypeOptionsDto): TypeOptionsDraft => initializeTypeKind({
  attributes: dto.attributes,
  kind: KIND_UNKNOWN,
  namespace: dto.namespace,
  name: dto.name,
  packingSize: dto.packingSize === undefined || dto.packingSize === null ? '' : formatNumberText(dto.packingSize),
  classSize: dto.classSize === undefined || dto.classSize === null ? '' : formatNumberText(dto.classSize),
  baseType: dto.baseType ?? undefined,
  isNested: (dto.attributes & TYPE_ATTRIBUTES.VisibilityMask) > 1,
  corlibScope: dto.corlibScope ?? undefined,
  customAttributes: (dto.customAttributes ?? []).map(customAttributeDraft),
  declSecurities: (dto.declSecurities ?? []).map(declSecurityDraft),
  genericParameters: (dto.genericParameters ?? []).map(genericParamDraft),
  interfaces: (dto.interfaces ?? []).map(typeDefOrRefAndCaDraft),
})

/** The named reference a signature is, for a signature that is a plain name — which every base type the
 * picker can hand back is. Anything wrapped in an array or a generic instance is not one of the corlib
 * types these tests look for, so it is answered with nothing rather than unwrapped. */
const typeRefOf = (value: TypeSigDto | undefined): TypeRefDto | undefined =>
  value !== undefined && value.kind === 'type' ? value.type : undefined

/**
 * Whether a signature names a corlib type. dnSpy compares signatures with a `SigComparer` and then asks
 * the type's definition assembly whether it is the corlib, so that a type of one's own called
 * `System.Object` is not taken for the one every class derives from. The dialog has only the name and the
 * scope to go on, and a model that carried no scope — which no backend sends — is taken at its name.
 */
const isCorLibNamed = (draft: TypeOptionsDraft, name: string): boolean => {
  const reference = typeRefOf(draft.baseType)
  if (reference === undefined || reference.namespace !== 'System' || reference.name !== name)
    return false
  return draft.corlibScope === undefined || reference.scope === draft.corlibScope
}

const isSystemValueType = (draft: TypeOptionsDraft): boolean => isCorLibNamed(draft, 'ValueType')
const isSystemEnum = (draft: TypeOptionsDraft): boolean => isCorLibNamed(draft, 'Enum')

/** dnSpy's `IsClassBaseType`: anything that is not one of the two corlib types that stand for the other
 * two kinds of type. `null` is not a class base type, which is what makes an interface an interface. */
const isClassBaseType = (draft: TypeOptionsDraft): boolean =>
  draft.baseType !== undefined && !isSystemEnum(draft) && !isSystemValueType(draft)

/** The corlib type a kind's base type is written as. The scope is the one the model came with, so that
 * the base type a kind writes stays in the same assembly the one it replaced was in. */
const corLibType = (draft: TypeOptionsDraft, name: string, valueType: boolean): TypeSigDto => ({
  kind: 'type',
  type: { scope: draft.corlibScope ?? '', namespace: 'System', name },
  valueType,
})

/**
 * dnSpy's `InitializeTypeKind`: which of the seven the combo shows, worked out from the base type, the
 * layout, the semantics and the two flags that separate a static class from an abstract sealed one.
 */
export const typeKindOf = (draft: TypeOptionsDraft): number => {
  const layout = typeLayoutOf(draft.attributes)
  const semantics = typeSemanticsOf(draft.attributes)
  const isAuto = layout === 0
  const isClass = semantics === 0
  const isAbstract = hasTypeFlag(draft.attributes, TYPE_ATTRIBUTES.Abstract)
  const isSealed = hasTypeFlag(draft.attributes, TYPE_ATTRIBUTES.Sealed)
  if (isCorLibNamed(draft, 'Object') && isAuto && isClass && isAbstract && isSealed)
    return KIND_STATIC_CLASS
  if (draft.baseType === undefined && isAuto && !isClass && isAbstract && !isSealed)
    return KIND_INTERFACE
  if (isSystemValueType(draft) && isClass && !isAbstract && isSealed)
    return KIND_STRUCT
  if (isSystemEnum(draft) && isAuto && isClass && !isAbstract && isSealed)
    return KIND_ENUM
  if (isCorLibNamed(draft, 'MulticastDelegate') && isAuto && isClass && !isAbstract && isSealed)
    return KIND_DELEGATE
  if (isClassBaseType(draft) && isClass)
    return KIND_CLASS
  return KIND_UNKNOWN
}

/** The draft with its kind brought back in step with the rest of it. */
export const initializeTypeKind = (draft: TypeOptionsDraft): TypeOptionsDraft => ({ ...draft, kind: typeKindOf(draft) })

/**
 * dnSpy's `OnTypeKindChanged2`: what picking a kind writes into the model. A class keeps whatever class
 * base type it had, the others are the base type, the layout, the semantics and the two flags that make
 * them what they are — which is the whole of what separates a struct from an enum from a delegate.
 */
export const applyTypeKind = (draft: TypeOptionsDraft, kind: number): TypeOptionsDraft => {
  switch (kind) {
    case KIND_CLASS:
      return {
        ...draft,
        kind,
        baseType: isClassBaseType(draft) ? draft.baseType : corLibType(draft, 'Object', false),
        attributes: withTypeSemantics(draft.attributes, 0),
      }
    case KIND_STATIC_CLASS:
      return {
        ...draft,
        kind,
        baseType: corLibType(draft, 'Object', false),
        attributes: withTypeSemantics(withTypeLayout(draft.attributes, 0), 0) | TYPE_ATTRIBUTES.Abstract | TYPE_ATTRIBUTES.Sealed,
      }
    case KIND_INTERFACE:
      return {
        ...draft,
        kind,
        baseType: undefined,
        attributes: (withTypeSemantics(withTypeLayout(draft.attributes, 0), 1) | TYPE_ATTRIBUTES.Abstract) & ~TYPE_ATTRIBUTES.Sealed,
      }
    case KIND_STRUCT:
      return {
        ...draft,
        kind,
        baseType: corLibType(draft, 'ValueType', true),
        attributes: (withTypeSemantics(draft.attributes, 0) & ~TYPE_ATTRIBUTES.Abstract) | TYPE_ATTRIBUTES.Sealed,
      }
    case KIND_ENUM:
      return {
        ...draft,
        kind,
        baseType: corLibType(draft, 'Enum', true),
        attributes: ((withTypeSemantics(withTypeLayout(draft.attributes, 0), 0) & ~TYPE_ATTRIBUTES.Abstract) | TYPE_ATTRIBUTES.Sealed),
      }
    case KIND_DELEGATE:
      return {
        ...draft,
        kind,
        baseType: corLibType(draft, 'MulticastDelegate', false),
        attributes: (withTypeSemantics(withTypeLayout(draft.attributes, 0), 0) & ~TYPE_ATTRIBUTES.Abstract) | TYPE_ATTRIBUTES.Sealed,
      }
    default:
      return { ...draft, kind }
  }
}

/**
 * dnSpy's `ModelUtils.GetHasSecurityBit`: a type has the bit once it carries any declarative security, or
 * a custom attribute on it is the one .NET's own security declarations are written as.
 */
const hasSecurityBit = (draft: TypeOptionsDraft): boolean =>
  draft.declSecurities.length > 0 ||
  draft.customAttributes.some((attribute) =>
    attribute.constructor !== undefined &&
    describeTypeSig(attribute.constructor.declaringType) === 'System.Security.SuppressUnmanagedCodeSecurityAttribute')

/**
 * The word the type is written with. The five masks are rebuilt from the combos — which is what dnSpy's
 * `Attributes` getter does, so that everything outside them survives a trip through the window — and the
 * security bit is derived from the security declarations rather than taken from the word, as `CopyTo`
 * does with it.
 */
export const typeAttributesOf = (draft: TypeOptionsDraft): number => {
  const mask = TYPE_ATTRIBUTES.VisibilityMask | TYPE_ATTRIBUTES.LayoutMask | TYPE_ATTRIBUTES.ClassSemanticsMask |
    TYPE_ATTRIBUTES.StringFormatMask | TYPE_ATTRIBUTES.CustomFormatMask
  const attributes = (draft.attributes & ~mask) |
    withTypeVisibility(0, typeVisibilityOf(draft.attributes)) |
    withTypeLayout(0, typeLayoutOf(draft.attributes)) |
    withTypeSemantics(0, typeSemanticsOf(draft.attributes)) |
    withTypeStringFormat(0, typeStringFormatOf(draft.attributes)) |
    withTypeCustomFormat(0, typeCustomFormatOf(draft.attributes))
  return withTypeFlag(attributes, TYPE_ATTRIBUTES.HasSecurity, hasSecurityBit(draft))
}

/** What one of the two size boxes holds, or undefined while it holds nothing or something that is not a
 * number. An empty box is the type having no class layout, which is not an error. */
const sizeValue = (text: string, max: number): number | undefined =>
  text.trim().length === 0 ? undefined : parseNumberText(text, max).value

/**
 * Only ever called on a draft that has been accepted, which is why text that does not read is an error
 * rather than a value: the dialog's OK button is disabled until it does.
 */
export const typeOptionsDto = (draft: TypeOptionsDraft): TypeOptionsDto => ({
  attributes: typeAttributesOf(draft),
  namespace: draft.namespace,
  name: draft.name,
  packingSize: sizeValue(draft.packingSize, TYPE_PACKING_SIZE_MAX),
  classSize: sizeValue(draft.classSize, TYPE_CLASS_SIZE_MAX),
  baseType: draft.baseType,
  customAttributes: draft.customAttributes.map(customAttributeDto),
  declSecurities: draft.declSecurities.map(declSecurityDto),
  genericParameters: draft.genericParameters.map(genericParamDto),
  interfaces: draft.interfaces.map(typeDefOrRefAndCaDto),
})

/** What would keep the backend from writing this type, which is dnSpy's `TypeOptionsVM.HasError`: the two
 * size boxes and nothing else. A type without a base type is an interface, which is a type. */
export const typeOptionsError = (draft: TypeOptionsDraft): CaError | undefined => {
  const packingSize = sizeValue(draft.packingSize, TYPE_PACKING_SIZE_MAX)
  if (draft.packingSize.trim().length > 0 && packingSize === undefined)
    return unsignedIntegerFailure(draft.packingSize, TYPE_PACKING_SIZE_MAX)
  const classSize = sizeValue(draft.classSize, TYPE_CLASS_SIZE_MAX)
  if (draft.classSize.trim().length > 0 && classSize === undefined)
    return unsignedIntegerFailure(draft.classSize, TYPE_CLASS_SIZE_MAX)
  return undefined
}
