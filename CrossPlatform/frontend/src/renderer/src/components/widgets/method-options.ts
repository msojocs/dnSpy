import type { CustomAttributeDto, DeclSecurityDto, ImplMapDto, MethodOptionsDto, MethodSigDto } from '../../../../shared/protocol'
import type { CaError } from './ca-value'
import { customAttributeDraft, customAttributeDto, type CustomAttributeDraft } from './custom-attribute'
import { declSecurityDraft, declSecurityDto, type DeclSecurityDraft } from './decl-security'
import { genericParamDraft, genericParamDto, type GenericParamDraft } from './generic-param'
import { methodOverrideDraft, methodOverrideDto, type MethodOverrideDraft } from './method-override'
import { paramDefDraft, paramDefDto, type ParamDefDraft } from './param-def'
import { implMapError, withFlag } from './pinvoke'
import { describeTypeSig, isMethodSigComplete } from './type-sig-text'

/**
 * dnlib's `MethodImplAttributes` — the flags the ImplFlags group box writes, plus the two masks the
 * CodeType and ManagedType combos sit on: the low two bits are the code type and bit 2 says whether the
 * runtime may run it, which is why all three write into the one word.
 */
export const METHOD_IMPL_ATTRIBUTES = {
  CodeTypeMask: 0x0003,
  ManagedMask: 0x0004,
  NoInlining: 0x0008,
  ForwardRef: 0x0010,
  Synchronized: 0x0020,
  NoOptimization: 0x0040,
  PreserveSig: 0x0080,
  AggressiveInlining: 0x0100,
  AggressiveOptimization: 0x0200,
  SecurityMitigations: 0x0400,
  InternalCall: 0x1000,
} as const

/** dnlib's `MethodAttributes`: the access and vtable-layout masks the two combos hold, and the flags. */
export const METHOD_ATTRIBUTES = {
  MemberAccessMask: 0x0007,
  UnmanagedExport: 0x0008,
  Static: 0x0010,
  Final: 0x0020,
  Virtual: 0x0040,
  HideBySig: 0x0080,
  VtableLayoutMask: 0x0100,
  NewSlot: 0x0100,
  CheckAccessOnOverride: 0x0200,
  Abstract: 0x0400,
  SpecialName: 0x0800,
  RTSpecialName: 0x1000,
  PinvokeImpl: 0x2000,
  HasSecurity: 0x4000,
  RequireSecObject: 0x8000,
} as const

/** The ImplFlags group box, in the order the WPF dialog lays its three rows out — a literal header and
 * literal captions, so they are not run through the translator. */
export const IMPL_FLAGS: { label: string, flag: number }[] = [
  { label: 'ForwardRef', flag: METHOD_IMPL_ATTRIBUTES.ForwardRef },
  { label: 'PreserveSig', flag: METHOD_IMPL_ATTRIBUTES.PreserveSig },
  { label: 'InternalCall', flag: METHOD_IMPL_ATTRIBUTES.InternalCall },
  { label: 'Synchronized', flag: METHOD_IMPL_ATTRIBUTES.Synchronized },
  { label: 'NoInlining', flag: METHOD_IMPL_ATTRIBUTES.NoInlining },
  { label: 'AggressiveInlining', flag: METHOD_IMPL_ATTRIBUTES.AggressiveInlining },
  { label: 'NoOptimization', flag: METHOD_IMPL_ATTRIBUTES.NoOptimization },
  { label: 'AggressiveOptimization', flag: METHOD_IMPL_ATTRIBUTES.AggressiveOptimization },
  { label: 'SecurityMitigations', flag: METHOD_IMPL_ATTRIBUTES.SecurityMitigations },
]

/**
 * The Flags group box, in the WPF dialog's order. `PinvokeImpl` and `HasSecurity` are flags of the same
 * word but they are not in it: dnSpy has no checkbox for either, and derives both — the first from the
 * ImplMap tab's Enable box, the second from the security rows and attributes on the item.
 */
