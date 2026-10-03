import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImplMapDto } from '../../../../shared/protocol'
import { ImplMapEditor } from './ImplMapEditor'
import { P_INVOKE } from './pinvoke'

/** The editor driven the way a dialog drives it: it owns the value and re-renders what it reports. */
const renderEditor = (initial?: ImplMapDto): { changes: (ImplMapDto | undefined)[]; unmount: () => void } => {
  const changes: (ImplMapDto | undefined)[] = []
  const Harness = (): React.JSX.Element => {
    const [value, setValue] = useState(initial)
    return <ImplMapEditor value={value} onChange={(next) => { changes.push(next); setValue(next) }} />
  }
  const { unmount } = render(<Harness />)
  return { changes, unmount }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const combo = (label: string): HTMLSelectElement => screen.getByLabelText(label) as HTMLSelectElement
const last = (changes: (ImplMapDto | undefined)[]): ImplMapDto | undefined => changes[changes.length - 1]

const row = (attributes: number): ImplMapDto => ({ attributes, name: 'MessageBoxW', moduleName: 'user32.dll' })

afterEach(cleanup)

describe('ImplMapEditor', () => {
  it('has no P/Invoke row to begin with, and turns one on empty', () => {
    const { changes } = renderEditor()
    expect(box('Enable')).not.toBeChecked()
    // The boxes stay where they are and go quiet, which is how dnSpy's IsEnabled binding draws them.
    expect(box('Name')).toBeDisabled()
    expect(combo('CallConv')).toBeDisabled()

    fireEvent.click(box('Enable'))
    // dnSpy's defaults: an empty name, an empty library, and no attributes at all.
    expect(last(changes)).toEqual({ attributes: 0, name: '', moduleName: '' })
  })

  it('holds the entry point and the native library', () => {
    const { changes } = renderEditor(row(0))
    expect(box('Name')).toHaveValue('MessageBoxW')
    expect(box('Module')).toHaveValue('user32.dll')

    fireEvent.change(box('Module'), { target: { value: 'kernel32.dll' } })
    expect(last(changes)).toEqual({ attributes: 0, name: 'MessageBoxW', moduleName: 'kernel32.dll' })
  })

  it('says what is missing rather than letting the backend refuse the row', () => {
    const { unmount } = renderEditor({ attributes: 0, name: 'MessageBoxW' })
    expect(screen.getByText('A P/Invoke method needs the name of the native library it calls into.')).toBeTruthy()
    unmount()

    renderEditor(row(0))
    expect(screen.queryByText(/native library/)).toBeNull()
  })

  it('writes each bit field of the attribute word where dnSpy writes it', () => {
    const { changes } = renderEditor(row(P_INVOKE.NoMangle | P_INVOKE.SupportsLastError))

    fireEvent.change(combo('CharSet'), { target: { value: String(P_INVOKE.CharSetUnicode >> 1) } })
    expect(last(changes)?.attributes).toBe(P_INVOKE.NoMangle | P_INVOKE.SupportsLastError | P_INVOKE.CharSetUnicode)

    fireEvent.change(combo('CallConv'), { target: { value: String(P_INVOKE.CallConvStdcall >> 8) } })
    expect(last(changes)?.attributes)
      .toBe(P_INVOKE.NoMangle | P_INVOKE.SupportsLastError | P_INVOKE.CharSetUnicode | P_INVOKE.CallConvStdcall)
  })

  it('lists each field the way dnSpy\'s combo does', () => {
    renderEditor(row(P_INVOKE.CallConvWinapi))
    const names = (label: string): (string | undefined)[] => Array.from(combo(label).options).map((option) => option.textContent)

    expect(names('CharSet')).toEqual(['Ansi', 'Auto', 'NotSpec', 'Unicode'])
    expect(names('BestFit')).toEqual(['Disabled', 'Enabled', 'UseAssem'])
    expect(names('ThrowOn...')).toEqual(['Disabled', 'Enabled', 'UseAssem'])
    expect(names('CallConv')).toEqual(['Cdecl', 'Fastcall', 'Stdcall', 'Thiscall', 'Winapi'])
  })

  it('shows a value none of the entries names as the hex entry dnSpy adds', () => {
    // 0x3 in the BestFit bits is what another tool's file could hold; dnSpy's list grows to hold it.
    renderEditor(row(P_INVOKE.BestFitMask))
    expect(combo('BestFit')).toHaveValue('3')
    expect(Array.from(combo('BestFit').options).map((option) => option.textContent)).toEqual(['Disabled', 'Enabled', 'UseAssem', '0x3'])
  })

  it('reads the fields out of the word it is given', () => {
    renderEditor(row(P_INVOKE.CharSetUnicode | P_INVOKE.CallConvThiscall | P_INVOKE.BestFitDisabled | P_INVOKE.ThrowOnUnmappableCharEnabled))
    expect(combo('CharSet')).toHaveValue(String(P_INVOKE.CharSetUnicode >> 1))
    expect(combo('CallConv')).toHaveValue(String(P_INVOKE.CallConvThiscall >> 8))
    expect(combo('BestFit')).toHaveValue(String(P_INVOKE.BestFitDisabled >> 4))
    expect(combo('ThrowOn...')).toHaveValue(String(P_INVOKE.ThrowOnUnmappableCharEnabled >> 12))
  })

  it('carries the two standalone flags beside the four fields', () => {
    const { changes } = renderEditor(row(P_INVOKE.CharSetAnsi))
    expect(box('NoMangle')).not.toBeChecked()
    expect(box('SupportsLastError')).not.toBeChecked()

    fireEvent.click(box('NoMangle'))
    expect(last(changes)?.attributes).toBe(P_INVOKE.CharSetAnsi | P_INVOKE.NoMangle)
    expect(box('NoMangle')).toBeChecked()
  })

  it('keeps every box in the layout when the control is disabled, and turns them off', () => {
    render(<ImplMapEditor disabled value={row(0)} onChange={vi.fn()} />)

    expect(box('Enable')).toBeDisabled()
    expect(box('Enable')).toBeChecked()
    expect(box('Name')).toBeDisabled()
    expect(box('Module')).toBeDisabled()
    expect(box('NoMangle')).toBeDisabled()
    expect(combo('CallConv')).toBeDisabled()
  })

  it('drops the row when the checkbox is turned off', () => {
    const { changes } = renderEditor(row(0))
    fireEvent.click(box('Enable'))

    expect(last(changes)).toBeUndefined()
    expect(box('Enable')).not.toBeChecked()
    expect(box('Name')).toBeDisabled()
  })
})
