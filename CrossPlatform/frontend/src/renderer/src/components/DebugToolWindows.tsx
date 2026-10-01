import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import type { DebugVariable } from '../../../shared/protocol'
import { useAppStore } from '../app-store'

export const LocalsPane = (): React.JSX.Element => {
  const variables = useAppStore((state) => state.debugVariables)
  return (
    <div className="debug-table" role="table" aria-label="Locals">
      <div className="debug-table-header">Name</div><div className="debug-table-header">Value</div><div className="debug-table-header">Type</div>
      {variables.map((variable, index) => <VariableRow variable={variable} depth={0} key={`${variable.name}:${index}`} />)}
    </div>
  )
}

const VariableRow = ({ variable, depth }: { variable: DebugVariable; depth: number }): React.JSX.Element => {
  const sessionId = useAppStore((state) => state.debugSessionId)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [children, setChildren] = useState<DebugVariable[]>()
  const toggle = async (): Promise<void> => {
    if (!sessionId || variable.variablesReference === 0) return
    if (!expanded && !children) {
      setLoading(true)
      try { setChildren(await window.dnSpy.getDebugVariables(sessionId, variable.variablesReference)) }
      finally { setLoading(false) }
    }
    setExpanded((value) => !value)
  }
  return (
    <>
      <div className="debug-table-row" role="row">
        <span className="debug-variable-name" style={{ paddingLeft: `${7 + depth * 15}px` }}>
          <button className="tree-expander" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${variable.name}`} disabled={variable.variablesReference === 0} onClick={() => void toggle()}>
            {loading ? <LoaderCircle className="spin" size={12} /> : expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {variable.name}
        </span>
        <span title={variable.value}>{variable.value}</span><span>{variable.type}</span>
      </div>
      {expanded && children?.map((child, index) => <VariableRow variable={child} depth={depth + 1} key={`${child.name}:${index}`} />)}
    </>
  )
}

export const WatchPane = (): React.JSX.Element => {
  const [expression, setExpression] = useState('')
  const debugState = useAppStore((state) => state.debugState)
  const values = useAppStore((state) => state.watchValues)
  const addWatch = useAppStore((state) => state.addWatch)
  const removeWatch = useAppStore((state) => state.removeWatch)
  const submit = (): void => {
    if (expression.trim()) {
      void addWatch(expression)
      setExpression('')
    }
  }
  return (
    <div className="debug-tool-pane">
      <div className="debug-input-row">
        <input aria-label="Watch expression" placeholder="Expression" value={expression} disabled={debugState !== 'stopped'} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />
        <button className="icon-button" aria-label="Add watch" title="Add watch" disabled={debugState !== 'stopped' || !expression.trim()} onClick={submit}><Plus size={14} /></button>
      </div>
      <div className="debug-table debug-table-watch" role="table" aria-label="Watch">
        <div className="debug-table-header">Expression</div><div className="debug-table-header">Value</div><div className="debug-table-header">Type</div><div />
        {values.map((variable) => (
          <div className="debug-table-row" role="row" key={variable.name}>
            <span>{variable.name}</span><span title={variable.value}>{variable.value}</span><span>{variable.type}</span>
            <button className="icon-button" aria-label={`Remove ${variable.name}`} onClick={() => removeWatch(variable.name)}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

export const CallStackPane = (): React.JSX.Element => {
  const frames = useAppStore((state) => state.debugFrames)
  const selectedFrameId = useAppStore((state) => state.selectedDebugFrameId)
  const selectFrame = useAppStore((state) => state.selectDebugFrame)
  return (
    <div className="result-list" role="list" aria-label="Call Stack">
      {frames.map((frame) => (
        <button key={frame.id} className={`result-row stack-row${selectedFrameId === frame.id ? ' selected' : ''}`} onClick={() => void selectFrame(frame.id)}>
          <span className="result-name">{frame.name}</span>
          <span className="result-location">{frame.source?.name ?? frame.source?.path ?? ''}{frame.line > 0 ? `:${frame.line}` : ''}</span>
        </button>
      ))}
    </div>
  )
}

export const ThreadsPane = (): React.JSX.Element => {
  const threads = useAppStore((state) => state.debugThreads)
  const selectedThreadId = useAppStore((state) => state.selectedDebugThreadId)
  const selectThread = useAppStore((state) => state.selectDebugThread)
  return (
    <div className="result-list" role="list" aria-label="Threads">
      {threads.map((thread) => (
        <button key={thread.id} className={`result-row thread-row${selectedThreadId === thread.id ? ' selected' : ''}`} onClick={() => void selectThread(thread.id)}>
          <span className="result-name">{thread.name}</span><span className="result-location">{thread.id}</span>
        </button>
      ))}
    </div>
  )
}

export const BreakpointsPane = (): React.JSX.Element => {
  const [name, setName] = useState('')
  const breakpoints = useAppStore((state) => state.functionBreakpoints)
  const addBreakpoint = useAppStore((state) => state.addFunctionBreakpoint)
  const removeBreakpoint = useAppStore((state) => state.removeFunctionBreakpoint)
  const exceptionBreakpoints = useAppStore((state) => state.exceptionBreakpoints)
  const setExceptionBreakpoint = useAppStore((state) => state.setExceptionBreakpoint)
  const submit = (): void => {
    if (name.trim()) {
      void addBreakpoint(name)
      setName('')
    }
  }
  return (
    <div className="debug-tool-pane">
      <div className="debug-input-row">
        <input aria-label="Function breakpoint" placeholder="Namespace.Type.Method" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />
        <button className="icon-button" aria-label="Add function breakpoint" title="Add function breakpoint" disabled={!name.trim()} onClick={submit}><Plus size={14} /></button>
      </div>
      <div className="result-list">
        <label className="exception-breakpoint-row"><input type="checkbox" checked={exceptionBreakpoints.includes('all')} onChange={(event) => void setExceptionBreakpoint('all', event.target.checked)} /> All thrown exceptions</label>
        <label className="exception-breakpoint-row"><input type="checkbox" checked={exceptionBreakpoints.includes('user-unhandled')} onChange={(event) => void setExceptionBreakpoint('user-unhandled', event.target.checked)} /> User-unhandled exceptions</label>
        {breakpoints.map((breakpoint) => (
          <div className="breakpoint-row" key={breakpoint}><span>{breakpoint}</span><button className="icon-button" aria-label={`Remove ${breakpoint}`} onClick={() => void removeBreakpoint(breakpoint)}><Trash2 size={13} /></button></div>
        ))}
      </div>
    </div>
  )
}

export const ModulesPane = (): React.JSX.Element => {
  const modules = useAppStore((state) => state.debugModules)
  return (
    <div className="debug-table modules-table" role="table" aria-label="Modules">
      <div className="debug-table-header">Name</div><div className="debug-table-header">Path</div><div className="debug-table-header">Symbols</div>
      {modules.map((module) => (
        <div className="debug-table-row" role="row" key={String(module.id)}>
          <span>{module.name}</span><span title={module.path}>{module.path}</span><span>{module.symbolStatus}</span>
        </div>
      ))}
    </div>
  )
}

export const DebugStatusPane = (): React.JSX.Element => {
  const state = useAppStore((appState) => appState.debugState)
  const reason = useAppStore((appState) => appState.stoppedReason)
  const label = useMemo(() => state === 'stopped' && reason ? `Stopped: ${reason}` : state, [state, reason])
  return <div className="pane-empty">{label}</div>
}
