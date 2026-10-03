import { describe, expect, it } from 'vitest'
import type { ImplMapDto } from '../../../../shared/protocol'
import {
  fieldEntries, fieldValue, hasFlag, implMapError, newImplMap, P_INVOKE, P_INVOKE_FIELDS, withFieldValue, withFlag,
} from './pinvoke'

const field = (label: string): (typeof P_INVOKE_FIELDS)[number] => {
  const found = P_INVOKE_FIELDS.find((entry) => entry.label === label)
  if (!found)
    throw new Error(`No field labelled '${label}'.`)
  return found
}

/** dnSpy sorts every combo by name, so the entries are not in the order of their values. */
const invariantOrder = new Intl.Collator('en', { sensitivity: 'base' })

describe('the four bit fields of the attribute word', () => {
  it('is what dnlib declares, shifted down into the small enums dnSpy shows', () => {
    expect(P_INVOKE_FIELDS.map((entry) => entry.label)).toEqual(['CharSet', 'BestFit', 'ThrowOn...', 'CallConv'])
    expect(field('CharSet').mask).toBe(0x0006)
    expect(field('CharSet').shift).toBe(1)
    expect(field('BestFit').mask).toBe(0x0030)
    expect(field('BestFit').shift).toBe(4)
    expect(field('ThrowOn...').mask).toBe(0x3000)
    expect(field('ThrowOn...').shift).toBe(12)
    expect(field('CallConv').mask).toBe(0x0700)
    expect(field('CallConv').shift).toBe(8)
  })

  it('lists each entry in the order its combo shows it', () => {
    for (const entry of P_INVOKE_FIELDS) {
      const names = entry.entries.map((value) => value.name)
      expect(names).toEqual([...names].sort(invariantOrder.compare))
    }
    expect(field('CharSet').entries.map((entry) => entry.value)).toEqual([2, 6, 0, 4].map((value) => value >> 1))
    expect(field('CallConv').entries.map((entry) => entry.value)).toEqual([2, 5, 3, 4, 1])
  })

  it('reads a field out of the word and writes one back without touching the others', () => {
    const attributes = P_INVOKE.NoMangle | P_INVOKE.CharSetUnicode | P_INVOKE.CallConvStdcall | P_INVOKE.SupportsLastError
    expect(fieldValue(attributes, field('CharSet'))).toBe(P_INVOKE.CharSetUnicode >> 1)
    expect(fieldValue(attributes, field('CallConv'))).toBe(P_INVOKE.CallConvStdcall >> 8)

    const next = withFieldValue(attributes, field('CallConv'), P_INVOKE.CallConvCdecl >> 8)
    expect(next).toBe(P_INVOKE.NoMangle | P_INVOKE.CharSetUnicode | P_INVOKE.CallConvCdecl | P_INVOKE.SupportsLastError)
    expect(fieldValue(next, field('CharSet'))).toBe(P_INVOKE.CharSetUnicode >> 1)
  })

  it('adds an entry of its own for a value the small enum does not name', () => {
    // 0x3 is what the mask alone reads as, and no `BestFit` member has it; dnSpy's `EnumListVM` grows
    // the list with a hex-labelled entry rather than leaving the combo with nothing selected.
    expect(fieldEntries(field('BestFit'), 0)).toBe(field('BestFit').entries)
    expect(fieldEntries(field('BestFit'), 3).map((entry) => entry.name)).toEqual(['Disabled', 'Enabled', 'UseAssem', '0x3'])
    expect(fieldEntries(field('BestFit'), 3)[3].value).toBe(3)
    expect(fieldValue(P_INVOKE.BestFitMask, field('BestFit'))).toBe(3)
  })

  it('keeps the two standalone flags where they are', () => {
    expect(hasFlag(P_INVOKE.NoMangle, P_INVOKE.NoMangle)).toBe(true)
    expect(hasFlag(0, P_INVOKE.SupportsLastError)).toBe(false)
    expect(withFlag(0, P_INVOKE.SupportsLastError, true)).toBe(P_INVOKE.SupportsLastError)
    expect(withFlag(P_INVOKE.NoMangle | P_INVOKE.SupportsLastError, P_INVOKE.NoMangle, false)).toBe(P_INVOKE.SupportsLastError)
  })
})

describe('a fresh P/Invoke row', () => {
  it('is dnSpy\'s own default: no name, no library, no attributes', () => {
    expect(newImplMap()).toEqual({ attributes: 0, name: '', moduleName: '' })
  })

  it('is not written until it names a library, which is what the backend insists on', () => {
    expect(implMapError(undefined)).toBeUndefined()
    expect(implMapError(newImplMap())).toBe('A P/Invoke method needs the name of the native library it calls into.')
    expect(implMapError({ ...newImplMap(), moduleName: undefined })).toBe('A P/Invoke method needs the name of the native library it calls into.')
    expect(implMapError({ ...newImplMap(), moduleName: 'kernel32.dll' })).toBeUndefined()
  })

  it('lets a row through with no entry point, which dnSpy leaves to the writer', () => {
    const value: ImplMapDto = { attributes: 0, name: '', moduleName: 'kernel32.dll' }
    expect(implMapError(value)).toBeUndefined()
  })
})
