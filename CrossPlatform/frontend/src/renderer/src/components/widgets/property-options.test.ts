import { describe, expect, it } from 'vitest'
import type { AccessorRefDto, PropertyOptionsDto, TypeSigDto } from '../../../../shared/protocol'
import { PROPERTY_ATTRIBUTES, PROPERTY_FLAGS, hasPropertyFlag, propertyAttributesOf, propertyOptionsDraft, propertyOptionsDto, propertyOptionsError, withPropertyFlag } from './property-options'

const intType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'Int32' }, valueType: true }
const stringType: TypeSigDto = { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'String' } }

const getter: AccessorRefDto = { name: 'get_Count', token: 3, display: 'int32 Property::get_Count()' }

const property = (patch: Partial<PropertyOptionsDto> = {}): PropertyOptionsDto => ({
  attributes: PROPERTY_ATTRIBUTES.SpecialName,
  name: 'Count',
  propertySig: { hasThis: true, propertyType: intType, parameters: [] },
  getMethods: [],
  setMethods: [],
  otherMethods: [],
  customAttributes: [],
  ...patch,
})

describe('property options', () => {
  it('carries the whole model across and back, so an edit cannot drop a property it does not show', () => {
    const value = property({
      constant: { elementType: 0x08, value: '3' },
      getMethods: [getter],
      setMethods: [{ name: 'set_Count', token: 4, display: 'void Property::set_Count(int32)' }],
      otherMethods: [{ name: 'Reset', token: 5, display: 'void Property::Reset()' }],
      propertySig: { hasThis: true, propertyType: stringType, parameters: [intType] },
      customAttributes: [{
        constructor: { declaringType: { kind: 'type', type: { scope: 'mscorlib', namespace: 'System', name: 'ObsoleteAttribute' } }, name: '.ctor', signature: { callingConvention: 0x20, returnType: { kind: 'empty' }, parameters: [] } },
        constructorArguments: [],
        namedArguments: [],
      }],
    })

    expect(propertyOptionsDto(propertyOptionsDraft(value))).toEqual({
      ...value,
      // The bit the constant stands for is derived at the point dnSpy writes it out.
      attributes: value.attributes | PROPERTY_ATTRIBUTES.HasDefault,
    })
  })

  it('turns the Constant checkbox into the HasDefault bit, both ways round', () => {
    // A word that says HasDefault but carries no constant opens with the bit off, and so is written.
    const without = propertyOptionsDraft(property({ attributes: PROPERTY_ATTRIBUTES.HasDefault }))
    expect(hasPropertyFlag(without.attributes, PROPERTY_ATTRIBUTES.HasDefault)).toBe(false)
    expect(propertyAttributesOf(without) & PROPERTY_ATTRIBUTES.HasDefault).toBe(0)

    const with_ = propertyOptionsDraft(property({ constant: { elementType: 0x08, value: '1' } }))
    expect(hasPropertyFlag(with_.attributes, PROPERTY_ATTRIBUTES.HasDefault)).toBe(true)
    expect(propertyAttributesOf(with_) & PROPERTY_ATTRIBUTES.HasDefault).toBe(PROPERTY_ATTRIBUTES.HasDefault)
  })

  it('leaves the rows the picker was dismissed on out of the written model', () => {
    const draft = { ...propertyOptionsDraft(property()), getMethods: [undefined, getter, undefined] }
    expect(propertyOptionsDto(draft).getMethods).toEqual([getter])
  })

  it('lays the Flags box out the way the XAML does, and has no box for the derived bit', () => {
    expect(PROPERTY_FLAGS.map((entry) => entry.label)).toEqual(['SpecialName', 'RTSpecialName'])
    expect(PROPERTY_FLAGS.map((entry) => entry.flag)).not.toContain(PROPERTY_ATTRIBUTES.HasDefault)
    expect(withPropertyFlag(0, PROPERTY_ATTRIBUTES.SpecialName, true)).toBe(PROPERTY_ATTRIBUTES.SpecialName)
    expect(withPropertyFlag(PROPERTY_ATTRIBUTES.RTSpecialName, PROPERTY_ATTRIBUTES.SpecialName, true))
      .toBe(PROPERTY_ATTRIBUTES.RTSpecialName | PROPERTY_ATTRIBUTES.SpecialName)
  })

  it('refuses a signature that is not whole, which is the one thing it cannot write without', () => {
    expect(propertyOptionsError(propertyOptionsDraft(property()))).toBeUndefined()
    expect(propertyOptionsError(propertyOptionsDraft(property({ propertySig: undefined })))?.template)
      .toBe('The property signature is incomplete')
    expect(propertyOptionsError(propertyOptionsDraft(property({ propertySig: { hasThis: true, propertyType: { kind: 'empty' }, parameters: [] } })))?.template)
      .toBe('The property signature is incomplete')
    // An indexer parameter with no type is just as incomplete as the property type itself.
    expect(propertyOptionsError(propertyOptionsDraft(property({ propertySig: { hasThis: true, propertyType: intType, parameters: [{ kind: 'empty' }] } })))?.template)
      .toBe('The property signature is incomplete')
  })

  it('refuses a default value that does not read as the kind it says it is', () => {
    const draft = propertyOptionsDraft(property({ constant: { elementType: 0x08, value: 'x' } }))
    expect(propertyOptionsError(draft)?.template).toBe("'{text}' is not a valid {name}")
  })

  it('reads a signature out of a model that has none, so the dialog opens on an empty one', () => {
    const draft = propertyOptionsDraft(property({ propertySig: undefined }))
    expect(draft.propertySig).toBeUndefined()
    expect(draft.constant).toBeNull()
  })
})
