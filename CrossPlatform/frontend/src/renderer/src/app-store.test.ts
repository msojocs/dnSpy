import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeStatement, DebugBreakpoint, TreeNode } from '../../shared/protocol'
import { bookmarkEntries, bookmarkLineInDocument, bookmarkMarkers, codeStatementAt, filterBookmarks, lineBreakpointMarkers, methodBreakpointName, parseBookmarkEntries, statementIdentity, suggestCodeFilename, useAppStore } from './app-store'
import type { Bookmark, LineBreakpoint } from './app-store'
import { translate } from './localization'

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

describe('C# Interactive', () => {
  const evaluateScript = vi.fn()
  const resetScript = vi.fn()
  const banner = { kind: 'banner', text: 'Microsoft (R) Roslyn C# Compiler version 4.14.0' }

  beforeEach(() => {
    evaluateScript.mockReset().mockResolvedValue({ entries: [{ kind: 'result', text: '2' }] })
    resetScript.mockReset().mockResolvedValue({ entries: [banner] })
    Object.defineProperty(window, 'dnSpy', { configurable: true, value: { ...window.dnSpy, evaluateScript, resetScript } })
    useAppStore.setState({ scriptEntries: [], scriptRunning: false, scriptHistory: [], scriptStarted: false })
  })

  it('echoes a submission and appends what the host returned', async () => {
    await useAppStore.getState().evaluateScript('  1 + 1  ')

    expect(evaluateScript).toHaveBeenCalledWith('1 + 1')
    expect(useAppStore.getState().scriptEntries).toEqual([
      { kind: 'echo', text: '1 + 1' },
      { kind: 'result', text: '2' },
    ])
    expect(useAppStore.getState().scriptRunning).toBe(false)
  })

  it('ignores a blank submission', async () => {
    await useAppStore.getState().evaluateScript('   ')

    expect(evaluateScript).not.toHaveBeenCalled()
    expect(useAppStore.getState().scriptEntries).toEqual([])
    expect(useAppStore.getState().scriptHistory).toEqual([])
  })

  it.each(['#clear', '#cls'])('clears the log for %s without asking the host', async (command) => {
    useAppStore.setState({ scriptEntries: [{ kind: 'output', text: 'earlier' }] })

    await useAppStore.getState().evaluateScript(command)

    expect(evaluateScript).not.toHaveBeenCalled()
    expect(useAppStore.getState().scriptEntries).toEqual([])
  })

  it('prints the help text without asking the host', async () => {
    await useAppStore.getState().evaluateScript('#help')

    expect(evaluateScript).not.toHaveBeenCalled()
    const entries = useAppStore.getState().scriptEntries
    expect(entries[0]).toEqual({ kind: 'echo', text: '#help' })
    expect(entries.some((entry) => entry.text.includes('#reset'))).toBe(true)
    expect(entries.some((entry) => entry.text.includes('#load'))).toBe(true)
  })

  it('resets the session for #reset and reports the new banner', async () => {
    await useAppStore.getState().evaluateScript('#reset')

    expect(resetScript).toHaveBeenCalledOnce()
    expect(useAppStore.getState().scriptEntries).toEqual([
      { kind: 'echo', text: '#reset' },
      { kind: 'output', text: translate('Resetting execution engine.') },
      banner,
    ])
  })

  it('leaves an unknown #command to the host', async () => {
    await useAppStore.getState().evaluateScript('#nonsense')

    expect(evaluateScript).toHaveBeenCalledWith('#nonsense')
  })

  it('keeps a history of submissions, without consecutive duplicates', async () => {
    await useAppStore.getState().evaluateScript('1 + 1')
    await useAppStore.getState().evaluateScript('1 + 1')
    await useAppStore.getState().evaluateScript('2 + 2')

    expect(useAppStore.getState().scriptHistory).toEqual(['1 + 1', '2 + 2'])
  })

  it('narrates an explicit reset and prints the fresh banner', async () => {
    await useAppStore.getState().resetScript()

    expect(useAppStore.getState().scriptEntries).toEqual([
      { kind: 'output', text: translate('Resetting execution engine.') },
      banner,
    ])
  })

  it('builds the session once, printing the banner and the help hint', async () => {
    await useAppStore.getState().startScript()
    await useAppStore.getState().startScript()

    expect(resetScript).toHaveBeenCalledOnce()
    const entries = useAppStore.getState().scriptEntries
    expect(entries[0]).toEqual(banner)
    expect(entries[entries.length - 1]).toEqual({ kind: 'help', text: translate('Type "#help" for more information.') })
  })

  it('reports a host failure as an error line', async () => {
    evaluateScript.mockRejectedValue(new Error('backend is gone'))

    await useAppStore.getState().evaluateScript('1 + 1')

    expect(useAppStore.getState().scriptEntries[1]).toEqual({
      kind: 'error',
      text: translate('Script failed: {message}', { message: 'backend is gone' }),
    })
    expect(useAppStore.getState().scriptRunning).toBe(false)
  })
})

