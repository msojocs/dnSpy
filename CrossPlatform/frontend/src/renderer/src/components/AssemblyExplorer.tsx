import { useEffect } from 'react'
import {
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
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

interface AssemblyExplorerProps {
  onOpenNode(node: TreeNode): void
  onAnalyzeNode(node: TreeNode): void
}

const NodeIcon = ({ icon }: { icon?: string }): React.JSX.Element => {
  const props = { size: 15, strokeWidth: 1.6, 'aria-hidden': true as const }
  switch (icon) {
    case 'assembly': return <Package {...props} />
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

const TreeRow = ({ node, depth, onOpenNode, onAnalyzeNode }: AssemblyExplorerProps & { node: TreeNode; depth: number }): React.JSX.Element => {
  const children = useAppStore((state) => state.children[node.id])
  const expanded = useAppStore((state) => state.expanded[node.id] ?? false)
  const loading = useAppStore((state) => state.loadingNodes[node.id] ?? false)
  const selected = useAppStore((state) => state.selectedNode?.id === node.id)
  const toggleNode = useAppStore((state) => state.toggleNode)
  const selectNode = useAppStore((state) => state.selectNode)

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
        title={node.description ?? node.label}
        onClick={() => selectNode(node)}
        onDoubleClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter') open()
          if (event.key === 'ArrowRight' && node.hasChildren && !expanded) void toggleNode(node)
          if (event.key === 'ArrowLeft' && expanded) void toggleNode(node)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          selectNode(node)
          if (['type', 'method', 'field', 'property', 'event'].includes(node.kind))
            onAnalyzeNode(node)
        }}
      >
        <button
          className="tree-expander"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          disabled={!node.hasChildren}
          onClick={(event) => {
            event.stopPropagation()
            void toggleNode(node)
          }}
        >
          {loading ? <LoaderCircle className="spin" size={13} /> : node.hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </button>
        <span className={`tree-icon kind-${node.kind}`}><NodeIcon icon={node.icon} /></span>
        <span className="tree-label">{node.label}</span>
      </div>
      {expanded && children?.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} onOpenNode={onOpenNode} onAnalyzeNode={onAnalyzeNode} />
      ))}
    </>
  )
}

export const AssemblyExplorer = ({ onOpenNode, onAnalyzeNode }: AssemblyExplorerProps): React.JSX.Element => {
  const roots = useAppStore((state) => state.roots)
  const expanded = useAppStore((state) => state.expanded)
  const toggleNode = useAppStore((state) => state.toggleNode)

  useEffect(() => {
    for (const root of roots) {
      if (!expanded[root.id])
        void toggleNode(root)
    }
  }, [roots]) // Expanding freshly loaded roots is intentional.

  if (roots.length === 0)
    return <div className="pane-empty">No assemblies loaded</div>

  return (
    <div className="assembly-tree" role="tree" aria-label="Assembly Explorer">
      {roots.map((root) => (
        <TreeRow key={root.id} node={root} depth={0} onOpenNode={onOpenNode} onAnalyzeNode={onAnalyzeNode} />
      ))}
    </div>
  )
}
