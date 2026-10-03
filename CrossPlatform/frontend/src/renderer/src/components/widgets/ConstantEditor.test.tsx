import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConstantDto } from '../../../../shared/protocol'
import { ConstantEditor, constantError } from './ConstantEditor'

/** The editor driven the way a dialog drives it: it owns the value and re-renders what it reports. */
const Harness = ({ initial, ...rest }: { initial: ConstantDto | null } & Partial<Parameters<typeof ConstantEditor>[0]>): React.JSX.Element => {
  const [value, setValue] = useState(initial)
  return <ConstantEditor {...rest} value={value} onChange={setValue} />
}

const valueBox = (): HTMLInputElement => screen.getByLabelText('Value') as HTMLInputElement
const typeBox = (): HTMLSelectElement => screen.getByLabelText('Value type') as HTMLSelectElement

afterEach(cleanup)

describe('ConstantEditor', () => {
  it('has no constant to begin with, and turns one on', () => {
    const onChange = vi.fn()
    render(<ConstantEditor value={null} onChange={onChange} />)

    expect(screen.getByRole('checkbox')).not.toBeChecked()
    // The boxes stay where they are and go quiet, which is how dnSpy's IsEnabled binding draws them.
    expect(typeBox()).toBeDisabled()
    expect(valueBox()).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox'))
    // dnSpy's default kind is Int32, which is the one `ConstantUser` starts at.
    expect(onChange).toHaveBeenCalledWith({ elementType: 0x08, value: '' })
  })

  it('shows the value of the kind it holds and writes a new one back', () => {
    const onChange = vi.fn()
    render(<ConstantEditor value={{ elementType: 0x08, value: '42' }} onChange={onChange} />)

    expect(typeBox()).toHaveValue('8')
    expect(valueBox()).toHaveValue('42')
    fireEvent.change(valueBox(), { target: { value: '43' } })
    expect(onChange).toHaveBeenCalledWith({ elementType: 0x08, value: '43' })
  })

  it('keeps the text when the kind changes, since a number usually stays a number', () => {
    const onChange = vi.fn()
    render(<ConstantEditor value={{ elementType: 0x08, value: '42' }} onChange={onChange} />)

    fireEvent.change(typeBox(), { target: { value: String(0x0A) } })
    expect(onChange).toHaveBeenCalledWith({ elementType: 0x0A, value: '42' })
  })

  it('drops the value box for a null constant, which is what the kind means', () => {
    render(<Harness initial={{ elementType: 0x01 }} />)

    // There is nothing to type, and the row says so rather than leaving an empty box behind.
    expect(screen.queryByLabelText('Value')).toBeNull()
    expect(document.querySelector('.constant-value-label')?.textContent).toBe('null')
  })

  it('refuses a value the kind cannot hold', () => {
    render(<Harness initial={{ elementType: 0x08, value: '4x' }} />)
    expect(screen.getByText("'4x' is not a valid Int32")).toBeTruthy()

    fireEvent.change(valueBox(), { target: { value: '4000000000' } })
    expect(screen.getByText("'4000000000' is not a valid Int32")).toBeTruthy()

    fireEvent.change(typeBox(), { target: { value: String(0x09) } })
    // UInt32 is where 4000000000 belongs, so the same text is fine now.
    expect(screen.queryByText(/is not a valid/)).toBeNull()
  })

  it('holds each kind to what the backend will read back out of it', () => {
    expect(constantError(null)).toBeUndefined()
    expect(constantError({ elementType: 0x01 })).toBeUndefined()
    expect(constantError({ elementType: 0x02, value: 'true' })).toBeUndefined()
    expect(constantError({ elementType: 0x02, value: 'TRUE' })).toBeTruthy()
    expect(constantError({ elementType: 0x03, value: 'x' })).toBeUndefined()
    expect(constantError({ elementType: 0x03, value: 'xy' })).toBeTruthy()
    expect(constantError({ elementType: 0x0C, value: '1.5e3' })).toBeUndefined()
    expect(constantError({ elementType: 0x0D, value: '-0.25' })).toBeUndefined()
    expect(constantError({ elementType: 0x0D, value: 'NaN' })).toBeUndefined()
    expect(constantError({ elementType: 0x0D, value: 'half' })).toBeTruthy()
    // A string takes anything, including the empty one, which is a value in its own right.
    expect(constantError({ elementType: 0x0E, value: '' })).toBeUndefined()
    // And a kind with no literal to check — System.Object — has nothing to be wrong about.
    expect(constantError({ elementType: 0x1C })).toBeUndefined()
  })

  it('says what the checkbox is for, which is the caller that knows', () => {
    render(<ConstantEditor value={null} onChange={vi.fn()} label="Default value for this parameter" tooltip="Default value for this parameter" />)
    expect(screen.getByText('Default value for this parameter')).toBeTruthy()
  })
})