export const METHOD_FLAGS: { label: string, flag: number }[] = [
  { label: 'Static', flag: METHOD_ATTRIBUTES.Static },
  { label: 'Final', flag: METHOD_ATTRIBUTES.Final },
  { label: 'Virtual', flag: METHOD_ATTRIBUTES.Virtual },
  { label: 'HideBySig', flag: METHOD_ATTRIBUTES.HideBySig },
  { label: 'CheckAccessOnOverride', flag: METHOD_ATTRIBUTES.CheckAccessOnOverride },
  { label: 'Abstract', flag: METHOD_ATTRIBUTES.Abstract },
  { label: 'SpecialName', flag: METHOD_ATTRIBUTES.SpecialName },
  { label: 'RTSpecialName', flag: METHOD_ATTRIBUTES.RTSpecialName },
  { label: 'UnmanagedExport', flag: METHOD_ATTRIBUTES.UnmanagedExport },
  { label: 'RequireSecObject', flag: METHOD_ATTRIBUTES.RequireSecObject },
]

/**
 * The four combos of the Main page. dnSpy builds them with `EnumVM.Create`, which sorts the values of
 * the enum by name, so the order is the enum's names in alphabetical order and not the order they are
 * written in — `Assembly` comes before `FamANDAssem`, and `NewSlot` before `ReuseSlot`.
 */
export const CODE_TYPES: { label: string, value: number }[] = [
  { label: 'IL', value: 0 },
  { label: 'Native', value: 1 },
  { label: 'OPTIL', value: 2 },
  { label: 'Runtime', value: 3 },
]

export const MANAGED_TYPES: { label: string, value: number }[] = [
  { label: 'Managed', value: 0 },
  { label: 'Unmanaged', value: 1 },
]

export const METHOD_ACCESSES: { label: string, value: number }[] = [
  { label: 'Assembly', value: 3 },
  { label: 'FamANDAssem', value: 2 },
  { label: 'Family', value: 4 },
  { label: 'FamORAssem', value: 5 },
  { label: 'Private', value: 1 },
  { label: 'PrivateScope', value: 0 },
  { label: 'Public', value: 6 },
]

export const VTABLE_LAYOUTS: { label: string, value: number }[] = [
  { label: 'NewSlot', value: 1 },
  { label: 'ReuseSlot', value: 0 },
]

export const codeTypeOf = (implAttributes: number): number => implAttributes & METHOD_IMPL_ATTRIBUTES.CodeTypeMask
export const withCodeType = (implAttributes: number, value: number): number =>
  (implAttributes & ~METHOD_IMPL_ATTRIBUTES.CodeTypeMask) | value

export const managedTypeOf = (implAttributes: number): number => (implAttributes & METHOD_IMPL_ATTRIBUTES.ManagedMask) >> 2
export const withManagedType = (implAttributes: number, value: number): number =>
  (implAttributes & ~METHOD_IMPL_ATTRIBUTES.ManagedMask) | (value << 2)

export const methodAccessOf = (attributes: number): number => attributes & METHOD_ATTRIBUTES.MemberAccessMask
export const withMethodAccess = (attributes: number, value: number): number =>
  (attributes & ~METHOD_ATTRIBUTES.MemberAccessMask) | value

export const vtableLayoutOf = (attributes: number): number => (attributes & METHOD_ATTRIBUTES.VtableLayoutMask) >> 8
export const withVtableLayout = (attributes: number, value: number): number =>
  (attributes & ~METHOD_ATTRIBUTES.VtableLayoutMask) | (value << 8)

/** The attribute that asks for the security bit on its own — `ModelUtils.GetHasSecurityBit` knows it by
 * this full name. */
const SUPPRESS_UNMANAGED_CODE_SECURITY = 'System.Security.SuppressUnmanagedCodeSecurityAttribute'

