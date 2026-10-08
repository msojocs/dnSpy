import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LineBreakpoint } from '../app-store'
import { useAppStore } from '../app-store'
import { BreakpointsPane } from './DebugToolWindows'

const setFunctionBreakpoints = vi.fn(async () => ({}))
const setBreakpoints = vi.fn(async () => [])
const saveCode = vi.fn(async () => '/tmp/breakpoints.json')
const readTextFile = vi.fn(async () => undefined as string | undefined)

/** A breakpoint as it comes back from storage: the workspace that issued its node id is gone. */
const restored = (extra: Partial<LineBreakpoint> = {}): LineBreakpoint => ({
  id: 'line1',
  nodeId: '',
  identity: '/app/DebugTarget.dll|100663297|7',
  requestedLine: 42,
  line: 42,
  endLine: 42,
  state: 'pending',
  enabled: true,
  description: 'System.Void Ns.Type::M()',
  modulePath: '/app/DebugTarget.dll',
  metadataToken: 0x06000001,
  sourceMethodToken: 0x06000001,
  ilOffset: 7,
  ...extra,
})

beforeEach(() => {
  setFunctionBreakpoints.mockClear()
  saveCode.mockClear()
  readTextFile.mockReset()
  Object.defineProperty(window, 'dnSpy', {
    configurable: true,
    value: { ...window.dnSpy, setFunctionBreakpoints, setBreakpoints, saveCode, readTextFile },
  })
  useAppStore.setState({
    lineBreakpoints: [],
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
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', [{ name: 'Ns.Type.A' }, { name: 'Ns.Type.B' }])
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
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', [{ name: 'Ns.Type.A' }, { name: 'Ns.Type.C' }])
  })

  it('labels a restored line breakpoint by the method it was saved in', () => {
    // Nothing has reopened the document, so the row has only what storage held. Two restored rows
    // falling back to "Line 0" would collide on their aria-labels, which is what the method name and
    // the saved line prevent.
    useAppStore.setState({
      lineBreakpoints: [restored(), restored({ id: 'line2', identity: '/app/DebugTarget.dll|100663298|3', line: 61, requestedLine: 61, endLine: 61, metadataToken: 0x06000002, sourceMethodToken: 0x06000002, ilOffset: 3, description: 'System.Void Ns.Type::N()' })],
    })
    render(<BreakpointsPane />)

    expect(screen.getByText('Ns.Type.M:42')).toBeVisible()
    expect(screen.getByText('Ns.Type.N:61')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Disable Ns.Type.M:42' })).toBeChecked()
  })

  it('exports what a restart would have read back', async () => {
    useAppStore.setState({ lineBreakpoints: [restored()], exceptionBreakpoints: ['uncaught'] })
    render(<BreakpointsPane />)

    fireEvent.click(screen.getByRole('button', { name: 'Export Breakpoints' }))

    await waitFor(() => expect(saveCode).toHaveBeenCalled())
    const [suggestedName, text] = saveCode.mock.calls[0] as unknown as [string, string]
    expect(suggestedName).toBe('breakpoints.json')
    expect(JSON.parse(text)).toEqual({
      version: 1,
      breakpoints: [{
        modulePath: '/app/DebugTarget.dll',
        metadataToken: 0x06000001,
        sourceMethodToken: 0x06000001,
        ilOffset: 7,
        line: 42,
        enabled: true,
        description: 'System.Void Ns.Type::M()',
      }],
      functions: [{ name: 'Ns.Type.A', enabled: true }, { name: 'Ns.Type.B', enabled: false }],
      exceptions: ['uncaught'],
    })
    expect(await screen.findByText('Exported breakpoints to /tmp/breakpoints.json.')).toBeVisible()
  })

  it('reports how many breakpoints an imported file added', async () => {
    readTextFile.mockResolvedValue(JSON.stringify({
      version: 1,
      breakpoints: [{ modulePath: '/app/DebugTarget.dll', metadataToken: 0x06000001, sourceMethodToken: 0x06000001, ilOffset: 7, line: 42, enabled: true, description: 'System.Void Ns.Type::M()' }],
      functions: [{ name: 'Ns.Type.A', enabled: true }, { name: 'Ns.Type.C', enabled: true }],
      exceptions: [],
    }))
    render(<BreakpointsPane />)

    fireEvent.click(screen.getByRole('button', { name: 'Import Breakpoints' }))

    // Ns.Type.A was already there, so only two of the three rows are new.
    expect(await screen.findByText('Imported 2 breakpoint(s).')).toBeVisible()
    expect(screen.getByText('Ns.Type.M:42')).toBeVisible()
    expect(useAppStore.getState().functionBreakpoints.map((breakpoint) => breakpoint.name)).toEqual(['Ns.Type.A', 'Ns.Type.B', 'Ns.Type.C'])
  })

  it('says so when the chosen file is not a breakpoint file', async () => {
    readTextFile.mockResolvedValue('{ not json')
    render(<BreakpointsPane />)

    fireEvent.click(screen.getByRole('button', { name: 'Import Breakpoints' }))

    expect(await screen.findByText('The breakpoint file could not be read.')).toBeVisible()
  })
})
