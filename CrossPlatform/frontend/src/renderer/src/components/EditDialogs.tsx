import { useEffect, useRef, useState } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'
import type { IlInstruction, MethodBodyResponse, TreeNode } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { useLanguage } from '../localization'

interface RenameDialogProps {
  node: TreeNode
  onClose(): void
}

export const RenameDialog = ({ node, onClose }: RenameDialogProps): React.JSX.Element => {
  const [name, setName] = useState(node.label.includes('.') ? node.label.split('.').at(-1) ?? node.label : node.label.replace(/\(.*$/, ''))
  const renameNode = useAppStore((state) => state.renameNode)
  const input = useRef<HTMLInputElement>(null)
  const { t } = useLanguage()
  useEffect(() => input.current?.select(), [])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="modal rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title" onSubmit={(event) => {
        event.preventDefault()
        void renameNode(node, name).then((renamed) => { if (renamed) onClose() })
      }}>
        <div className="modal-title"><span id="rename-title">{t('Rename')}</span><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={14} /></button></div>
        <div className="modal-content">
          <label>{t('Name')}<input ref={input} value={name} onChange={(event) => setName(event.target.value)} /></label>
        </div>
        <div className="modal-actions"><button type="button" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="primary" disabled={!name.trim()}>{t('Rename')}</button></div>
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
  const { t } = useLanguage()

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
      appendOutput(t('IL edit failed: {message}', { message }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal il-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="il-editor-title">
        <div className="modal-title"><span id="il-editor-title">{t('Edit IL · {name}', { name: node.label })}</span><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={14} /></button></div>
        <div className="il-editor-options">
          <label>{t('Max stack')} <input type="number" min="0" max="65535" value={body?.maxStack ?? 0} onChange={(event) => setBody((current) => current ? { ...current, maxStack: Number(event.target.value) } : current)} /></label>
          <label><input type="checkbox" checked={body?.initLocals ?? false} onChange={(event) => setBody((current) => current ? { ...current, initLocals: event.target.checked } : current)} /> {t('Initialize locals')}</label>
          {body?.hasExceptionHandlers && <label className="warning-option"><input type="checkbox" checked={clearHandlers} onChange={(event) => setClearHandlers(event.target.checked)} /> {t('Clear exception handlers')}</label>}
        </div>
        <div className="il-grid" role="grid">
          <div className="il-grid-header">{t('Label')}</div><div className="il-grid-header">{t('Opcode')}</div><div className="il-grid-header">{t('Kind')}</div><div className="il-grid-header">{t('Operand')}</div><div />
          {body?.instructions.map((instruction, index) => (
            <div className="il-grid-row" role="row" key={`${index}:${instruction.label}`}>
              <input aria-label={t('Label {index}', { index })} value={instruction.label} onChange={(event) => updateInstruction(index, { label: event.target.value })} />
              <input aria-label={t('Opcode {index}', { index })} value={instruction.opCode} onChange={(event) => updateInstruction(index, { opCode: event.target.value })} />
              <select aria-label={t('Operand kind {index}', { index })} value={instruction.operandKind ?? ''} onChange={(event) => updateInstruction(index, { operandKind: event.target.value || undefined })}>
                <option value="">{t('None')}</option><option value="number">{t('Number')}</option><option value="string">{t('String')}</option><option value="branch">{t('Branch')}</option><option value="switch">{t('Switch')}</option><option value="local">{t('Local')}</option><option value="argument">{t('Argument')}</option><option value="token">{t('Token')}</option>
              </select>
              <input aria-label={t('Operand {index}', { index })} value={instruction.operand ?? ''} title={instruction.operandDisplay} onChange={(event) => updateInstruction(index, { operand: event.target.value })} />
              <button type="button" className="icon-button" title={t('Delete instruction')} aria-label={t('Delete instruction {index}', { index })} onClick={() => setBody((current) => current ? { ...current, instructions: current.instructions.filter((_, instructionIndex) => instructionIndex !== index) } : current)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={() => setBody((current) => current ? { ...current, instructions: [...current.instructions, { label: `L${current.instructions.length}`, opCode: 'nop' }] } : current)}><Plus size={14} /> {t('Add')}</button>
          <span className="modal-action-spacer" />
          <button type="button" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" className="primary" disabled={!body || saving || (body.hasExceptionHandlers && !clearHandlers)} onClick={() => void save()}><Save size={14} /> {t('Apply')}</button>
        </div>
      </div>
    </div>
  )
}
