import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { TreeNode } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { AssemblyExplorer } from './AssemblyExplorer'

const assembly: TreeNode = { id: 'assembly', kind: 'assembly', label: 'Example', hasChildren: true }

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ roots: [assembly], children: {}, expanded: {}, loadingNodes: {}, selectedNode: undefined })
})

it('keeps double-clicking the expander from opening an assembly document', () => {
  const onOpenNode = vi.fn()
  render(<AssemblyExplorer onOpenNode={onOpenNode} onAnalyzeNode={vi.fn()} onShowHex={vi.fn()} onShowModuleInfo={vi.fn()} />)

  fireEvent.doubleClick(screen.getByRole('button', { name: 'Expand' }))
  expect(onOpenNode).not.toHaveBeenCalled()

  fireEvent.doubleClick(screen.getByRole('treeitem'))
  expect(onOpenNode).toHaveBeenCalledWith(assembly)
})