/** dnSpy's `ModelUtils.GetHasSecurityBit`: any security row at all, or the one attribute that is worth
 * the bit by itself. */
const hasSecurityBit = (declSecurities: DeclSecurityDto[], customAttributes: CustomAttributeDto[]): boolean =>
  declSecurities.length > 0 ||
  customAttributes.some((attribute) => describeTypeSig(attribute.constructor.declaringType) === SUPPRESS_UNMANAGED_CODE_SECURITY)

/**
 * A method's dialog model, which is dnSpy's `MethodOptions` with the list rows in their editable shape.
 * `rva` and `ownerGenericParameterCount` are not edited by any page: the first travels with the model
 * because the codec writes what it is given, the second is read-only context dnSpy gets from the live
 * type instead.
 */
export interface MethodOptionsDraft {
  implAttributes: number
  attributes: number
  semanticsAttributes: number
  rva: number
  ownerGenericParameterCount: number
  name: string
  methodSig?: MethodSigDto
  implMap?: ImplMapDto
  paramDefs: ParamDefDraft[]
  genericParameters: GenericParamDraft[]
  overrides: MethodOverrideDraft[]
  customAttributes: CustomAttributeDraft[]
  declSecurities: DeclSecurityDraft[]
}

export const methodOptionsDraft = (dto: MethodOptionsDto): MethodOptionsDraft => ({
  implAttributes: dto.implAttributes,
  attributes: dto.attributes,
  semanticsAttributes: dto.semanticsAttributes,
  rva: dto.rva ?? 0,
  ownerGenericParameterCount: dto.ownerGenericParameterCount ?? 0,
  name: dto.name,
  methodSig: dto.methodSig,
  implMap: dto.implMap,
  paramDefs: dto.paramDefs.map(paramDefDraft),
  genericParameters: dto.genericParameters.map(genericParamDraft),
  overrides: dto.overrides.map(methodOverrideDraft),
  customAttributes: dto.customAttributes.map(customAttributeDraft),
  declSecurities: dto.declSecurities.map(declSecurityDraft),
})

/**
 * What the dialog hands back. `CopyTo` in dnSpy settles the security bit here rather than while the user
 * is typing, so that a row added and removed again leaves the method as it was; the read-only fields are
 * left off, since the backend is the one that knows them.
 */
export const methodOptionsDto = (draft: MethodOptionsDraft): MethodOptionsDto => {
  const customAttributes = draft.customAttributes.map(customAttributeDto)
  const declSecurities = draft.declSecurities.map(declSecurityDto)
  return {
    implAttributes: draft.implAttributes,
    attributes: withFlag(draft.attributes, METHOD_ATTRIBUTES.HasSecurity, hasSecurityBit(declSecurities, customAttributes)),
    semanticsAttributes: draft.semanticsAttributes,
    rva: draft.rva,
    name: draft.name,
    methodSig: draft.methodSig,
    implMap: draft.implMap,
    customAttributes,
    declSecurities,
    paramDefs: draft.paramDefs.map(paramDefDto),
    genericParameters: draft.genericParameters.map(genericParamDto),
    overrides: draft.overrides.map(methodOverrideDto),
  }
}

/**
 * What dnSpy's `MethodOptionsVM.HasError` refuses: a P/Invoke with no library to call into, and a
 * signature that is not whole. The error rows inside the list editors are not consulted, and neither
 * does dnSpy consult them — but the port does check every parameter type, where dnSpy's creator can only
 * ever produce a whole signature and therefore has nothing to check.
 */
export const methodOptionsError = (draft: MethodOptionsDraft): CaError | undefined => {
  const implMapFailure = implMapError(draft.implMap)
  if (implMapFailure !== undefined)
    return { template: implMapFailure }
  if (draft.methodSig === undefined || !isMethodSigComplete(draft.methodSig))
    return { template: 'The method signature is incomplete' }
  return undefined
}
