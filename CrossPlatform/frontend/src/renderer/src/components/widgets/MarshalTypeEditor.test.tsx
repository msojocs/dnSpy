import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarshalTypeDto } from '../../../../shared/protocol'
import { MarshalTypeEditor } from './MarshalTypeEditor'
import { NATIVE_TYPE, VARIANT_TYPE } from './marshal-type'

/** The editor driven the way a dialog drives it: it owns the value and re-renders what it reports. */
const renderEditor = (initial?: MarshalTypeDto): { changes: (MarshalTypeDto | undefined)[]; unmount: () => void } => {
  const changes: (MarshalTypeDto | undefined)[] = []
  const Harness = (): React.JSX.Element => {
    const [value, setValue] = useState(initial)
    return (
      <MarshalTypeEditor
        workspaceId="ws"
        value={value}
        onChange={(next) => { changes.push(next); setValue(next) }}
      />
    )
  }
  const { unmount } = render(<Harness />)
  return { changes, unmount }
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement
const queryBox = (label: string): HTMLInputElement | null => screen.queryByLabelText(label) as HTMLInputElement | null
const combo = (label: string): HTMLSelectElement => screen.getByLabelText(label) as HTMLSelectElement
const last = (changes: (MarshalTypeDto | undefined)[]): MarshalTypeDto | undefined => changes[changes.length - 1]

const enable = (): void => { fireEvent.click(box('Enable')) }

afterEach(cleanup)

describe('MarshalTypeEditor', () => {
  it('has no marshal type to begin with, and turns one on at dnSpy\'s default native type', () => {
    const { changes } = renderEditor()
    expect(box('Enable')).not.toBeChecked()
    // The boxes stay where they are and go quiet, which is how dnSpy's IsEnabled binding draws them.
    expect(combo('NativeType')).toBeDisabled()

    enable()
    expect(last(changes)).toEqual({ nativeType: NATIVE_TYPE.ANSIBStr })
  })

  it('offers the native types dnSpy lists, in its order, sans sentinel', () => {
    renderEditor({ nativeType: NATIVE_TYPE.ANSIBStr })
    const options = Array.from(combo('NativeType').options)

    expect(options).toHaveLength(49)
    expect(options[0].textContent).toBe('ANSIBStr')
    expect(options.map((option) => option.textContent)).not.toContain('<Not Initialized>')
    expect(options.find((option) => option.textContent === 'RawBlob')?.value).toBe('-1')
  })

  it('turns every box off at once when the control is disabled', () => {
    render(<MarshalTypeEditor workspaceId="ws" disabled value={{ nativeType: NATIVE_TYPE.FixedSysString, size: 4 }} onChange={vi.fn()} />)

    expect(box('Enable')).toBeDisabled()
    expect(combo('NativeType')).toBeDisabled()
    expect(box('Size')).toBeDisabled()
  })

  it('shows the payload of the native type it is on and no other', () => {
    const { unmount } = render(<MarshalTypeEditor workspaceId="ws" value={{ nativeType: NATIVE_TYPE.RawBlob }} onChange={vi.fn()} />)
    expect(box('Data')).toBeTruthy()
    expect(queryBox('Size')).toBeNull()
    expect(screen.queryByLabelText('VT')).toBeNull()
    unmount()

    render(<MarshalTypeEditor workspaceId="ws" value={{ nativeType: NATIVE_TYPE.FixedSysString }} onChange={vi.fn()} />)
    expect(box('Size')).toBeTruthy()
    expect(queryBox('Data')).toBeNull()
  })

  it('shows a raw blob as hex and writes it back as the base64 the backend carries', () => {
    const { changes } = renderEditor({ nativeType: NATIVE_TYPE.RawBlob, rawData: btoa('\x01\x02\xff') })
    expect(box('Data')).toHaveValue('0102ff')

    fireEvent.change(box('Data'), { target: { value: 'aabb' } })
    expect(last(changes)?.rawData).toBe(btoa('\xaa\xbb'))
  })

  it('leaves the value alone while a number box holds something that is not a number', () => {
    const { changes } = renderEditor({ nativeType: NATIVE_TYPE.FixedSysString })
    fireEvent.change(box('Size'), { target: { value: '4x' } })

    // The half-typed text stays in the box, and the value keeps what it had.
    expect(changes).toEqual([])
    expect(box('Size')).toHaveValue('4x')

    // dnSpy reports this as an error; here the box simply falls back to the value on the way out.
    fireEvent.blur(box('Size'))
    expect(box('Size')).toHaveValue('')
  })

  it('reads a number out of a box and drops the field when the box is emptied', () => {
    const { changes } = renderEditor({ nativeType: NATIVE_TYPE.FixedSysString, size: 4 })
    fireEvent.change(box('Size'), { target: { value: '12' } })
    expect(last(changes)?.size).toBe(12)

    fireEvent.change(box('Size'), { target: { value: '' } })
    expect(last(changes)?.size).toBeUndefined()
  })

  it('splits a safe array\'s variant type from its flags', () => {
    const { changes } = renderEditor({ nativeType: NATIVE_TYPE.SafeArray, variantType: VARIANT_TYPE.Empty })
    expect(combo('VT')).toHaveValue(String(VARIANT_TYPE.Empty))
    // The four flags live in the top bits and are editable only once a variant type has been picked.
    expect(box('Vector')).not.toBeChecked()

    fireEvent.click(box('Vector'))
    expect(last(changes)?.variantType).toBe(VARIANT_TYPE.Empty | 0x1000)
  })

  it('holds the flags until a variant type is picked, and takes the subtype with them', () => {
    const { changes } = renderEditor({ nativeType: NATIVE_TYPE.SafeArray, variantType: VARIANT_TYPE.NotInitialized })
    expect(combo('VT')).toHaveValue(String(VARIANT_TYPE.NotInitialized))
    expect(box('Vector')).toBeDisabled()
    // dnSpy folds this one into an expander, and it is off until the VT says what the type is.
    expect(screen.queryByText('Type')).toBeNull()

    fireEvent.change(combo('VT'), { target: { value: String(VARIANT_TYPE.I4) } })
    expect(last(changes)?.variantType).toBe(VARIANT_TYPE.I4)
    expect(box('Vector')).not.toBeDisabled()

    fireEvent.change(combo('VT'), { target: { value: String(VARIANT_TYPE.NotInitialized) } })
    // Back to the sentinel: the flags go with it, which is `SafeArrayMarshalType_VT = 0` in dnSpy.
    expect(last(changes)?.variantType).toBe(VARIANT_TYPE.NotInitialized)
  })

  it('hangs the array boxes off one another and clears the ones that stop applying', () => {
    const { changes } = renderEditor({
      nativeType: NATIVE_TYPE.Array,
      elementType: NATIVE_TYPE.I4,
      paramNumber: 1,
      numberOfElements: 2,
      flags: 3,
    })
    expect(box('ParamNum')).toBeEnabled()
    expect(box('NumElems')).toBeEnabled()
    expect(box('Flags')).toBeEnabled()

    fireEvent.change(combo('ElemType'), { target: { value: String(NATIVE_TYPE.NotInitialized) } })
    expect(last(changes)).toEqual({ nativeType: NATIVE_TYPE.Array, elementType: NATIVE_TYPE.NotInitialized })
    expect(box('ParamNum')).toBeDisabled()
    expect(box('ParamNum')).toHaveValue('')
    expect(box('NumElems')).toHaveValue('')
    expect(box('Flags')).toHaveValue('')
  })

  it('takes the element count and the flags with an emptied parameter number', () => {
    const { changes } = renderEditor({
      nativeType: NATIVE_TYPE.Array,
      elementType: NATIVE_TYPE.I4,
      paramNumber: 1,
      numberOfElements: 2,
      flags: 3,
    })

    fireEvent.change(box('ParamNum'), { target: { value: '' } })
    expect(last(changes)).toEqual({ nativeType: NATIVE_TYPE.Array, elementType: NATIVE_TYPE.I4 })
    expect(box('NumElems')).toBeDisabled()
    expect(box('NumElems')).toHaveValue('')
  })

  it('starts an array with no element type at all, since that is the combo\'s first entry', () => {
    renderEditor({ nativeType: NATIVE_TYPE.Array })
    expect(combo('ElemType')).toHaveValue(String(NATIVE_TYPE.NotInitialized))
    expect(box('ParamNum')).toBeDisabled()
  })

  it('needs a size before a fixed array says what its elements are', () => {
    const { changes } = renderEditor({ nativeType: NATIVE_TYPE.FixedArray })
    expect(combo('ElemType')).toBeDisabled()

    fireEvent.change(box('Size'), { target: { value: '4' } })
    expect(last(changes)).toEqual({ nativeType: NATIVE_TYPE.FixedArray, size: 4 })
    expect(combo('ElemType')).toBeEnabled()
  })

  it('carries a parameter index for the three interface marshallers only', () => {
    const { unmount } = renderEditor({ nativeType: NATIVE_TYPE.IUnknown })
    expect(box('ParamIndex')).toBeTruthy()
    unmount()

    const { unmount: second } = renderEditor({ nativeType: NATIVE_TYPE.Struct })
    expect(queryBox('ParamIndex')).toBeNull()
    second()
  })

  it('writes the four custom-marshaller fields', () => {
    const { changes } = renderEditor({ nativeType: NATIVE_TYPE.CustomMarshaler, guid: '{...}' })
    // Both the combo and the name box are labelled NativeType, which is what dnSpy's own control does.
    expect(screen.getAllByLabelText('NativeType')).toHaveLength(2)
    expect(box('GUID')).toHaveValue('{...}')

    fireEvent.change(box('Cookie'), { target: { value: 'cookie' } })
    expect(last(changes)?.cookie).toBe('cookie')

    fireEvent.change(screen.getAllByLabelText('NativeType')[1], { target: { value: 'Native' } })
    expect(last(changes)?.nativeTypeName).toBe('Native')
  })

  it('keeps the payload fields of the native type it leaves, which dnSpy\'s VM does too', () => {
    const onChange = vi.fn()
    render(<MarshalTypeEditor workspaceId="ws" value={{ nativeType: NATIVE_TYPE.RawBlob, rawData: btoa('\x01') }} onChange={onChange} />)

    fireEvent.change(combo('NativeType'), { target: { value: String(NATIVE_TYPE.Array) } })
    // The backend only reads the fields its native type uses, so a stale one is never written.
    expect(onChange).toHaveBeenCalledWith({ nativeType: NATIVE_TYPE.Array, rawData: btoa('\x01') })
  })

  it('shows what the two embedded signature editors hold', () => {
    const { unmount } = render(<MarshalTypeEditor workspaceId="ws" value={{ nativeType: NATIVE_TYPE.SafeArray, variantType: VARIANT_TYPE.I4 }} onChange={vi.fn()} />)
    expect(document.querySelectorAll('.marshal-type-sig .typesig-editor')).toHaveLength(1)
    unmount()

    render(<MarshalTypeEditor workspaceId="ws" value={{ nativeType: NATIVE_TYPE.CustomMarshaler }} onChange={vi.fn()} />)
    expect(document.querySelectorAll('.marshal-type-sig .typesig-editor')).toHaveLength(1)
  })

  it('leaves the signatures out of a native type that has none', () => {
    render(<MarshalTypeEditor workspaceId="ws" value={{ nativeType: NATIVE_TYPE.I4 }} onChange={vi.fn()} />)
    expect(document.querySelectorAll('.typesig-editor')).toHaveLength(0)
  })

  it('has no payload to offer when the checkbox is off', () => {
    renderEditor(undefined)
    expect(within(document.body).queryByLabelText('Data')).toBeNull()
    expect(within(document.body).queryByLabelText('VT')).toBeNull()
    expect(within(document.body).queryByText('Vector')).toBeNull()
  })
})
