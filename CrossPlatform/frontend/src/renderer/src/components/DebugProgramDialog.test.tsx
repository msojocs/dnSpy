import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../app-store'
import { DebugProgramDialog, parseEnvironment, splitArguments } from './DebugProgramDialog'

const launchDebug = vi.fn(async () => undefined)

beforeEach(() => {
  launchDebug.mockClear()
  useAppStore.setState({ launchDebug, defaultDebugTarget: () => '/tmp/DebugTarget.dll' })
})

afterEach(() => {
  cleanup()
})

const dialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Debug Program' })
const field = (name: string): HTMLElement => within(dialog()).getByLabelText(name)

describe('splitArguments', () => {
  it('splits on whitespace', () => {
    expect(splitArguments('a b  c')).toEqual(['a', 'b', 'c'])
    expect(splitArguments('')).toEqual([])
  })

  it('keeps quoted runs together and drops the quotes', () => {
    expect(splitArguments('"a b" c')).toEqual(['a b', 'c'])
    expect(splitArguments("'a b' \"c'd\"")).toEqual(['a b', "c'd"])
  })

  it('keeps an empty quoted argument, which is not the same as no argument', () => {
    expect(splitArguments('"" x')).toEqual(['', 'x'])
  })
})

describe('parseEnvironment', () => {
  it('reads one KEY=VALUE per line, ignoring blanks', () => {
    expect(parseEnvironment('A=1\n\n  B=two=3  \n')).toEqual({ A: '1', B: 'two=3' })
  })

  it('rejects a line that has no key', () => {
    expect(parseEnvironment('A=1\nNOEQUALSSIGN')).toBeUndefined()
  })
})

describe('DebugProgramDialog', () => {
  it('prefills the executable from the module the workspace has open', () => {
    render(<DebugProgramDialog onClose={vi.fn()} />)

    expect(field('Executable')).toHaveValue('/tmp/DebugTarget.dll')
    // Upstream defaults the CoreCLR page to DontBreak, and so does the port.
    expect(field('Break at')).toHaveValue('dont-break')
  })

  it('launches with the values the dialog collected', () => {
    render(<DebugProgramDialog onClose={vi.fn()} />)

    fireEvent.change(field('Arguments'), { target: { value: '"a b" c' } })
    fireEvent.change(field('Working Directory'), { target: { value: '/tmp' } })
    fireEvent.change(field('Environment Variables'), { target: { value: 'DNSPY_TEST=1' } })
    fireEvent.change(field('Break at'), { target: { value: 'entry-point' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'OK' }))

    expect(launchDebug).toHaveBeenCalledWith({
      program: '/tmp/DebugTarget.dll',
      arguments: ['a b', 'c'],
      workingDirectory: '/tmp',
      environment: { DNSPY_TEST: '1' },
      stopAtEntry: true,
    })
  })

  it('omits a working directory left blank rather than sending an empty string', () => {
    render(<DebugProgramDialog onClose={vi.fn()} />)

    fireEvent.click(within(dialog()).getByRole('button', { name: 'OK' }))

    expect(launchDebug).toHaveBeenCalledWith(expect.objectContaining({ workingDirectory: undefined, stopAtEntry: false }))
  })

  it('disables OK while the executable is empty or the environment cannot be parsed', () => {
    render(<DebugProgramDialog onClose={vi.fn()} />)
    const ok = (): HTMLElement => within(dialog()).getByRole('button', { name: 'OK' })
    expect(ok()).toBeEnabled()

    fireEvent.change(field('Environment Variables'), { target: { value: 'not-a-pair' } })
    expect(ok()).toBeDisabled()

    fireEvent.change(field('Environment Variables'), { target: { value: '' } })
    expect(ok()).toBeEnabled()

    fireEvent.change(field('Executable'), { target: { value: '   ' } })
    expect(ok()).toBeDisabled()
  })

  it('closes without launching on Cancel', () => {
    const onClose = vi.fn()
    render(<DebugProgramDialog onClose={onClose} />)

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(launchDebug).not.toHaveBeenCalled()
  })
})
