import { memo } from 'react'
import { showPopupMenu, type IPopupMenuItem, type PopupMenuEntry } from 'flexlayout-react'
import {
  Binary,
  Box,
  Braces,
  Brackets,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Code2,
  FileBox,
  FileCode2,
  Files,
  Folder,
  FolderOpen,
  Library,
  LoaderCircle,
  Network,
  Package,
  Variable,
} from 'lucide-react'
import type { TreeNode } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { useLanguage } from '../localization'
import { useAppOptions } from './app-options'

interface AssemblyExplorerProps {
  onOpenNode(node: TreeNode): void
  onAnalyzeNode(node: TreeNode): void
  onShowHex(node: TreeNode): void
  onShowModuleInfo(node: TreeNode): void
}

/** The tree's icon for a node, shared with the dialogs that show the same tree — the type picker. */
export const NodeIcon = ({ icon, expanded = false }: { icon?: string; expanded?: boolean }): React.JSX.Element => {
  const props = { size: 15, strokeWidth: 1.6, 'aria-hidden': true as const }
  switch (icon) {
    // These shapes follow dnSpy's WPF image set: assemblies are stacked documents, while a
    // module is the purple package shown beneath them in the tree.
    case 'assembly': return <Files {...props} />
    case 'assembly-exe': return <FileCode2 {...props} />
    case 'module': return <Package {...props} />
    // A file that is not a managed assembly: dnSpy shows a PE document with the assembly icon, an ELF image
    // and the structures read out of either with the binary one, and a file it could not read with the error.
    case 'binary': return <Binary {...props} />
    case 'error': return <CircleAlert {...props} />
    case 'namespace': return <Brackets {...props} />
    case 'reference': return <Library {...props} />
    case 'resource': return <FileBox {...props} />
    case 'folder': return expanded ? <FolderOpen {...props} /> : <Folder {...props} />
    case 'method': return <Code2 {...props} />
    case 'field': return <Variable {...props} />
    case 'property': return <Braces {...props} />
    case 'event': return <CircleDot {...props} />
    case 'interface': return <Network {...props} />
    default: return <Box {...props} />
  }
}

const contextMenuItem = (key: string, label: string, onSelect: () => void): IPopupMenuItem => ({ key, label, onSelect })

// The kinds whose row names a type after the colon, and the ones dnSpy's NodeFormatter appends a raw
// metadata token to — members, assemblies, modules and assembly references, but not namespaces, the
// group folders, resources or the PE/ELF structures.
const KINDS_WITH_RETURN_TYPE = new Set(['method', 'field', 'property', 'event'])
const KINDS_WITH_TOKEN = new Set(['type', 'assembly', 'module', 'assemblyreference', ...KINDS_WITH_RETURN_TYPE])

const formatMetadataToken = (token: number): string =>
  `@${(token >>> 0).toString(16).toUpperCase().padStart(8, '0')}`

/**
 * The text a tree row wears — dnSpy's NodeFormatter writes "name : RetType @06000004": members name
 * their type after a colon, and a metadata row gets its token appended unless the user turned tokens
 * off. The tooltip keeps the bare label, which is the full signature the row abbreviates.
 */
export const composeTreeRowText = (label: string, node: TreeNode, showToken: boolean): string => {
  const typeSuffix = node.returnType != null && KINDS_WITH_RETURN_TYPE.has(node.kind) ? ` : ${node.returnType}` : ''
  const tokenSuffix = showToken && node.metadataToken != null && KINDS_WITH_TOKEN.has(node.kind) ? ` ${formatMetadataToken(node.metadataToken)}` : ''
  return `${label}${typeSuffix}${tokenSuffix}`
}

const TreeRow = memo(({ node, depth, showToken, onOpenNode, onAnalyzeNode, onShowHex, onShowModuleInfo }: AssemblyExplorerProps & { node: TreeNode; depth: number; showToken: boolean }): React.JSX.Element => {
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
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {loading ? <LoaderCircle className="spin" size={13} /> : node.hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </button>
        <span className={`tree-icon kind-${node.kind} icon-${node.icon ?? 'item'}`}><NodeIcon icon={node.icon} expanded={expanded} /></span>
        <span className="tree-label">{composeTreeRowText(label, node, showToken)}</span>
      </div>
      {expanded && children?.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} showToken={showToken} onOpenNode={onOpenNode} onAnalyzeNode={onAnalyzeNode} onShowHex={onShowHex} onShowModuleInfo={onShowModuleInfo} />
      ))}
    </>
  )
})

export const AssemblyExplorer = ({ onOpenNode, onAnalyzeNode, onShowHex, onShowModuleInfo }: AssemblyExplorerProps): React.JSX.Element => {
  const roots = useAppStore((state) => state.roots)
  const showToken = useAppOptions().assemblyExplorer.showToken
  const { t } = useLanguage()

  if (roots.length === 0)
    return <div className="pane-empty">{t('No assemblies loaded')}</div>

  return (
    <div className="assembly-tree" role="tree" aria-label={t('Assembly Explorer')}>
      {roots.map((root) => (
        <TreeRow key={root.id} node={root} depth={0} showToken={showToken} onOpenNode={onOpenNode} onAnalyzeNode={onAnalyzeNode} onShowHex={onShowHex} onShowModuleInfo={onShowModuleInfo} />
      ))}
    </div>
  )
}
