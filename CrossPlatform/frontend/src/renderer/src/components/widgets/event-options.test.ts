import { describe, expect, it } from 'vitest'
import type { EventOptionsDto, MethodRefDto, TypeSigDto } from '../../../../shared/protocol'
import { EVENT_ATTRIBUTES, EVENT_FLAGS, eventOptionsDraft, eventOptionsDto, hasEventFlag, withEventFlag } from './event-options'

const eventHandler: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'EventHandler' } }
const intType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Int32' }, valueType: true }

const constructor: MethodRefDto = {
  declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } },
  name: '.ctor',
  signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] },
}

const event = (patch: Partial<EventOptionsDto> = {}): EventOptionsDto => ({
  attributes: EVENT_ATTRIBUTES.SpecialName,
  name: 'Changed',
  eventType: eventHandler,
  otherMethods: [],
  customAttributes: [],
  ...patch,
})

describe('event options', () => {
  it('carries the whole model across and back, with no bit of its own to derive', () => {
    const value = event({
      attributes: EVENT_ATTRIBUTES.SpecialName | EVENT_ATTRIBUTES.RTSpecialName,
      eventType: intType,
      addMethod: { name: 'add_Changed', token: 7, display: 'void Type::add_Changed(EventHandler)' },
      invokeMethod: { name: 'raise_Changed', nodeId: 'method-3', display: 'void Type::raise_Changed(object, EventArgs)' },
      removeMethod: { name: 'remove_Changed', token: 9, display: 'void Type::remove_Changed(EventHandler)' },
      otherMethods: [{ name: 'OnChanged', token: 10, display: 'void Type::OnChanged()' }],
      customAttributes: [{ constructor, constructorArguments: [], namedArguments: [] }],
    })

    expect(eventOptionsDto(eventOptionsDraft(value))).toEqual(value)
  })

  it('turns the two flag boxes into the two bits dnlib writes', () => {
    expect(EVENT_FLAGS.map((entry) => entry.label)).toEqual(['SpecialName', 'RTSpecialName'])
    expect(withEventFlag(0, EVENT_ATTRIBUTES.RTSpecialName, true)).toBe(EVENT_ATTRIBUTES.RTSpecialName)
    expect(withEventFlag(EVENT_ATTRIBUTES.SpecialName | EVENT_ATTRIBUTES.RTSpecialName, EVENT_ATTRIBUTES.SpecialName, false))
      .toBe(EVENT_ATTRIBUTES.RTSpecialName)
    expect(hasEventFlag(EVENT_ATTRIBUTES.SpecialName, EVENT_ATTRIBUTES.RTSpecialName)).toBe(false)
  })

  it('leaves the rows the picker was dismissed on out of the written model', () => {
    const draft = { ...eventOptionsDraft(event()), otherMethods: [{ name: 'OnChanged', token: 10 }, undefined] }
    expect(eventOptionsDto(draft).otherMethods).toEqual([{ name: 'OnChanged', token: 10 }])
  })

  it('holds nothing back, which is what the dialog says by having no error of its own to set', () => {
    // dnSpy's EventOptionsVM does not override HasError, so an event with no type and no accessors is
    // written as it stands rather than refused.
    const empty = eventOptionsDto({ ...eventOptionsDraft(event()), eventType: undefined })
    expect(empty.eventType).toBeUndefined()
    expect(empty.name).toBe('Changed')
  })

  it('reads the accessors out as they came, leaving the ones the event has none of absent', () => {
    const draft = eventOptionsDraft(event({ addMethod: { name: 'add_Changed', token: 7 } }))
    expect(draft.addMethod).toEqual({ name: 'add_Changed', token: 7 })
    expect(draft.invokeMethod).toBeUndefined()
    expect(draft.removeMethod).toBeUndefined()
  })
})
