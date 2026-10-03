import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, LoaderCircle, X } from 'lucide-react'
import type { TreeNode } from '../../../shared/protocol'
import { useLanguage } from '../localization'
import { NodeIcon } from './AssemblyExplorer'
import { isTopModal, trapTabKey, useModalLayer } from './modal-stack'

/**
 * What the picker is allowed to return, which is dnSpy's `VisibleMembersFlags`: the tree it shows is
 * the assembly explorer's own, with everything the caller did not ask for hidden — a picker opened for
 * a type shows types and the containers that hold them, and nothing else.
 */
export type PickerMode = 'type' | 'member' | 'field' | 'method'

const SELECTABLE: Record<PickerMode, string[]> = {
  type: ['type'],
  member: ['type', 'method', 'field', 'property', 'event'],
  field: ['field'],
  method: ['method'],
}

/**
 * The nodes that lead to a selectable one, which is dnSpy's `FilterType.CheckChildren`: a type is
 * only reachable through the module and namespace it lives in, and a member only through its type —
 * so all three stay visible in every mode, as containers rather than as answers.
 */
const CONTAINERS = ['module', 'namespace', 'referencesgroup', 'assemblyreference', 'type']

/** dnSpy's own titles for the pickers, `Pick_Type` and friends. */
const PICKER_TITLES: Record<PickerMode, string> = {
  type: 'Pick a Type',
  member: 'Pick Member',
  field: 'Pick a Field',
  method: 'Pick a Method',
}

interface PickerRowProps {
  node: TreeNode
  /** The chain that leads here, outermost first; its length is the row's depth. */
  parents: TreeNode[]
  mode: PickerMode
  children: Record<string, TreeNode[]>
  expanded: Record<string, boolean>
  loading: Record<string, boolean>
  selectedId?: string
  onSelect(node: TreeNode, trail: TreeNode[]): void
  onToggle(node: TreeNode, parents: TreeNode[]): void
  onPick(node: TreeNode, trail: TreeNode[]): void
}

const PickerRow = ({ node, parents, mode, children, expanded, loading, selectedId, onSelect, onToggle, onPick }: PickerRowProps): React.JSX.Element | null => {
  const { t } = useLanguage()
  const selectable = SELECTABLE[mode].includes(node.kind)
  if (!selectable && !CONTAINERS.includes(node.kind))
    return null
  const open = expanded[node.id] ?? false
  const trail = [...parents, node]
  const label = node.kind === 'referencesgroup' ? t('Assembly References') : node.label
  return (
    <>
      <div
        className={`tree-row${selectedId === node.id ? ' selected' : ''}`}
        data-kind={node.kind}
        style={{ paddingLeft: `${6 + parents.length * 16}px` }}
        role="treeitem"
        aria-expanded={node.hasChildren ? open : undefined}
        aria-selected={selectedId === node.id}
        aria-disabled={!selectable}
        title={node.description ?? label}
        onClick={() => onSelect(node, trail)}
        onDoubleClick={() => {
          if (selectable)
            onPick(node, trail)
          else if (node.hasChildren)
            onToggle(node, parents)
        }}
      >
        <button
          type="button"
          className="tree-expander"
          aria-label={open ? t('Collapse') : t('Expand')}
          disabled={!node.hasChildren}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(node, parents)
          }}
        >
          {loading[node.id] ? <LoaderCircle className="spin" size={13} /> : node.hasChildren ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </button>
        <span className={`tree-icon kind-${node.kind}`}><NodeIcon icon={node.icon} /></span>
        <span className="tree-label">{label}</span>
      </div>
      {open && children[node.id]?.map((child) => (
        <PickerRow
          key={child.id}
          node={child}
          parents={trail}
          mode={mode}
          children={children}
          expanded={expanded}
          loading={loading}
          selectedId={selectedId}
          onSelect={onSelect}
          onToggle={onToggle}
          onPick={onPick}
        />
      ))}
    </>
  )
}

