import { useEffect, useRef, useState } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'
import type { IlInstruction, MethodBodyResponse, TreeNode } from '../../../shared/protocol'
import { useAppStore } from '../app-store'

interface RenameDialogProps {
  node: TreeNode
  onClose(): void
}

export const RenameDialog = ({ node, onClose }: RenameDialogProps): React.JSX.Element => {
  const [name, setName] = useState(node.label.includes('.') ? node.label.split('.').at(-1) ?? node.label : node.label.replace(/\(.*$/, ''))
  const renameNode = useAppStore((state) => state.renameNode)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="modal rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title" onSubmit={(event) => {
        event.preventDefault()
        void renameNode(node, name).then((renamed) => { if (renamed) onClose() })
      }}>
        <div className="modal-title"><span id="rename-title">Rename</span><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={14} /></button></div>
        <div className="modal-content">
          <label>Name<input ref={input} value={name} onChange={(event) => setName(event.target.value)} /></label>
        </div>
        <div className="modal-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!name.trim()}>Rename</button></div>
      </form>
    </div>
  )
}

interface MethodBodyEditorProps {
  node: TreeNode
  onClose(): void
}

export const MethodBodyEditor = ({ node, onClose }: MethodBodyEditorProps): React.JSX.Element => {
  const workspaceId = useAppStore((state) => state.workspaceId)
  const methodBodyChanged = useAppStore((state) => state.methodBodyChanged)
  const appendOutput = useAppStore((state) => state.appendOutput)
  const [body, setBody] = useState<MethodBodyResponse>()
  const [clearHandlers, setClearHandlers] = useState(false)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    void window.dnSpy.getMethodBody(workspaceId, node.id).then(setBody).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [workspaceId, node.id])

  const updateInstruction = (index: number, patch: Partial<IlInstruction>): void => {
    setBody((current) => current ? {
      ...current,
      instructions: current.instructions.map((instruction, instructionIndex) => instructionIndex === index ? { ...instruction, ...patch } : instruction),
    } : current)
  }

  const save = async (): Promise<void> => {
    if (!workspaceId || !body) return
    setSaving(true)
    setError(undefined)
    let transactionId: string | undefined
    try {
      transactionId = (await window.dnSpy.beginEdit(workspaceId)).transactionId
      await window.dnSpy.queueMethodBody(workspaceId, transactionId, node.id, body, clearHandlers)
      const committed = await window.dnSpy.commitEdit(workspaceId, transactionId)
      await methodBodyChanged(node, committed)
      onClose()
    } catch (reason) {
      if (transactionId) {
        try { await window.dnSpy.rollbackEdit(workspaceId, transactionId) } catch { /* already committed or invalidated */ }
      }
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      appendOutput(`IL edit failed: ${message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal il-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="il-editor-title">
        <div className="modal-title"><span id="il-editor-title">Edit IL · {node.label}</span><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={14} /></button></div>
        <div className="il-editor-options">
          <label>Max stack <input type="number" min="0" max="65535" value={body?.maxStack ?? 0} onChange={(event) => setBody((current) => current ? { ...current, maxStack: Number(event.target.value) } : current)} /></label>
          <label><input type="checkbox" checked={body?.initLocals ?? false} onChange={(event) => setBody((current) => current ? { ...current, initLocals: event.target.checked } : current)} /> Initialize locals</label>
          {body?.hasExceptionHandlers && <label className="warning-option"><input type="checkbox" checked={clearHandlers} onChange={(event) => setClearHandlers(event.target.checked)} /> Clear exception handlers</label>}
        </div>
        <div className="il-grid" role="grid">
          <div className="il-grid-header">Label</div><div className="il-grid-header">Opcode</div><div className="il-grid-header">Kind</div><div className="il-grid-header">Operand</div><div />
          {body?.instructions.map((instruction, index) => (
            <div className="il-grid-row" role="row" key={`${index}:${instruction.label}`}>
              <input aria-label={`Label ${index}`} value={instruction.label} onChange={(event) => updateInstruction(index, { label: event.target.value })} />
              <input aria-label={`Opcode ${index}`} value={instruction.opCode} onChange={(event) => updateInstruction(index, { opCode: event.target.value })} />
              <select aria-label={`Operand kind ${index}`} value={instruction.operandKind ?? ''} onChange={(event) => updateInstruction(index, { operandKind: event.target.value || undefined })}>
                <option value="">None</option><option value="number">Number</option><option value="string">String</option><option value="branch">Branch</option><option value="switch">Switch</option><option value="local">Local</option><option value="argument">Argument</option><option value="token">Token</option>
              </select>
              <input aria-label={`Operand ${index}`} value={instruction.operand ?? ''} title={instruction.operandDisplay} onChange={(event) => updateInstruction(index, { operand: event.target.value })} />
              <button type="button" className="icon-button" title="Delete instruction" aria-label={`Delete instruction ${index}`} onClick={() => setBody((current) => current ? { ...current, instructions: current.instructions.filter((_, instructionIndex) => instructionIndex !== index) } : current)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={() => setBody((current) => current ? { ...current, instructions: [...current.instructions, { label: `L${current.instructions.length}`, opCode: 'nop' }] } : current)}><Plus size={14} /> Add</button>
          <span className="modal-action-spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!body || saving || (body.hasExceptionHandlers && !clearHandlers)} onClick={() => void save()}><Save size={14} /> Apply</button>
        </div>
      </div>
    </div>
  )
}
