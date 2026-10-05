import { memo } from 'react'
import { showPopupMenu, type IPopupMenuItem, type PopupMenuEntry } from 'flexlayout-react'
import {
  Binary,
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Code2,
  FileBox,
  Folder,
  Library,
  LoaderCircle,
  Network,
  Package,
  Variable,
} from 'lucide-react'
import type { TreeNode } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { useLanguage } from '../localization'

interface AssemblyExplorerProps {
  onOpenNode(node: TreeNode): void
  onAnalyzeNode(node: TreeNode): void
  onShowHex(node: TreeNode): void
  onShowModuleInfo(node: TreeNode): void
}

/** The tree's icon for a node, shared with the dialogs that show the same tree — the type picker. */
export const NodeIcon = ({ icon }: { icon?: string }): React.JSX.Element => {
  const props = { size: 15, strokeWidth: 1.6, 'aria-hidden': true as const }
  switch (icon) {
    case 'assembly': return <Package {...props} />
    // A file that is not a managed assembly: dnSpy shows a PE document with the assembly icon, an ELF image
    // and the structures read out of either with the binary one, and a file it could not read with the error.
    case 'binary': return <Binary {...props} />
    case 'error': return <CircleAlert {...props} />
    case 'namespace': return <Folder {...props} />
    case 'reference': return <Library {...props} />
    case 'resource': return <FileBox {...props} />
    case 'method': return <Code2 {...props} />
    case 'field': return <Variable {...props} />
    case 'property': return <Braces {...props} />
    case 'event': return <CircleDot {...props} />
    case 'interface': return <Network {...props} />
    default: return <Box {...props} />
  }
}

const contextMenuItem = (key: string, label: string, onSelect: () => void): IPopupMenuItem => ({ key, label, onSelect })

const TreeRow = memo(({ node, depth, onOpenNode, onAnalyzeNode, onShowHex, onShowModuleInfo }: AssemblyExplorerProps & { node: TreeNode; depth: number }): React.JSX.Element => {
  const children = useAppStore((state) => state.children[node.id])
  const expanded = useAppStore((state) => state.expanded[node.id] ?? false)
  const loading = useAppStore((state) => state.loadingNodes[node.id] ?? false)
  const selected = useAppStore((state) => state.selectedNode?.id === node.id)
  const toggleNode = useAppStore((state) => state.toggleNode)
  const selectNode = useAppStore((state) => state.selectNode)
  const { t } = useLanguage()
  const label = node.kind === 'referencesgroup' ? t('Assembly References') : node.kind === 'resourcesgroup' ? t('Resources') : node.label

  const open = (): void => {
    selectNode(node)
    if (node.kind !== 'referencesgroup' && node.kind !== 'resourcesgroup')
      onOpenNode(node)
  }

  return (
    <>
      <div
        className={`tree-row${selected ? ' selected' : ''}`}
        data-kind={node.kind}
        style={{ paddingLeft: `${6 + depth * 16}px` }}
        role="treeitem"
        aria-expanded={node.hasChildren ? expanded : undefined}
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        title={node.description ?? label}
        onClick={() => selectNode(node)}
        onDoubleClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter') open()
          if (event.key === 'ArrowRight' && node.hasChildren && !expanded) void toggleNode(node)
          if (event.key === 'ArrowLeft' && expanded) void toggleNode(node)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          selectNode(node)
          const items: PopupMenuEntry[] = []
          if (['type', 'method', 'field', 'property', 'event'].includes(node.kind))
            items.push(contextMenuItem('analyze', t('Analyzer'), () => onAnalyzeNode(node)))
          if (node.kind === 'module') {
            items.push(contextMenuItem('hex', t('Hex View'), () => onShowHex(node)))
            items.push(contextMenuItem('module-info', t('Module Information'), () => onShowModuleInfo(node)))
          }
          if (items.length === 0)
            return
          showPopupMenu({
            anchor: { x: event.clientX, y: event.clientY },
            returnFocusTo: event.currentTarget,
            title: t('Assembly Explorer'),
            items,
            onClose: () => undefined,
          })
        }}
      >
        <button
          className="tree-expander"
          aria-label={expanded ? t('Collapse') : t('Expand')}
          disabled={!node.hasChildren}
          onClick={(event) => {
            event.stopPropagation()
            void toggleNode(node)
          }}
        >
          {loading ? <LoaderCircle className="spin" size={13} /> : node.hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </button>
        <span className={`tree-icon kind-${node.kind}`}><NodeIcon icon={node.icon} /></span>
        <span className="tree-label">{label}</span>
      </div>
      {expanded && children?.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} onOpenNode={onOpenNode} onAnalyzeNode={onAnalyzeNode} onShowHex={onShowHex} onShowModuleInfo={onShowModuleInfo} />
      ))}
    </>
  )
})

export const AssemblyExplorer = ({ onOpenNode, onAnalyzeNode, onShowHex, onShowModuleInfo }: AssemblyExplorerProps): React.JSX.Element => {
  const roots = useAppStore((state) => state.roots)
  const { t } = useLanguage()

  if (roots.length === 0)
    return <div className="pane-empty">{t('No assemblies loaded')}</div>

  return (
    <div className="assembly-tree" role="tree" aria-label={t('Assembly Explorer')}>
      {roots.map((root) => (
        <TreeRow key={root.id} node={root} depth={0} onOpenNode={onOpenNode} onAnalyzeNode={onAnalyzeNode} onShowHex={onShowHex} onShowModuleInfo={onShowModuleInfo} />
      ))}
    </div>
  )
}
