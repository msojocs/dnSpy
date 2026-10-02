import { beforeEach, describe, expect, it, vi } from 'vitest'
import { breakpointLocationAt, breakpointMarkers, methodBreakpointName, suggestCodeFilename, useAppStore } from './app-store'

describe('suggestCodeFilename', () => {
  it.each([
    ['Example', 'csharp', 'Example.cs'],
    ['Example', 'visual-basic', 'Example.vb'],
    ['Example', 'il', 'Example.il'],
    ['View.xaml', 'xml', 'View.xaml.xml'],
    ['Resource', 'plaintext', 'Resource.txt'],
  ])('uses the current document language for %s', (title, language, expected) => {
    expect(suggestCodeFilename(title, language)).toBe(expected)
  })

  it('removes characters that are invalid in native save dialogs', () => {
    expect(suggestCodeFilename('A/B:C*? ', 'csharp')).toBe('A_B_C__.cs')
    expect(suggestCodeFilename('...', 'il')).toBe('code.il')
  })
})

describe('methodBreakpointName', () => {
  it.each([
    ['System.Void DebugTarget.Program::Calculate(System.Int32,System.Int32)', 'DebugTarget.Program.Calculate'],
    ['System.Void System.Resources.ResourceManager::.ctor(System.Type)', 'System.Resources.ResourceManager..ctor'],
    ['System.Collections.Generic.List`1<System.Int32> Ns.Type::M()', 'Ns.Type.M'],
    ['System.Int32[] Ns.Type::M()', 'Ns.Type.M'],
    ['System.Void Ns.Outer/Inner::M()', 'Ns.Outer.Inner.M'],
    ['DebugTarget.Program.Calculate', 'DebugTarget.Program.Calculate'],
    ['DebugTarget.Program.Calculate(System.Int32)', 'DebugTarget.Program.Calculate'],
    ['', undefined],
    ['   ', undefined],
    [undefined, undefined],
  ])('normalizes %s', (description, expected) => {
    expect(methodBreakpointName(description)).toBe(expected)
  })
})

describe('breakpointLocationAt', () => {
  const outer = { startLine: 3, endLine: 20, description: 'System.Void Ns.Type::Outer()' }
  const inner = { startLine: 8, endLine: 10, description: 'System.Void Ns.Type::Inner()' }

  it('picks the innermost location that contains the line', () => {
    expect(breakpointLocationAt([outer, inner], 9)).toBe(inner)
    expect(breakpointLocationAt([inner, outer], 4)).toBe(outer)
  })

  it('treats the first and last line of a range as inside it', () => {
    expect(breakpointLocationAt([outer], 3)).toBe(outer)
    expect(breakpointLocationAt([outer], 20)).toBe(outer)
    expect(breakpointLocationAt([outer], 21)).toBeUndefined()
  })

  it('returns nothing for lines no method owns', () => {
    expect(breakpointLocationAt([outer], 2)).toBeUndefined()
    expect(breakpointLocationAt([], 3)).toBeUndefined()
    expect(breakpointLocationAt(undefined, 3)).toBeUndefined()
  })
})

describe('breakpointMarkers', () => {
  it('marks the earliest line of the method each breakpoint names', () => {
    const locations = [
      { startLine: 7, endLine: 7, description: 'System.Int32 Ns.Type::get_Code()' },
      { startLine: 12, endLine: 18, description: 'System.Void Ns.Type::.ctor()' },
    ]
    expect(breakpointMarkers(locations, [
      { name: 'Ns.Type.get_Code', enabled: true },
      { name: 'Ns.Type..ctor', enabled: false },
    ])).toEqual([
      { line: 7, name: 'Ns.Type.get_Code', enabled: true },
      { line: 12, name: 'Ns.Type..ctor', enabled: false },
    ])
  })

  it('uses the first run when a method is split over several locations', () => {
    const locations = [
      { startLine: 14, endLine: 15, description: 'System.Void Ns.Type::M()' },
      { startLine: 4, endLine: 6, description: 'System.Void Ns.Type::M()' },
    ]
    expect(breakpointMarkers(locations, [{ name: 'Ns.Type.M', enabled: true }])).toEqual([
      { line: 4, name: 'Ns.Type.M', enabled: true },
    ])
  })

  it('draws nothing for breakpoints the document cannot place', () => {
    const locations = [{ startLine: 4, endLine: 6, description: 'System.Void Ns.Type::M()' }]
    expect(breakpointMarkers(locations, [{ name: 'Ns.Type.Other', enabled: true }])).toEqual([])
    expect(breakpointMarkers(undefined, [{ name: 'Ns.Type.M', enabled: true }])).toEqual([])
  })
})

