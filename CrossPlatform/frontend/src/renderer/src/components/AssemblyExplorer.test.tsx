import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TreeNode } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { loadAppOptions, saveAppOptions } from './app-options'
import { AssemblyExplorer, composeTreeRowText } from './AssemblyExplorer'

const assembly: TreeNode = { id: 'assembly', kind: 'assembly', label: 'Example', hasChildren: true }

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ roots: [assembly], children: {}, expanded: {}, loadingNodes: {}, selectedNode: undefined })
})

afterEach(cleanup)

it('keeps double-clicking the expander from opening an assembly document', () => {
  const onOpenNode = vi.fn()
  render(<AssemblyExplorer onOpenNode={onOpenNode} onAnalyzeNode={vi.fn()} onShowHex={vi.fn()} onShowModuleInfo={vi.fn()} />)

  fireEvent.doubleClick(screen.getByRole('button', { name: 'Expand' }))
  expect(onOpenNode).not.toHaveBeenCalled()

  fireEvent.doubleClick(screen.getByRole('treeitem'))
  expect(onOpenNode).toHaveBeenCalledWith(assembly)
})

it('composes the dnSpy row text out of the return type and the token', () => {
  const method: TreeNode = { id: 'm', kind: 'method', label: 'get_Code()', hasChildren: false, metadataToken: 0x06000004, returnType: 'int' }
  expect(composeTreeRowText(method.label, method, true)).toBe('get_Code() : int @06000004')
  // Turning tokens off keeps the colon part — dnSpy's tree always names a member's type.
  expect(composeTreeRowText(method.label, method, false)).toBe('get_Code() : int')
})

it('appends the token only where dnSpy writes one', () => {
  const type: TreeNode = { id: 't', kind: 'type', label: 'HelloRequest', hasChildren: true, metadataToken: 0x02000002 }
  const reference: TreeNode = { id: 'r', kind: 'assemblyreference', label: 'dnSpy.Backend.Contracts', hasChildren: false, metadataToken: 0x23000001 }
  const namespaceNode: TreeNode = { id: 'n', kind: 'namespace', label: 'dnSpy.Backend.Contracts', hasChildren: true }
  // A group row is no metadata row, so a token must not leak into it even if one arrived.
  const group: TreeNode = { id: 'g', kind: 'referencesgroup', label: 'Assembly References', hasChildren: true, metadataToken: 0x1 }
  expect(composeTreeRowText(type.label, type, true)).toBe('HelloRequest @02000002')
  expect(composeTreeRowText(reference.label, reference, true)).toBe('dnSpy.Backend.Contracts @23000001')
  expect(composeTreeRowText(namespaceNode.label, namespaceNode, true)).toBe('dnSpy.Backend.Contracts')
  expect(composeTreeRowText(group.label, group, true)).toBe('Assembly References')
})

it('re-reads the token option when it is saved', () => {
  useAppStore.setState({ roots: [{ ...assembly, metadataToken: 0x20000001 }] })
  render(<AssemblyExplorer onOpenNode={vi.fn()} onAnalyzeNode={vi.fn()} onShowHex={vi.fn()} onShowModuleInfo={vi.fn()} />)
  expect(screen.getByText('Example @20000001')).toBeInTheDocument()

  act(() => saveAppOptions({ ...loadAppOptions(), assemblyExplorer: { ...loadAppOptions().assemblyExplorer, showToken: false } }))
  expect(screen.getByText('Example')).toBeInTheDocument()
  expect(screen.queryByText('Example @20000001')).not.toBeInTheDocument()

  act(() => saveAppOptions({ ...loadAppOptions(), assemblyExplorer: { ...loadAppOptions().assemblyExplorer, showToken: true } }))
  expect(screen.getByText('Example @20000001')).toBeInTheDocument()
})
