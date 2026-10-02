import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeStatement, DebugBreakpoint, TreeNode } from '../../shared/protocol'
import { codeStatementAt, lineBreakpointMarkers, methodBreakpointName, statementIdentity, suggestCodeFilename, useAppStore } from './app-store'
import type { LineBreakpoint } from './app-store'

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

const statement = (startLine: number, endLine: number, extra: Partial<CodeStatement> = {}): CodeStatement => ({
  startLine,
  endLine,
  startColumn: 1,
  endColumn: 80,
  ilOffset: startLine,
  ilEndOffset: endLine,
  sequencePointIlOffset: startLine,
  modulePath: '/app/DebugTarget.dll',
  metadataToken: 0x06000001,
  sourceMethodToken: 0x06000001,
  description: 'System.Void Ns.Type::M()',
  isHidden: false,
  ...extra,
})

describe('codeStatementAt', () => {
  const outer = statement(3, 20)
  const inner = statement(8, 10, { description: 'System.Void Ns.Type::Inner()' })

  it('picks the innermost statement that contains the line', () => {
    expect(codeStatementAt([outer, inner], 9)).toBe(inner)
    expect(codeStatementAt([inner, outer], 4)).toBe(outer)
  })

  it('treats the first and last line of a range as inside it', () => {
    expect(codeStatementAt([outer], 3)).toBe(outer)
    expect(codeStatementAt([outer], 20)).toBe(outer)
  })

  it('snaps a click between statements to the nearest one below it', () => {
    const above = statement(2, 2)
    const below = statement(6, 6)
    expect(codeStatementAt([above, below], 4)).toBe(below)
    // A tie goes downwards, matching the backend's snapping.
    expect(codeStatementAt([statement(3, 3), statement(5, 5)], 4)?.startLine).toBe(5)
  })

  it('falls back to the nearest statement above when nothing is below', () => {
    expect(codeStatementAt([statement(2, 2)], 9)?.startLine).toBe(2)
  })

  it('uses the column to tell single-line statements apart', () => {
    const left = statement(4, 4, { startColumn: 1, endColumn: 10, ilOffset: 1 })
    const right = statement(4, 4, { startColumn: 12, endColumn: 30, ilOffset: 2 })
    expect(codeStatementAt([left, right], 4, 5)).toBe(left)
    expect(codeStatementAt([left, right], 4, 20)).toBe(right)
  })

  it('never snaps onto a hidden statement', () => {
    const hidden = statement(4, 4, { isHidden: true })
    const visible = statement(9, 9)
    expect(codeStatementAt([hidden, visible], 4)).toBe(visible)
  })

  it('returns nothing when there is nothing to snap to', () => {
    expect(codeStatementAt([], 3)).toBeUndefined()
    expect(codeStatementAt(undefined, 3)).toBeUndefined()
  })
})