interface TypePickerDialogProps {
  workspaceId: string
  mode: PickerMode
  /** Overrides the mode's default title, the way an option dialog names the thing it is picking. */
  title?: string
  /** Called with the picked node and its ancestor chain, outermost first and including the node
   * itself — the chain is what tells a caller which assembly and namespace the node came from. */
  onPick(node: TreeNode, trail: TreeNode[]): void
  onClose(): void
}

/**
 * The tree a dialog picks a type or a member from. It is the same tree the assembly explorer shows,
 * read from the same backend calls, but it keeps its expansion state to itself: a picker is opened and
 * dismissed many times over one dialog's lifetime, and folding the explorer underneath the user each
 * time would be wrong.
 *
 * A container is kept even when nothing under it can be picked, where dnSpy folds it away: deciding
 * that means knowing the whole subtree, and this tree is read a level at a time. An empty namespace is
 * a smaller price than a picker that has to load every assembly before it can show anything.
 */
export const TypePickerDialog = ({ workspaceId, mode, title, onPick, onClose }: TypePickerDialogProps): React.JSX.Element => {
  const dialog = useRef<HTMLDivElement>(null)
  const depth = useModalLayer()
  const { t } = useLanguage()
  const [roots, setRoots] = useState<TreeNode[]>([])
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [trail, setTrail] = useState<TreeNode[]>([])
  const [error, setError] = useState<string>()

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isTopModal(depth)) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [depth, onClose])

  // A picker can be dismissed while a load is in flight — the user closes it or picks something —
  // and the response must not land in a dialog that is on its way out.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const loadChildren = async (node: TreeNode): Promise<void> => {
    setLoading((current) => ({ ...current, [node.id]: true }))
    try {
      const response = await window.dnSpy.getChildren(workspaceId, node.id)
      if (alive.current)
        setChildren((current) => ({ ...current, [node.id]: response.nodes }))
    }
    catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    }
    finally {
      if (alive.current)
        setLoading((current) => ({ ...current, [node.id]: false }))
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await window.dnSpy.getRoots(workspaceId)
        if (!alive.current)
          return
        setRoots(response.nodes)
        // A module's own children are its namespaces, so opening it is what makes the tree usable;
        // nothing below that is opened for the user, since which namespace holds the type is their call.
        setExpanded(Object.fromEntries(response.nodes.map((node) => [node.id, true])))
        await Promise.all(response.nodes.filter((node) => node.hasChildren).map(loadChildren))
      }
      catch (cause) {
        if (alive.current)
          setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  }, [workspaceId])

  const toggle = (node: TreeNode, parents: TreeNode[]): void => {
    setTrail([...parents, node])
    const open = !(expanded[node.id] ?? false)
    setExpanded((current) => ({ ...current, [node.id]: open }))
    if (open && !children[node.id])
      void loadChildren(node)
  }

  const selected = trail.at(-1)
  const canPick = selected !== undefined && SELECTABLE[mode].includes(selected.kind)

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      style={{ zIndex: 100 + depth * 10 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={dialog}
        className="modal picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(title ?? PICKER_TITLES[mode])}
        onKeyDown={(event) => trapTabKey(event, dialog.current)}
      >
        <div className="modal-title">
          <span>{t(title ?? PICKER_TITLES[mode])}</span>
          <button type="button" className="icon-button" aria-label={t('Close')} title={t('Close')} onClick={onClose}><X size={14} /></button>
        </div>
        <div className="picker-body">
          {error && <div className="picker-error">{error}</div>}
          <div className="assembly-tree" role="tree" aria-label={t('Assembly Explorer')}>
            {roots.map((root) => (
              <PickerRow
                key={root.id}
                node={root}
                parents={[]}
                mode={mode}
                children={children}
                expanded={expanded}
                loading={loading}
                selectedId={selected?.id}
                onSelect={(node, nodeTrail) => setTrail(nodeTrail)}
                onToggle={toggle}
                onPick={onPick}
              />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <span className="modal-action-spacer" />
          <button type="button" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" className="primary" disabled={!canPick} onClick={() => { if (selected) onPick(selected, trail) }}>{t('OK')}</button>
        </div>
      </div>
    </div>
  )
}