describe('bookmarks', () => {
  // The token the snap produces has to be the statement's IL offset, not the line that was clicked.
  const statements: CodeStatement[] = [
    statement(4, 4, { ilOffset: 4 }),
    statement(9, 9, { ilOffset: 7 }),
    statement(14, 14, { ilOffset: 11, metadataToken: 0x06000002, sourceMethodToken: 0x06000002, description: 'System.Void Ns.Type::N()' }),
  ]

  const doc = (codeStatements: CodeStatement[] | undefined): never => ({
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

  const bookmark = (extra: Partial<Bookmark> = {}): Bookmark => ({
    id: 'bookmark1',
    nodeId: 'method-1',
    identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 4),
    modulePath: '/app/DebugTarget.dll',
    metadataToken: 0x06000001,
    ilOffset: 4,
    line: 4,
    description: 'System.Void Ns.Type::M()',
    name: 'First',
    labels: [],
    enabled: true,
    order: 1,
    ...extra,
  })

  const openNodeById = vi.fn(async (nodeId: string) => nodeId)

  beforeEach(() => {
    localStorage.clear()
    openNodeById.mockClear()
    useAppStore.setState({
      bookmarks: [],
      activeBookmarkId: undefined,
      bookmarksReveal: undefined,
      output: [],
      workspaceId: 'ws1',
      openNodeById,
      documents: { 'method-1': doc(statements) },
    })
  })

  const stored = (): unknown => JSON.parse(localStorage.getItem('dnspy.bookmarks.v1') ?? 'null')

  it('names a bookmark by the statement it landed on, not the line that was clicked', () => {
    // Line 8 is blank; the nearest statement is the one below it on line 9.
    useAppStore.getState().toggleBookmark('method-1', 8)

    const [created] = useAppStore.getState().bookmarks
    expect(created).toMatchObject({
      nodeId: 'method-1',
      identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 7),
      modulePath: '/app/DebugTarget.dll',
      metadataToken: 0x06000001,
      ilOffset: 7,
      line: 9,
      labels: [],
      enabled: true,
    })
    expect(created.name).toBe(translate('Bookmark {number}', { number: created.order }))
    // Making one selects it, so "next bookmark" has somewhere to continue from.
    expect(useAppStore.getState().activeBookmarkId).toBe(created.id)
  })

  it('removes the bookmark when the same statement is clicked again', () => {
    useAppStore.getState().toggleBookmark('method-1', 8)
    // The user now clicks the marker where it was drawn, not the blank line they started on.
    useAppStore.getState().toggleBookmark('method-1', 9)

    expect(useAppStore.getState().bookmarks).toEqual([])
    expect(useAppStore.getState().activeBookmarkId).toBeUndefined()
  })

  it('keeps a bookmark whose line has no statement, but only for this session', () => {
    useAppStore.setState({ documents: { 'method-1': doc(undefined) } })
    useAppStore.getState().toggleBookmark('method-1', 30)

    expect(useAppStore.getState().bookmarks[0]).toMatchObject({
      identity: 'method-1|30',
      modulePath: '',
      metadataToken: 0,
      line: 30,
    })
    // There is nothing stable to write down, so it never reaches storage.
    expect(stored()).toEqual([])
  })

  it('writes what a restart needs and reads it back', () => {
    useAppStore.getState().toggleBookmark('method-1', 9)
    const [created] = useAppStore.getState().bookmarks

    const entries = stored()
    expect(entries).toEqual([
      {
        modulePath: '/app/DebugTarget.dll',
        metadataToken: 0x06000001,
        ilOffset: 7,
        description: 'System.Void Ns.Type::M()',
        name: created.name,
        labels: [],
        enabled: true,
      },
    ])
    expect(parseBookmarkEntries(entries)).toEqual(entries)
    expect(bookmarkEntries([created])).toEqual(entries)
  })

  it('accepts both the exported wrapper and a bare array when reading a file', () => {
    const entry = bookmarkEntries([bookmark()])
    expect(parseBookmarkEntries({ version: 1, bookmarks: entry })).toEqual(entry)
    expect(parseBookmarkEntries(entry)).toEqual(entry)
    expect(parseBookmarkEntries({ nope: true })).toEqual([])
    expect(parseBookmarkEntries([{ modulePath: '/a.dll' }, 'junk', null])).toEqual([])
  })

  it('drops the fields a damaged row cannot do without, and defaults the rest', () => {
    const [parsed] = parseBookmarkEntries([{ modulePath: '/a.dll', metadataToken: 6, ilOffset: 3 }])
    expect(parsed).toEqual({ modulePath: '/a.dll', metadataToken: 6, ilOffset: 3, description: '', name: translate('Bookmark'), labels: [], enabled: true })
  })

  it('flips the enabled flag from the marker and from the pane', () => {
    useAppStore.getState().toggleBookmark('method-1', 9)
    const [created] = useAppStore.getState().bookmarks

    useAppStore.getState().toggleBookmarkEnabledAt('method-1', 9)
    expect(useAppStore.getState().bookmarks[0].enabled).toBe(false)

    useAppStore.getState().toggleBookmarkEnabledAt('method-1', 8)
    expect(useAppStore.getState().bookmarks[0].enabled).toBe(true)

    useAppStore.getState().setBookmarkEnabled(created.id, false)
    expect(useAppStore.getState().bookmarks[0].enabled).toBe(false)
    useAppStore.getState().setAllBookmarksEnabled(true)
    expect(useAppStore.getState().bookmarks[0].enabled).toBe(true)
  })

  it('toggles a marker that does not exist without creating one', () => {
    useAppStore.getState().toggleBookmarkEnabledAt('method-1', 9)
    expect(useAppStore.getState().bookmarks).toEqual([])
  })

  it('removes one, several, or every bookmark in a document', () => {
    useAppStore.setState({
      bookmarks: [
        bookmark({ id: 'b1', order: 1 }),
        bookmark({ id: 'b2', order: 2, line: 9, identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 7) }),
        bookmark({ id: 'b3', order: 3, nodeId: 'method-2', modulePath: '/app/Other.dll' }),
      ],
    })

    useAppStore.getState().removeBookmark('b1')
    expect(useAppStore.getState().bookmarks.map((item) => item.id)).toEqual(['b2', 'b3'])

    useAppStore.getState().removeBookmarks(['b2', 'missing'])
    expect(useAppStore.getState().bookmarks.map((item) => item.id)).toEqual(['b3'])

    useAppStore.setState({ bookmarks: [...useAppStore.getState().bookmarks, bookmark({ id: 'b4', nodeId: 'method-2' })] })
    useAppStore.getState().removeAllBookmarksInDocument('method-2')
    expect(useAppStore.getState().bookmarks).toEqual([])
  })

  it('clears the selection when the bookmark it points at is removed', () => {
    useAppStore.setState({
      bookmarks: [bookmark({ id: 'b1' }), bookmark({ id: 'b2', order: 2 })],
      activeBookmarkId: 'b1',
    })

    useAppStore.getState().removeBookmark('b1')
    expect(useAppStore.getState().activeBookmarkId).toBeUndefined()

    useAppStore.setState({ activeBookmarkId: 'b2' })
    useAppStore.getState().clearBookmarks()
    expect(useAppStore.getState().bookmarks).toEqual([])
    expect(useAppStore.getState().activeBookmarkId).toBeUndefined()
  })

  it('trims a name and refuses a blank one', () => {
    useAppStore.setState({ bookmarks: [bookmark({ id: 'b1' })] })

    useAppStore.getState().renameBookmark('b1', '  Loop head  ')
    expect(useAppStore.getState().bookmarks[0].name).toBe('Loop head')

    useAppStore.getState().renameBookmark('b1', '   ')
    expect(useAppStore.getState().bookmarks[0].name).toBe('Loop head')
  })

  it('splits labels on their commas, trims them and drops duplicates', () => {
    useAppStore.setState({ bookmarks: [bookmark({ id: 'b1' })] })

    useAppStore.getState().setBookmarkLabels('b1', [' hot ', 'hot', '', '  ', 'loop'])
    expect(useAppStore.getState().bookmarks[0].labels).toEqual(['hot', 'loop'])
  })

  it('merges an import by IL identity and reports how many rows were new', () => {
    useAppStore.getState().toggleBookmark('method-1', 9)
    const existing = bookmarkEntries(useAppStore.getState().bookmarks)

    const added = useAppStore.getState().importBookmarks([
      ...existing,
      { modulePath: '/app/Other.dll', metadataToken: 0x06000003, ilOffset: 1, description: 'System.Void Ns.Type::Other()', name: 'Elsewhere', labels: ['x'], enabled: false },
    ])

    expect(added).toBe(1)
    const bookmarks = useAppStore.getState().bookmarks
    expect(bookmarks).toHaveLength(2)
    expect(bookmarks[1]).toMatchObject({ modulePath: '/app/Other.dll', nodeId: '', line: 0, name: 'Elsewhere', labels: ['x'], enabled: false })
  })

  it('walks the enabled bookmarks in order and skips the disabled ones', async () => {
    useAppStore.setState({
      bookmarks: [
        bookmark({ id: 'b1', order: 1, line: 4 }),
        bookmark({ id: 'b2', order: 2, line: 9, identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 7) }),
        bookmark({ id: 'b3', order: 3, line: 14, identity: statementIdentity('/app/DebugTarget.dll', 0x06000002, 11), enabled: false }),
      ],
    })

    await useAppStore.getState().selectNextBookmark({ documentId: 'method-1', line: 5 })
    expect(useAppStore.getState().activeBookmarkId).toBe('b2')
    expect(useAppStore.getState().bookmarksReveal).toMatchObject({ documentId: 'method-1', line: 9 })

    // With no caret to go on, next means "after the one the last go-to landed on" — and it wraps.
    await useAppStore.getState().selectNextBookmark()
    expect(useAppStore.getState().activeBookmarkId).toBe('b1')

    await useAppStore.getState().selectPreviousBookmark()
    expect(useAppStore.getState().activeBookmarkId).toBe('b2')
  })

  it('confines the in-document walk to the document the caret is in', async () => {
    useAppStore.setState({
      bookmarks: [
        bookmark({ id: 'b1', order: 1, line: 4 }),
        bookmark({ id: 'b2', order: 2, line: 30, nodeId: 'method-2', modulePath: '/app/Other.dll' }),
      ],
    })

    await useAppStore.getState().selectNextBookmarkInDocument('method-1', 0)
    expect(useAppStore.getState().activeBookmarkId).toBe('b1')
    expect(useAppStore.getState().bookmarksReveal).toMatchObject({ documentId: 'method-1', line: 4 })
  })

  it('steps between the bookmarks sharing the active one’s label', async () => {
    useAppStore.setState({
      bookmarks: [
        bookmark({ id: 'b1', order: 1, line: 4, labels: ['hot'] }),
        bookmark({ id: 'b2', order: 2, line: 9, identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 7) }),
        bookmark({ id: 'b3', order: 3, line: 14, identity: statementIdentity('/app/DebugTarget.dll', 0x06000002, 11), labels: ['hot'] }),
      ],
      activeBookmarkId: 'b1',
    })

    await useAppStore.getState().selectNextBookmarkWithSameLabel()
    expect(useAppStore.getState().activeBookmarkId).toBe('b3')
  })

  it('does nothing for a label walk while the active bookmark has no labels', async () => {
    useAppStore.setState({ bookmarks: [bookmark({ id: 'b1', labels: [] })], activeBookmarkId: 'b1' })

    await useAppStore.getState().selectNextBookmarkWithSameLabel()
    expect(useAppStore.getState().bookmarksReveal).toBeUndefined()
  })

  it('asks the backend for the node again when the cached one is gone', async () => {
    const findMember = vi.fn(async () => ({ nodeId: 'n42', label: 'M', description: 'System.Void Ns.Type::M()' }))
    Object.defineProperty(window, 'dnSpy', { configurable: true, value: { ...window.dnSpy, findMember } })
    useAppStore.setState({ bookmarks: [bookmark({ id: 'b1', nodeId: 'n1', line: 0 })], openNodeById: vi.fn(async () => undefined) })

    await useAppStore.getState().goToBookmark('b1')

    // The token, not the dead node id, is what survives a restart.
    expect(findMember).toHaveBeenCalledWith('ws1', '/app/DebugTarget.dll', 0x06000001)
    expect(useAppStore.getState().bookmarks[0].nodeId).toBe('n42')
  })

  it('does not follow a cached node id that no longer names the bookmark’s document', async () => {
    const findMember = vi.fn(async () => ({ nodeId: 'n42', label: 'M', description: 'System.Void Ns.Type::M()' }))
    Object.defineProperty(window, 'dnSpy', { configurable: true, value: { ...window.dnSpy, findMember } })
    useAppStore.setState({
      bookmarks: [bookmark({ id: 'b1', nodeId: 'n1', line: 0 })],
      // The id is still valid — the counter restarted, so it now names a different method entirely.
      openNodeById: vi.fn(async () => 'method-9'),
      documents: { 'method-9': doc([statement(2, 2, { ilOffset: 99, metadataToken: 0x06000009, sourceMethodToken: 0x06000009 })]) },
    })

    await useAppStore.getState().goToBookmark('b1')

    expect(findMember).toHaveBeenCalledOnce()
    expect(useAppStore.getState().bookmarks[0].nodeId).toBe('n42')
  })

  it('reports a bookmark whose module is not loaded instead of failing silently', async () => {
    const findMember = vi.fn(async () => ({ nodeId: null, label: null, description: null }))
    Object.defineProperty(window, 'dnSpy', { configurable: true, value: { ...window.dnSpy, findMember } })
    useAppStore.setState({ bookmarks: [bookmark({ id: 'b1', nodeId: 'n1', line: 0, name: 'Loop head' })], openNodeById: vi.fn(async () => undefined) })

    await useAppStore.getState().goToBookmark('b1')

    expect(useAppStore.getState().bookmarksReveal).toBeUndefined()
    expect(useAppStore.getState().output.at(-1)).toContain(translate('Bookmark "{name}" is in a module that is not loaded.', { name: 'Loop head' }))
  })

  it('finds a restored bookmark by identity once its document is open', () => {
    const restored = bookmark({ id: 'b1', nodeId: '', line: 0, identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 7) })

    expect(bookmarkLineInDocument('method-1', statements, restored)).toBe(9)
    // A document whose IL map does not contain the identity gets no marker, even though its own
    // statements are perfectly good.
    expect(bookmarkLineInDocument('method-2', [statement(3, 3, { ilOffset: 2 })], restored)).toBeUndefined()
    // Nor does a document that has not been decompiled yet, since a restored bookmark has no line.
    expect(bookmarkLineInDocument('method-1', undefined, restored)).toBeUndefined()
  })

  it('falls back to the cached line for a session-only bookmark', () => {
    const sessionOnly = bookmark({ id: 'b1', nodeId: 'method-1', line: 30, identity: 'method-1|30' })

    expect(bookmarkLineInDocument('method-1', statements, sessionOnly)).toBe(30)
    expect(bookmarkLineInDocument('method-2', statements, sessionOnly)).toBeUndefined()
    expect(bookmarkMarkers('method-1', statements, [sessionOnly])).toEqual([{ line: 30, enabled: true, message: 'First' }])
  })

  it('takes the token, name, location and module prefixes in the search box', () => {
    const rows = [
      bookmark({ id: 'b1', name: 'Loop head', labels: ['hot'], description: 'System.Void Ns.Type::M()', modulePath: '/app/DebugTarget.dll' }),
      bookmark({ id: 'b2', order: 2, name: 'Elsewhere', labels: ['cold'], description: 'System.Void Other.Type::N()', modulePath: '/app/Other.dll' }),
    ]

    const ids = (query: string): string[] => filterBookmarks(rows, query).map((item) => item.id)
    expect(ids('')).toEqual(['b1', 'b2'])
    expect(ids('n:loop')).toEqual(['b1'])
    expect(ids('l:cold')).toEqual(['b2'])
    expect(ids('o:other.type')).toEqual(['b2'])
    expect(ids('m:other.dll')).toEqual(['b2'])
    // No prefix searches every column, and whitespace is an implicit AND.
    expect(ids('hot')).toEqual(['b1'])
    expect(ids('debugtarget head')).toEqual(['b1'])
    expect(ids('debugtarget cold')).toEqual([])
    // A prefix with nothing after it matches everything, the way an empty box does.
    expect(ids('n:')).toEqual(['b1', 'b2'])
  })
})

