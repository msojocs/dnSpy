import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import type { ModuleInfoResponse } from '../../../shared/protocol'
import { useAppStore } from '../app-store'

const pageSize = 4096

export const HexView = ({ moduleId }: { moduleId: string }): React.JSX.Element => {
  const workspaceId = useAppStore((state) => state.workspaceId)
  const [length, setLength] = useState(0)
  const [offset, setOffset] = useState(0)
  const [bytes, setBytes] = useState<Uint8Array>(new Uint8Array())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    void window.dnSpy.getHexLength(workspaceId, moduleId).then((response) => setLength(response.length))
  }, [workspaceId, moduleId])

  useEffect(() => {
    if (!workspaceId) return
    let canceled = false
    setLoading(true)
    void window.dnSpy.readHex(workspaceId, moduleId, offset, pageSize).then((response) => {
      if (canceled) return
      const binary = atob(response.base64Data)
      setBytes(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
    }).finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [workspaceId, moduleId, offset])

  const lines = useMemo(() => {
    const result: string[] = []
    for (let row = 0; row < bytes.length; row += 16) {
      const slice = bytes.slice(row, row + 16)
      const address = (offset + row).toString(16).toUpperCase().padStart(8, '0')
      const hex = Array.from(slice, (value) => value.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(47, ' ')
      const ascii = Array.from(slice, (value) => value >= 32 && value <= 126 ? String.fromCharCode(value) : '.').join('')
      result.push(`${address}  ${hex}  |${ascii.padEnd(16, ' ')}|`)
    }
    return result.join('\n')
  }, [bytes, offset])

  return (
    <div className="special-document">
      <div className="document-toolbar hex-toolbar">
        <button className="icon-button" title="Previous page" aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ChevronLeft size={15} /></button>
        <button className="icon-button" title="Next page" aria-label="Next page" disabled={offset + pageSize >= length} onClick={() => setOffset(offset + pageSize)}><ChevronRight size={15} /></button>
        <label>Offset <input value={`0x${offset.toString(16).toUpperCase()}`} onChange={(event) => {
          const parsed = Number.parseInt(event.target.value.replace(/^0x/i, ''), 16)
          if (Number.isFinite(parsed) && parsed >= 0 && parsed < length)
            setOffset(Math.floor(parsed / pageSize) * pageSize)
        }} /></label>
        <span>{offset.toLocaleString()} / {length.toLocaleString()}</span>
        {loading && <RefreshCw className="spin" size={14} />}
      </div>
      <pre className="hex-content">{lines}</pre>
    </div>
  )
}

export const ModuleInfoView = ({ moduleId }: { moduleId: string }): React.JSX.Element => {
  const workspaceId = useAppStore((state) => state.workspaceId)
  const [info, setInfo] = useState<ModuleInfoResponse>()

  useEffect(() => {
    if (workspaceId)
      void window.dnSpy.getModuleInfo(workspaceId, moduleId).then(setInfo)
  }, [workspaceId, moduleId])

  if (!info)
    return <div className="loading-state">Loading</div>

  return (
    <div className="module-info-view">
      <dl>
        <dt>Name</dt><dd>{info.name}</dd>
        <dt>Path</dt><dd>{info.path}</dd>
        <dt>Runtime</dt><dd>{info.runtimeVersion}</dd>
        <dt>Architecture</dt><dd>{info.architecture}</dd>
        <dt>Kind</dt><dd>{info.moduleKind}</dd>
        <dt>MVID</dt><dd>{info.mvid}</dd>
        <dt>Entry point</dt><dd>{info.entryPoint ?? 'None'}</dd>
        <dt>Types</dt><dd>{info.typeCount.toLocaleString()}</dd>
        <dt>Resources</dt><dd>{info.resourceCount.toLocaleString()}</dd>
      </dl>
      <h3>Assembly References</h3>
      <ul>{info.assemblyReferences.map((reference) => <li key={reference}>{reference}</li>)}</ul>
      <h3>PE Headers</h3>
      <dl>{Object.entries(info.peHeaders).map(([name, value]) => <div className="definition-row" key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      <h3>Metadata Tables</h3>
      <div className="metadata-table-list" role="table" aria-label="Metadata Tables">
        <div className="metadata-table-header">Table</div><div className="metadata-table-header">Rows</div>
        {Object.entries(info.metadataTables).map(([name, rows]) => <div className="metadata-table-row" role="row" key={name}><span>{name}</span><span>{rows.toLocaleString()}</span></div>)}
      </div>
    </div>
  )
}
