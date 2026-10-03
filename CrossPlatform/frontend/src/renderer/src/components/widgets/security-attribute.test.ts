import { describe, expect, it } from 'vitest'
import type { CaNamedArgumentDto, SecurityAttributeDto, TypeSigDto } from '../../../../shared/protocol'
import {
  newSecurityAttribute, securityAttributeDraft, securityAttributeDto, securityAttributeError, securityAttributeLabel,
  type SecurityAttributeDraft,
} from './security-attribute'

const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }
const setAttribute: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System.Security.Permissions', name: 'PermissionSetAttribute' } }

/** A named argument whose value reads, which is what a row's row is once it has been typed into. */
const action = (name: string, value: string): CaNamedArgumentDto => ({
  isField: false,
  name,
  argument: { type: { kind: 'type', type: { scope: '', namespace: 'System', name: 'String' } }, value: { kind: 'string', text: value } },
})

const dto = (patch: Partial<SecurityAttributeDto> = {}): SecurityAttributeDto => ({
  attributeType: setAttribute,
  namedArguments: [],
  ...patch,
})

describe('a fresh row', () => {
  it('names no attribute and sets nothing, which is `new SecurityAttribute()`', () => {
    expect(newSecurityAttribute()).toEqual({ attributeType: null, namedArguments: [] })
  })

  it('cannot be accepted until a type is picked', () => {
    expect(securityAttributeError(newSecurityAttribute())?.template).toBe('A type is required')
    expect(securityAttributeError(securityAttributeDraft(dto()))).toBeUndefined()
  })
})

describe('the row\'s text', () => {
  it('is the type with the values it sets, which is `SecurityAttributeVM.FullName`', () => {
    const draft = securityAttributeDraft(dto({ namedArguments: [action('Name', 'Everything')] }))
    expect(securityAttributeLabel(draft)).toBe('System.Security.Permissions.PermissionSetAttribute(Name = "Everything")')
  })

  it('says so for a row whose type has not been picked, in dnSpy\'s own spelling', () => {
    // Three brackets a side, which is not the `<<no-name>>` a nameless row gets elsewhere.
    expect(securityAttributeLabel(newSecurityAttribute())).toBe('<<<null>>>()')
  })
})

describe('opening a row', () => {
  it('takes the type and the values as they came, since there is nothing to convert', () => {
    const given = dto({ namedArguments: [action('Name', 'Nothing')] })
    expect(securityAttributeDraft(given)).toEqual({ attributeType: setAttribute, namedArguments: given.namedArguments })
  })
})

describe('what keeps a row from being accepted', () => {
  it('is a type that is not there, or a value the backend would not read', () => {
    // A primitive whose text will not read is what the value editor reports, and the row passes it on —
    // dnSpy's `SecurityAttributeVM.HasError` is the type being absent *or* a value being unreadable.
    const broken: SecurityAttributeDraft = { attributeType: int32, namedArguments: [{ isField: false, name: 'Value', argument: { type: int32, value: { kind: 'primitive', primitive: 'nope' } } }] }
    expect(securityAttributeError(broken)?.template).toBe("'{text}' is not a valid integer")

    const whole: SecurityAttributeDraft = { attributeType: int32, namedArguments: [action('Name', 'x')] }
    expect(securityAttributeError(whole)).toBeUndefined()
  })
})

describe('writing a row back', () => {
  it('writes the type and the values, and refuses a row with no type', () => {
    const written = securityAttributeDto({ attributeType: int32, namedArguments: [] })
    expect(written).toEqual({ attributeType: int32, namedArguments: [] })
    expect(() => securityAttributeDto(newSecurityAttribute())).toThrow('A security attribute needs a type.')
  })
})
