import type { DeclSecurityDto } from '../../../../shared/protocol'
import type { CaError } from './ca-value'
import { customAttributeDraft, customAttributeDto, customAttributeError, type CustomAttributeDraft } from './custom-attribute'
import { securityAttributeDraft, securityAttributeDto, securityAttributeError, type SecurityAttributeDraft } from './security-attribute'

/**
 * dnSpy's `SecAc` enum, which is dnlib's `SecurityAction` under the names its combo shows: the value is
 * the metadata's action and the label is the enum field, so a row that came from a file with an action
 * outside the list shows nothing at all in the box, as it does in dnSpy.
 */
export const SECURITY_ACTIONS: { label: string, value: number }[] = [
  { label: 'ActionNil', value: 0x00 },
  { label: 'Request', value: 0x01 },
  { label: 'Demand', value: 0x02 },
  { label: 'Assert', value: 0x03 },
  { label: 'Deny', value: 0x04 },
  { label: 'PermitOnly', value: 0x05 },
  { label: 'LinktimeCheck', value: 0x06 },
  { label: 'InheritanceCheck', value: 0x07 },
  { label: 'RequestMinimum', value: 0x08 },
  { label: 'RequestOptional', value: 0x09 },
  { label: 'RequestRefuse', value: 0x0A },
  { label: 'PrejitGrant', value: 0x0B },
  { label: 'PrejitDenied', value: 0x0C },
  { label: 'NonCasDemand', value: 0x0D },
  { label: 'NonCasLinkDemand', value: 0x0E },
  { label: 'NonCasInheritance', value: 0x0F },
]

/** The two forms a row can be in, which is dnSpy's `DeclSecVer`: the .NET 1.x XML blob, or the list of
 * security attributes every compiler since has written. */
export const DECL_SEC_VERSIONS: { label: string, value: number }[] = [
  { label: 'V1', value: 0 },
  { label: 'V2', value: 1 },
]

export const DECL_SEC_V1 = 0
export const DECL_SEC_V2 = 1

/**
 * A declarative security row while a dialog has it open. The version is not a field of the row itself:
 * it is which of the two payloads the row carries, and dnSpy reads it off the XML being there or not.
 */
export interface DeclSecurityDraft {
  action: number
  /** Which of `DECL_SEC_VERSIONS` the row is in. */
  version: number
  /** The XML the V1 form is — kept as text even while the other form is being edited, because switching
   * the combo back and forth must not lose what was typed. */
  xml: string
  securityAttributes: SecurityAttributeDraft[]
  customAttributes: CustomAttributeDraft[]
}

export const declSecurityDraft = (dto: DeclSecurityDto): DeclSecurityDraft => ({
  action: dto.action,
  version: dto.v1XmlString === undefined ? DECL_SEC_V2 : DECL_SEC_V1,
  xml: dto.v1XmlString ?? '',
  securityAttributes: dto.securityAttributes.map(securityAttributeDraft),
  customAttributes: dto.customAttributes.map(customAttributeDraft),
})

/**
 * Only ever called on a draft that has been accepted. A V1 row is written as its XML and the attributes
 * the other form holds are dropped, which is `DeclSecurityOptions.CopyTo`: the two are the same field in
 * the metadata, and the one the row is not in is not written.
 */
export const declSecurityDto = (draft: DeclSecurityDraft): DeclSecurityDto => ({
  action: draft.action,
  v1XmlString: draft.version === DECL_SEC_V1 ? draft.xml : undefined,
  securityAttributes: draft.securityAttributes.map(securityAttributeDto),
  customAttributes: draft.customAttributes.map(customAttributeDto),
})

/** The row's text, which is dnSpy's `DeclSecurityVM.FullName`: the action's name and nothing else — the
 * payload is several hundred characters of XML or a list of its own rows. */
export const declSecurityLabel = (draft: DeclSecurityDraft): string =>
  SECURITY_ACTIONS.find((entry) => entry.value === draft.action)?.label ?? String(draft.action)

/** A fresh row for the list's Add... button, which is `new DeclSecurityOptions()`: no action, and the
 * form whose list is empty rather than the one whose XML is absent. */
export const newDeclSecurity = (): DeclSecurityDraft => ({
  action: 0,
  version: DECL_SEC_V2,
  xml: '',
  securityAttributes: [],
  customAttributes: [],
})

/**
 * What would keep the backend from writing this row, which is `DeclSecurityVM.HasError`: whatever the
 * custom attributes report, and whatever the security attributes report — both lists, whatever form the
 * row is in. dnSpy checks the two view models rather than the page being drawn, so a half-built row in
 * the list the version box has switched away from still holds the dialog's OK button; that is the
 * behaviour here too. The XML is text the backend parses, so a string that will not parse is caught
 * there rather than here.
 */
export const declSecurityError = (draft: DeclSecurityDraft): CaError | undefined => {
  for (const attribute of draft.customAttributes) {
    const error = customAttributeError(attribute)
    if (error)
      return error
  }
  for (const attribute of draft.securityAttributes) {
    const error = securityAttributeError(attribute)
    if (error)
      return error
  }
  return undefined
}
