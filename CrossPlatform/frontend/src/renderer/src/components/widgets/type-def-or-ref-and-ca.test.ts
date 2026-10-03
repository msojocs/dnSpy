import { describe, expect, it } from 'vitest'
import type { CustomAttributeDto, TypeDefOrRefAndCaDto, TypeSigDto } from '../../../../shared/protocol'
import {
  newTypeDefOrRefAndCa, typeDefOrRefAndCaDto, typeDefOrRefAndCaError, typeDefOrRefAndCaLabel, typeDefOrRefAndCaDraft,
} from './type-def-or-ref-and-ca'

const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }

/** An attribute as one arrives over the wire, where the constructor it names is always there — which is
 * what a row can be written back from, unlike one that has just been added. */
const attribute = (): CustomAttributeDto => ({
  constructor: {
    declaringType: int32,
    name: '.ctor',
    signature: {
      callingConvention: 0,
      returnType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } },
      parameters: [],
    },
  },
  constructorArguments: [],
  namedArguments: [],
})

const dto = (patch: Partial<TypeDefOrRefAndCaDto> = {}): TypeDefOrRefAndCaDto => ({
  typeDefOrRef: int32,
  customAttributes: [],
  ...patch,
})

describe('opening a row', () => {
  it('takes the type and the attributes it was given', () => {
    const draft = typeDefOrRefAndCaDraft(dto({ customAttributes: [attribute()] }))

    expect(draft.type).toEqual(int32)
    // The attributes are drafts of their own, since one being added has no constructor yet.
    expect(draft.customAttributes).toHaveLength(1)
    expect(draft.customAttributes[0].constructor?.name).toBe('.ctor')
  })
})

describe('the row\'s text', () => {
  it('is the type, in the form the rest of the port writes a signature in', () => {
    expect(typeDefOrRefAndCaLabel(typeDefOrRefAndCaDraft(dto()))).toBe('System.Int32')
    expect(typeDefOrRefAndCaLabel(newTypeDefOrRefAndCa())).toBe('(not set)')
  })
})

describe('a fresh row', () => {
  it('names nothing and carries nothing', () => {
    expect(newTypeDefOrRefAndCa()).toEqual({ type: null, customAttributes: [] })
  })

  it('cannot be accepted until a type is picked', () => {
    expect(typeDefOrRefAndCaError(newTypeDefOrRefAndCa())?.template).toBe('A type is required')
    expect(typeDefOrRefAndCaError(typeDefOrRefAndCaDraft(dto()))).toBeUndefined()
  })

  it('is not accepted for a type that is only half built either', () => {
    expect(typeDefOrRefAndCaError({ type: { kind: 'empty' }, customAttributes: [] })?.template).toBe('A type is required')
    // A generic instance with an argument still to be picked is the half-built shape that is not empty.
    const instance: TypeSigDto = {
      kind: 'genericInst',
      type: { scope: '', namespace: 'System.Collections.Generic', name: 'List' },
      arguments: [{ kind: 'empty' }],
    }
    expect(typeDefOrRefAndCaError({ type: instance, customAttributes: [] })?.template).toBe('A type is required')
  })
})

describe('writing a row back', () => {
  it('writes the type and the attributes', () => {
    const written = typeDefOrRefAndCaDto({ type: int32, customAttributes: [attribute()] })
    expect(written.typeDefOrRef).toEqual(int32)
    expect(written.customAttributes).toHaveLength(1)
    expect(written.customAttributes[0].constructor?.name).toBe('.ctor')
  })

  it('will not write a row with no type, which is what the disabled OK button prevents', () => {
    expect(() => typeDefOrRefAndCaDto(newTypeDefOrRefAndCa())).toThrow()
  })

  it('reads back as the row it was written from, which is what the list does with it', () => {
    const draft = typeDefOrRefAndCaDraft(dto())
    expect(typeDefOrRefAndCaDraft(typeDefOrRefAndCaDto(draft))).toEqual(draft)
  })
})
