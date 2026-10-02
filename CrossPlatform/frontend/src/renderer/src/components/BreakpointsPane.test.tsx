import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../app-store'
import { BreakpointsPane } from './DebugToolWindows'

const setFunctionBreakpoints = vi.fn(async () => ({}))

beforeEach(() => {
  setFunctionBreakpoints.mockClear()
  Object.defineProperty(window, 'dnSpy', {
    configurable: true,
    value: { ...window.dnSpy, setFunctionBreakpoints },
  })
  useAppStore.setState({
    functionBreakpoints: [{ name: 'Ns.Type.A', enabled: true }, { name: 'Ns.Type.B', enabled: false }],
    exceptionBreakpoints: [],
    debugSessionId: 'session',
  })
})

afterEach(() => {
  cleanup()
})

describe('BreakpointsPane', () => {
  it('lists breakpoints with their enabled state', () => {
    render(<BreakpointsPane />)

    expect(screen.getByText('Ns.Type.A')).toBeVisible()
    expect(screen.getByText('Ns.Type.B')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Disable Ns.Type.A' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Enable Ns.Type.B' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Remove Ns.Type.A' })).toBeInTheDocument()
  })

  it('marks disabled breakpoints and re-enables them from the checkbox', () => {
    const { container } = render(<BreakpointsPane />)
    expect(container.querySelectorAll('.breakpoint-disabled')).toHaveLength(1)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Ns.Type.B' }))

    expect(useAppStore.getState().functionBreakpoints).toEqual([
      { name: 'Ns.Type.A', enabled: true },
      { name: 'Ns.Type.B', enabled: true },
    ])
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', ['Ns.Type.A', 'Ns.Type.B'])
    expect(container.querySelectorAll('.breakpoint-disabled')).toHaveLength(0)
  })

  it('adds a breakpoint for the typed function name', () => {
    render(<BreakpointsPane />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Function breakpoint' }), { target: { value: 'Ns.Type.C' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add function breakpoint' }))

    expect(useAppStore.getState().functionBreakpoints).toEqual([
      { name: 'Ns.Type.A', enabled: true },
      { name: 'Ns.Type.B', enabled: false },
      { name: 'Ns.Type.C', enabled: true },
    ])
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', ['Ns.Type.A', 'Ns.Type.C'])
  })
})