describe('lineBreakpointMarkers', () => {
  const breakpoint = (extra: Partial<LineBreakpoint> = {}): LineBreakpoint => ({
    id: 'line1',
    nodeId: 'method-1',
    identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 7),
    requestedLine: 9,
    line: 9,
    endLine: 9,
    state: 'bound',
    enabled: true,
    modulePath: '/app/DebugTarget.dll',
    metadataToken: 0x06000001,
    ilOffset: 7,
    ...extra,
  })

  it('draws a bound breakpoint at the line the engine snapped it to', () => {
    const statements = [statement(5, 6, { ilOffset: 3 }), statement(7, 8, { ilOffset: 7 })]
    expect(lineBreakpointMarkers('method-1', statements, [breakpoint()])).toEqual([
      { line: 7, enabled: true, state: 'bound', message: undefined, description: undefined },
    ])
  })

  it('draws a pending breakpoint at the line the user clicked', () => {
    const markers = lineBreakpointMarkers('method-1', [statement(7, 8, { ilOffset: 7 })], [
      breakpoint({ state: 'pending', modulePath: undefined, ilOffset: undefined }),
    ])
    expect(markers.map((marker) => marker.line)).toEqual([9])
  })

  it('draws nothing in a document that is not the breakpoint’s', () => {
    const statements = [statement(7, 8, { ilOffset: 7 })]
    // Bound to another module: the IL identity matches nothing here, and there is no requested line to fall back on.
    expect(lineBreakpointMarkers('method-1', statements, [breakpoint({ identity: 'other|1|2' })])).toEqual([])
    // Not yet bound, and requested from a different node.
    expect(lineBreakpointMarkers('method-1', statements, [breakpoint({ nodeId: 'method-2', modulePath: undefined, ilOffset: undefined })])).toEqual([])
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

describe('collapseTreeViewNodes', () => {
  const node = (id: string, kind = 'type'): TreeNode => ({ id, label: id, kind, hasChildren: true })

  const seed = (overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}): void => {
    useAppStore.setState({
      // assembly > ns > type > method, all expanded.
      expanded: { assembly: true, ns: true, type: true, method: true, other: true },
      parents: { ns: 'assembly', type: 'ns', method: 'type', other: 'assembly' },
      children: { assembly: [node('ns')], ns: [node('type')], type: [node('method')] },
      selectedNode: node('method', 'method'),
      ...overrides,
    })
  }

  it('keeps the selected node and its ancestors expanded and collapses the rest', () => {
    seed()
    useAppStore.getState().collapseTreeViewNodes()
    expect(useAppStore.getState().expanded).toEqual({
      assembly: true,
      ns: true,
      type: true,
      method: true,
      other: false,
    })
  })

  it('collapses everything when nothing is selected', () => {
    seed({ selectedNode: undefined })
    useAppStore.getState().collapseTreeViewNodes()
    expect(Object.values(useAppStore.getState().expanded).every((value) => !value)).toBe(true)
  })

  it('keeps an ancestor expanded even when it was never toggled, as long as its children are loaded', () => {
    seed({ expanded: { method: true, other: true }, selectedNode: node('method', 'method') })
    useAppStore.getState().collapseTreeViewNodes()
    expect(useAppStore.getState().expanded).toEqual({
      assembly: true,
      ns: true,
      type: true,
      method: true,
      other: false,
    })
  })

  it('leaves an unwanted ancestor collapsed when its children were never loaded', () => {
    // `ns` is on the path to the selection but has no cached children, so expanding it would need a
    // backend round trip the collapse never asked for.
    seed({ expanded: { method: true }, parents: { type: 'ns', method: 'type' }, children: { type: [node('method')] } })
    useAppStore.getState().collapseTreeViewNodes()
    expect(useAppStore.getState().expanded).toEqual({ type: true, method: true })
  })
})

describe('line breakpoints', () => {
  const statements = [statement(4, 4, { ilOffset: 5 }), statement(9, 9, { ilOffset: 7 })]
  const setBreakpoints = vi.fn(async (_sessionId: string, requested: { id: string; line: number; enabled: boolean }[]): Promise<DebugBreakpoint[]> =>
    requested.map((breakpoint) => ({
      id: breakpoint.id,
      verified: true,
      state: 'bound',
      line: 9,
      endLine: 9,
      column: 1,
      modulePath: '/app/DebugTarget.dll',
      metadataToken: 0x06000001,
      ilOffset: 7,
      description: 'System.Void Ns.Type::M()',
      enabled: breakpoint.enabled,
    })))

  const document = (codeStatements: CodeStatement[] | undefined): never => ({
    nodeId: 'method-1',
    title: 'M',
    language: 'csharp',
    text: '',
    spans: [],
    diagnostics: [],
    codeStatements,
    loading: false,
    requestedLanguage: 'cSharp',
  }) as never

  beforeEach(() => {
    setBreakpoints.mockClear()
    Object.defineProperty(window, 'dnSpy', { configurable: true, value: { ...window.dnSpy, setBreakpoints } })
    useAppStore.setState({
      lineBreakpoints: [],
      functionBreakpoints: [],
      debugSessionId: 'session',
      documents: { 'method-1': document(statements) },
    })
  })

  it('snaps a click to the nearest statement and records what the engine answered', async () => {
    // Line 6 is blank; the nearest statement below it is the one on line 9.
    await useAppStore.getState().toggleLineBreakpoint('method-1', 6)
    const [breakpoint] = useAppStore.getState().lineBreakpoints
    expect(breakpoint.requestedLine).toBe(6)
    expect(breakpoint.line).toBe(9)
    expect(breakpoint.state).toBe('bound')
    expect(breakpoint.identity).toBe(statementIdentity('/app/DebugTarget.dll', 0x06000001, 7))
    expect(setBreakpoints).toHaveBeenLastCalledWith('session', [{ id: breakpoint.id, nodeId: 'method-1', line: 6, enabled: true }])
  })

  it('adopts the engine’s answer when the document has no IL map of its own', async () => {
    // An IL view has no statement table, so the client cannot snap the click itself and starts from the raw line.
    useAppStore.setState({ documents: { 'method-1': document(undefined) } })
    await useAppStore.getState().toggleLineBreakpoint('method-1', 6)
    expect(useAppStore.getState().lineBreakpoints[0]).toMatchObject({
      requestedLine: 6,
      line: 9,
      state: 'bound',
      identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 7),
    })
  })

  it('removes a breakpoint when the same statement is clicked again', async () => {
    await useAppStore.getState().toggleLineBreakpoint('method-1', 6)
    // The user now clicks the dot where it was drawn, not the line they originally clicked.
    await useAppStore.getState().toggleLineBreakpoint('method-1', 9)
    expect(useAppStore.getState().lineBreakpoints).toEqual([])
  })

  it('sends disabled breakpoints too, so the engine can disarm them in place', async () => {
    await useAppStore.getState().toggleLineBreakpoint('method-1', 9)
    const [breakpoint] = useAppStore.getState().lineBreakpoints
    await useAppStore.getState().setLineBreakpointEnabled(breakpoint.id, false)
    expect(setBreakpoints).toHaveBeenLastCalledWith('session', [{ id: breakpoint.id, nodeId: 'method-1', line: 9, enabled: false }])
    expect(useAppStore.getState().lineBreakpoints[0].enabled).toBe(false)
  })

  it('deletes line and function breakpoints together', async () => {
    useAppStore.setState({ functionBreakpoints: [{ name: 'Ns.Type.A', enabled: true }] })
    await useAppStore.getState().toggleLineBreakpoint('method-1', 9)
    await useAppStore.getState().deleteAllBreakpoints()
    expect(useAppStore.getState().lineBreakpoints).toEqual([])
    expect(useAppStore.getState().functionBreakpoints).toEqual([])
    expect(setBreakpoints).toHaveBeenLastCalledWith('session', [])
  })

  it('keeps breakpoints without sending them when no debug session is active', async () => {
    useAppStore.setState({ debugSessionId: undefined })
    await useAppStore.getState().toggleLineBreakpoint('method-1', 9)
    expect(useAppStore.getState().lineBreakpoints).toHaveLength(1)
    expect(setBreakpoints).not.toHaveBeenCalled()
  })
})
