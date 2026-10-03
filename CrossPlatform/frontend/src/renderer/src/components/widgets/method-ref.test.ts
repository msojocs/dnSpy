import { describe, expect, it } from 'vitest'
import type { MethodOptionsDto, TreeNode, TypeSigDto } from '../../../../shared/protocol'
import { methodRefDisplay, methodRefFullName, pickedMethodRef } from './method-ref'

const node = (id: string, label: string, kind: string): TreeNode => ({ id, label, kind, hasChildren: false })

const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }
const string: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'String' } }
const voidSig: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } }

const method = (parameters: TypeSigDto[], name = '.ctor'): MethodOptionsDto => ({
  implAttributes: 0,
  attributes: 0,
  semanticsAttributes: 0,
  name,
  methodSig: { callingConvention: 0, returnType: voidSig, parameters },
  customAttributes: [],
  declSecurities: [],
  paramDefs: [],
  genericParameters: [],
  overrides: [],
})

const trail: TreeNode[] = [node('n1', 'Sample', 'module'), node('n2', 'System', 'namespace'), node('n4', 'System.ObsoleteAttribute', 'type')]

describe('pickedMethodRef', () => {
  it('builds a reference out of the method and the type the picker found it under', () => {
    const reference = pickedMethodRef([...trail, node('n5', '.ctor(System.String)', 'method')], method([string]))
    expect(reference).toEqual({
      declaringType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'ObsoleteAttribute', nodeId: 'n4' } },
      name: '.ctor',
      signature: method([string]).methodSig,
    })
  })

  it('takes the innermost type when the picker walked through a nested one', () => {
    const nested = [...trail, node('n9', 'System.ObsoleteAttribute.Nested', 'type')]
    expect(pickedMethodRef(nested, method([]))?.declaringType.type?.name).toBe('ObsoleteAttribute.Nested')
  })

  it('has nothing to say about a method with no type above it', () => {
    expect(pickedMethodRef([node('n1', 'Sample', 'module')], method([]))).toBeUndefined()
  })

  it('has nothing to say about a method with no signature', () => {
    const { methodSig: _signature, ...withoutSignature } = method([])
    expect(pickedMethodRef(trail, withoutSignature)).toBeUndefined()
  })
})

describe('methodRefDisplay', () => {
  it('reads as the type and the parameters, which is what dnSpy shows beside the picker', () => {
    const reference = pickedMethodRef(trail, method([int32, string]))
    expect(methodRefDisplay(reference!)).toBe('System.ObsoleteAttribute(System.Int32, System.String)')
  })
})

describe('methodRefFullName', () => {
  it('reads the way dnlib writes a method full name: return type, type, name, parameters', () => {
    const reference = pickedMethodRef(trail, method([int32], 'Run'))
    expect(methodRefFullName(reference!)).toBe('System.Void System.ObsoleteAttribute::Run(System.Int32)')
  })
})