// The store is created while the module is being evaluated, which is the moment the reading of stored
// bookmarks has to happen at — and the moment it is easiest to get wrong.
describe('bookmarks at startup', () => {
  it('reads the stored bookmarks back when the store is built', async () => {
    localStorage.setItem('dnspy.bookmarks.v1', JSON.stringify([
      { modulePath: '/app/DebugTarget.dll', metadataToken: 0x06000001, ilOffset: 7, description: 'System.Void Ns.Type::M()', name: 'Loop head', labels: ['hot'], enabled: false },
      { modulePath: '', metadataToken: 0, ilOffset: 0, name: 'not worth keeping' },
    ]))
    vi.resetModules()

    const reloaded = await import('./app-store')

    const bookmarks = reloaded.useAppStore.getState().bookmarks
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0]).toMatchObject({
      nodeId: '',
      identity: statementIdentity('/app/DebugTarget.dll', 0x06000001, 7),
      modulePath: '/app/DebugTarget.dll',
      metadataToken: 0x06000001,
      ilOffset: 7,
      line: 0,
      name: 'Loop head',
      labels: ['hot'],
      enabled: false,
    })
  })

  it('survives a storage entry it cannot parse', async () => {
    localStorage.setItem('dnspy.bookmarks.v1', '{ not json')
    vi.resetModules()

    const reloaded = await import('./app-store')

    expect(reloaded.useAppStore.getState().bookmarks).toEqual([])
  })
})