describe('function breakpoints', () => {
  const setFunctionBreakpoints = vi.fn(async () => ({}))

  beforeEach(() => {
    setFunctionBreakpoints.mockClear()
    Object.defineProperty(window, 'dnSpy', {
      configurable: true,
      value: { ...window.dnSpy, setFunctionBreakpoints },
    })
    useAppStore.setState({ functionBreakpoints: [], exceptionBreakpoints: [], debugSessionId: 'session' })
  })

  it('adds, toggles and removes breakpoints', async () => {
    await useAppStore.getState().addFunctionBreakpoint(' Ns.Type.A ')
    await useAppStore.getState().addFunctionBreakpoint('Ns.Type.A')
    expect(useAppStore.getState().functionBreakpoints).toEqual([{ name: 'Ns.Type.A', enabled: true }])
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', ['Ns.Type.A'])

    await useAppStore.getState().toggleFunctionBreakpoint('Ns.Type.A')
    expect(useAppStore.getState().functionBreakpoints).toEqual([])

    await useAppStore.getState().toggleFunctionBreakpoint('Ns.Type.B')
    expect(useAppStore.getState().functionBreakpoints).toEqual([{ name: 'Ns.Type.B', enabled: true }])
  })

  it('sends only enabled breakpoints to the debug adapter', async () => {
    useAppStore.setState({
      functionBreakpoints: [{ name: 'Ns.Type.A', enabled: true }, { name: 'Ns.Type.B', enabled: false }],
    })
    await useAppStore.getState().addFunctionBreakpoint('Ns.Type.C')
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', ['Ns.Type.A', 'Ns.Type.C'])
  })

  it('enables and disables every breakpoint', async () => {
    useAppStore.setState({ functionBreakpoints: [{ name: 'Ns.Type.A', enabled: true }, { name: 'Ns.Type.B', enabled: false }] })

    await useAppStore.getState().setAllFunctionBreakpointsEnabled(false)
    expect(useAppStore.getState().functionBreakpoints.every((breakpoint) => !breakpoint.enabled)).toBe(true)
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', [])

    await useAppStore.getState().setAllFunctionBreakpointsEnabled(true)
    expect(useAppStore.getState().functionBreakpoints.every((breakpoint) => breakpoint.enabled)).toBe(true)
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', ['Ns.Type.A', 'Ns.Type.B'])
  })

  it('enables and disables a single breakpoint', async () => {
    useAppStore.setState({ functionBreakpoints: [{ name: 'Ns.Type.A', enabled: true }, { name: 'Ns.Type.B', enabled: false }] })

    await useAppStore.getState().setFunctionBreakpointEnabled('Ns.Type.B', true)
    expect(useAppStore.getState().functionBreakpoints).toEqual([
      { name: 'Ns.Type.A', enabled: true },
      { name: 'Ns.Type.B', enabled: true },
    ])
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', ['Ns.Type.A', 'Ns.Type.B'])

    await useAppStore.getState().setFunctionBreakpointEnabled('Ns.Type.A', false)
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', ['Ns.Type.B'])
  })

  it('deletes every breakpoint', async () => {
    useAppStore.setState({ functionBreakpoints: [{ name: 'Ns.Type.A', enabled: true }] })
    await useAppStore.getState().deleteAllFunctionBreakpoints()
    expect(useAppStore.getState().functionBreakpoints).toEqual([])
    expect(setFunctionBreakpoints).toHaveBeenLastCalledWith('session', [])
  })

  it('keeps breakpoints without sending them when no debug session is active', async () => {
    useAppStore.setState({ debugSessionId: undefined })
    await useAppStore.getState().addFunctionBreakpoint('Ns.Type.A')
    expect(useAppStore.getState().functionBreakpoints).toEqual([{ name: 'Ns.Type.A', enabled: true }])
    expect(setFunctionBreakpoints).not.toHaveBeenCalled()
  })
})
