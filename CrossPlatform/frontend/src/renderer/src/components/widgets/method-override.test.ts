import { describe, expect, it } from 'vitest'
import type { MethodOverrideDto, MethodRefDto, TypeSigDto } from '../../../../shared/protocol'
import { methodOverrideDraft, methodOverrideDto, methodOverrideLabel, newMethodOverride } from './method-override'

const voidSig: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } }
const int32: TypeSigDto = { kind: 'type', type: { scope: '', namespace: 'System', name: 'Int32' }, valueType: true }

const reference = (name: string, parameters: TypeSigDto[] = [], display?: string): MethodRefDto => ({
  declaringType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Base' } },
  name,
  signature: { callingConvention: 0, returnType: voidSig, parameters },
  display,
})

describe('methodOverrideLabel', () => {
  it('says what has not been set when there is no declaration', () => {
    expect(methodOverrideLabel(newMethodOverride())).toBe('(not set)')
  })

  it('shows the declaration as the backend wrote it, which is what dnlib names a method', () => {
    expect(methodOverrideLabel({ methodDeclaration: reference('Run', [], 'System.Void System.Base::Run()') }))
      .toBe('System.Void System.Base::Run()')
  })

  it('composes the same text for a declaration that has only just been picked', () => {
    expect(methodOverrideLabel({ methodDeclaration: reference('Run', [int32]) }))
      .toBe('System.Void System.Base::Run(System.Int32)')
  })
})

describe('methodOverrideDto', () => {
  it('carries the body along with the declaration', () => {
    const body = reference('Run')
    const dto = methodOverrideDto({ methodBody: body, methodDeclaration: reference('RunBase') })
    expect(dto.methodBody).toBe(body)
    expect(dto.methodDeclaration.name).toBe('RunBase')
  })

  it('leaves the body out of a row that has not been written yet, which the backend fills in', () => {
    expect(methodOverrideDto({ methodDeclaration: reference('RunBase') }).methodBody).toBeUndefined()
  })

  it('refuses a row with nothing overridden', () => {
    expect(() => methodOverrideDto(newMethodOverride())).toThrow('A method override needs a declaration.')
  })

  it('reads a row out of what the backend sent', () => {
    const dto: MethodOverrideDto = { methodBody: reference('Run'), methodDeclaration: reference('RunBase'), display: 'text' }
    expect(methodOverrideDraft(dto)).toEqual({ methodBody: dto.methodBody, methodDeclaration: dto.methodDeclaration })
  })
})
