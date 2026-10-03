import { describe, expect, it } from 'vitest'
import type { CustomAttributeDto, MethodOptionsDto, TreeNode, TypeSigDto } from '../../../../shared/protocol'
import {
  customAttributeArguments, customAttributeDto, customAttributeDraft, customAttributeError,
  customAttributeLabel, newCustomAttribute, newNamedArgument,
} from './custom-attribute'
import { pickedMethodRef } from './method-ref'

const node = (id: string, label: string, kind: string): TreeNode => ({ id, label, kind, hasChildren: false })

const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }
const string: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'String' } }
const object: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Object' } }

const method = (parameters: TypeSigDto[]): MethodOptionsDto => ({
  implAttributes: 0,
  attributes: 0,
  semanticsAttributes: 0,
  name: '.ctor',
  methodSig: { callingConvention: 0, returnType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } }, parameters },
  customAttributes: [],
  declSecurities: [],
  paramDefs: [],
  genericParameters: [],
  overrides: [],
})

const trail: TreeNode[] = [node('n1', 'Sample', 'module'), node('n2', 'System', 'namespace'), node('n4', 'System.ObsoleteAttribute', 'type')]

describe('customAttributeLabel', () => {
  it('says what has not been set when there is no constructor', () => {
    expect(customAttributeLabel(newCustomAttribute())).toBe('(not set)')
  })

  it('reads as the type and the values it holds, named arguments and all', () => {
    const draft = {
      constructor: pickedMethodRef(trail, method([int32]))!,
      constructorArguments: [{ type: int32, value: { kind: 'primitive' as const, primitive: '7', elementType: 0x08 } }],
      namedArguments: [{ isField: true, name: 'IsError', argument: { type: int32, value: { kind: 'primitive' as const, primitive: '1', elementType: 0x08 } } }],
    }
    expect(customAttributeLabel(draft)).toBe('System.ObsoleteAttribute(7, IsError = 1)')
  })
})

describe('customAttributeError', () => {
  it('wants a constructor before anything else', () => {
    expect(customAttributeError(newCustomAttribute())).toEqual({ template: 'Pick a Constructor' })
  })

  it('reports the first argument the backend would not read, named or positional', () => {
    const constructor = pickedMethodRef(trail, method([int32]))!
    const bad = { type: int32, value: { kind: 'primitive' as const, primitive: 'x', elementType: 0x08 } }
    expect(customAttributeError({ constructor, constructorArguments: [bad], namedArguments: [] })).toEqual({
      template: "'{text}' is not a valid {name}", args: { text: 'x', name: 'Int32' },
    })

    const named = { ...newNamedArgument(), argument: bad }
    expect(customAttributeError({ constructor, constructorArguments: [], namedArguments: [named] })).toEqual({
      template: "'{text}' is not a valid {name}", args: { text: 'x', name: 'Int32' },
    })
    expect(customAttributeError({ constructor, constructorArguments: [], namedArguments: [newNamedArgument()] })).toBeUndefined()
  })
})

describe('customAttributeArguments', () => {
  it('makes one argument per parameter, at the value each one starts at', () => {
    const built = customAttributeArguments(pickedMethodRef(trail, method([int32, string, object]))!)
    expect(built).toEqual([
      { type: int32, value: { kind: 'primitive', primitive: '0', elementType: 0x08 } },
      { type: string, value: { kind: 'null' } },
      { type: object, value: { kind: 'null' } },
    ])
  })
})

describe('customAttributeDto', () => {
  it('hands back what the backend takes once a constructor is there', () => {
    const draft = { constructor: pickedMethodRef(trail, method([]))!, constructorArguments: [], namedArguments: [newNamedArgument()] }
    const dto: CustomAttributeDto = customAttributeDto(draft)
    expect(dto.constructor.name).toBe('.ctor')
    expect(dto.namedArguments).toHaveLength(1)
    expect(customAttributeDraft(dto)).toEqual(draft)
  })

  it('refuses a draft that could not be written', () => {
    expect(() => customAttributeDto(newCustomAttribute())).toThrow('A custom attribute needs a constructor.')
  })

  it('reads a constructor the row has none of as nothing rather than as a null', () => {
    // The dialog opens a row with no constructor at all, and that is how the backend sends one back.
    const wire = (json: string): CustomAttributeDto => JSON.parse(json) as CustomAttributeDto
    expect(customAttributeDraft(wire('{"constructor":null,"constructorArguments":[],"namedArguments":[]}')).constructor).toBeUndefined()
  })
})

describe('newNamedArgument', () => {
  it('starts where CANamedArgumentsVM.Create starts one', () => {
    expect(newNamedArgument()).toEqual({
      isField: false,
      name: 'AttributeProperty',
      argument: { type: int32, value: { kind: 'primitive', primitive: '0', elementType: 0x08 } },
    })
  })
})
