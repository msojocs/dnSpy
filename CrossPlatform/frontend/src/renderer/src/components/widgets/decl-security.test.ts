import { describe, expect, it } from 'vitest'
import type { CaNamedArgumentDto, DeclSecurityDto, SecurityAttributeDto, TypeSigDto } from '../../../../shared/protocol'
import {
  DECL_SEC_V1, DECL_SEC_V2, DECL_SEC_VERSIONS, declSecurityDraft, declSecurityDto, declSecurityError, declSecurityLabel,
  newDeclSecurity, SECURITY_ACTIONS,
} from './decl-security'
import { securityAttributeDraft } from './security-attribute'

const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }

const attribute = (patch: Partial<SecurityAttributeDto> = {}): SecurityAttributeDto => ({
  attributeType: int32,
  namedArguments: [],
  ...patch,
})

const dto = (patch: Partial<DeclSecurityDto> = {}): DeclSecurityDto => ({
  action: 0x02,
  customAttributes: [],
  securityAttributes: [],
  ...patch,
})

describe('the security actions', () => {
  it('is what dnSpy\'s SecAc enum declares, which is dnlib\'s SecurityAction under those names', () => {
    expect(SECURITY_ACTIONS).toEqual([
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
    ])
  })

  it('has dnSpy\'s two versions, which the box shows as two letters', () => {
    expect(DECL_SEC_VERSIONS).toEqual([{ label: 'V1', value: 0 }, { label: 'V2', value: 1 }])
  })
})

describe('the row\'s text', () => {
  it('is the action and nothing else, whatever the row carries', () => {
    expect(declSecurityLabel(declSecurityDraft(dto({ action: 0x02 })))).toBe('Demand')
    expect(declSecurityLabel(declSecurityDraft(dto({ action: 0x0F })))).toBe('NonCasInheritance')
  })

  it('falls back to the number for an action dnSpy has no name for, as dnlib\'s own ToString does', () => {
    expect(declSecurityLabel(declSecurityDraft(dto({ action: 0x20 })))).toBe('32')
  })
})

describe('opening a row', () => {
  it('reads the version off the XML being there, which is the only thing that tells the two apart', () => {
    // The row is V1 when it has the XML and V2 when it does not: `DeclSecurityOptions` reads it the same
    // way, which is why the version is not a field of the DTO.
    const v2 = declSecurityDraft(dto({ securityAttributes: [attribute()] }))
    expect(v2.version).toBe(DECL_SEC_V2)
    expect(v2.xml).toBe('')
    expect(v2.securityAttributes).toHaveLength(1)

    const v1 = declSecurityDraft(dto({ v1XmlString: '<PermissionSet/>', securityAttributes: [attribute()] }))
    expect(v1.version).toBe(DECL_SEC_V1)
    expect(v1.xml).toBe('<PermissionSet/>')
    // The hidden list is kept rather than dropped, so switching the version box back and forth does not
    // lose what was in it — which is what dnSpy does with its two view models living at once.
    expect(v1.securityAttributes).toHaveLength(1)
  })
})

describe('a fresh row', () => {
  it('demands nothing and is in the form whose list is empty rather than whose XML is absent', () => {
    expect(newDeclSecurity()).toEqual({ action: 0, version: DECL_SEC_V2, xml: '', securityAttributes: [], customAttributes: [] })
    expect(newDeclSecurity().version).not.toBe(DECL_SEC_V1)
  })
})

describe('what keeps a row from being accepted', () => {
  it('is whatever the security attributes report', () => {
    const draft = declSecurityDraft(dto({ securityAttributes: [attribute({ attributeType: { kind: 'empty' } })] }))
    expect(declSecurityError(draft)?.template).toBe('A type is required')
  })

  it('checks the list the version box is not showing too, which is what dnSpy\'s two view models do', () => {
    const broken = securityAttributeDraft(attribute({ attributeType: { kind: 'empty' } }))
    const draft = { ...newDeclSecurity(), version: DECL_SEC_V1, xml: '<PermissionSet/>', securityAttributes: [broken] }
    expect(declSecurityError(draft)?.template).toBe('A type is required')
  })

  it('says nothing about the XML, which is text the backend parses', () => {
    expect(declSecurityError({ ...newDeclSecurity(), version: DECL_SEC_V1, xml: 'not xml at all' })).toBeUndefined()
  })
})

describe('writing a row back', () => {
  it('writes the XML and no version for a V1 row, which is how the backend knows which form it is in', () => {
    const written = declSecurityDto({ ...newDeclSecurity(), action: 0x08, version: DECL_SEC_V1, xml: '<PermissionSet/>' })
    expect(written.v1XmlString).toBe('<PermissionSet/>')
    expect(written.action).toBe(8)
  })

  it('writes no XML for a V2 row, or an empty one would read back as the other form', () => {
    const written = declSecurityDto({ ...newDeclSecurity(), version: DECL_SEC_V2, securityAttributes: [securityAttributeDraft(attribute())] })
    expect(written.v1XmlString).toBeUndefined()
    expect(JSON.parse(JSON.stringify(written))).not.toHaveProperty('v1XmlString')
    expect(written.securityAttributes).toHaveLength(1)
  })

  it('reads back as the row it was written from, which is what the list does with it', () => {
    const draft = declSecurityDraft(dto({ action: 0x03, securityAttributes: [attribute()] }))
    expect(declSecurityDraft(declSecurityDto(draft))).toEqual(draft)
    const v1 = declSecurityDraft(dto({ action: 0x08, v1XmlString: '<PermissionSet/>' }))
    expect(declSecurityDraft(declSecurityDto(v1))).toEqual(v1)
  })
})

/** The named arguments of a security attribute are the wire's own values, so one has to be spelled the
 * way a DTO spells it — which is what makes the round trip the list's rows make a real one. */
const named: CaNamedArgumentDto = { isField: false, name: 'Name', argument: { type: int32, value: { kind: 'primitive', primitive: '1' } } }

describe('a row whose attributes carry values', () => {
  it('keeps them through the trip out and back', () => {
    const draft = declSecurityDraft(dto({ securityAttributes: [attribute({ namedArguments: [named] })] }))
    expect(declSecurityDto(draft).securityAttributes[0].namedArguments).toEqual([named])
  })
})
