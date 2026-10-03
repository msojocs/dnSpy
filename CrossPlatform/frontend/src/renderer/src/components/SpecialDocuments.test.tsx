import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../app-store'
import { HexView } from './SpecialDocuments'

const pageSize = 4096
const moduleId = 'mod1'

/** A file whose byte at `offset` is `offset % 251`, so any page is tellable from any other. */
const fileLength = pageSize * 2
const fileByte = (offset: number): number => offset % 251

const base64Of = (bytes: number[]): string => btoa(String.fromCharCode(...bytes))

const getHexLength = vi.fn(async () => ({ length: fileLength }))
const readHex = vi.fn(async (_workspaceId: string, _moduleId: string, offset: number, length: number) => ({
  base64Data: base64Of(Array.from({ length: Math.min(length, fileLength - offset) }, (_, index) => fileByte(offset + index))),
}))

beforeEach(() => {
  getHexLength.mockClear()
  readHex.mockClear()
  Object.defineProperty(window, 'dnSpy', { configurable: true, value: { ...window.dnSpy, getHexLength, readHex } })
  useAppStore.setState({
    workspaceId: 'w1',
    workspaceStateId: 'state-1',
    hexNavigation: undefined,
  })
})

afterEach(cleanup)

describe('HexView', () => {
  it('dumps the first page as addresses, bytes and ASCII', async () => {
    const { container } = render(<HexView moduleId={moduleId} />)

    await waitFor(() => expect(container.querySelectorAll('.hex-line')).toHaveLength(pageSize / 16))

    const first = container.querySelector('.hex-line')!
    expect(first.querySelector('.hex-address')).toHaveTextContent('00000000')
    // 0x00 renders as the non-printable dot, and the bytes sit two digits at a time.
    expect(first.querySelector('.hex-ascii')).toHaveTextContent('.')
    expect(first.textContent).toContain('00 01 02 03')
    expect(readHex).toHaveBeenCalledWith('w1', moduleId, 0, pageSize)
  })

  it('reads the page the navigation asked for and marks the range it named', async () => {
    // "Show ... in Hex Editor" names a file offset; the page holding it is what gets read.
    act(() => { useAppStore.getState().showHexAt(moduleId, pageSize + 3, 2) })
    const { container } = render(<HexView moduleId={moduleId} />)

    await waitFor(() => expect(container.querySelectorAll('.hex-line')).toHaveLength(pageSize / 16))

    expect(readHex).toHaveBeenCalledWith('w1', moduleId, pageSize, pageSize)
    expect(container.querySelector('.hex-address')).toHaveTextContent('00001000')
    const marked = [...container.querySelectorAll('.hex-byte-marked')]
    // The separator space rides along with its byte, so the dump keeps its spacing while marking.
    expect(marked.map((cell) => cell.textContent!.trim())).toEqual([fileByte(pageSize + 3).toString(16).toUpperCase().padStart(2, '0'), fileByte(pageSize + 4).toString(16).toUpperCase().padStart(2, '0')])
  })

  it('leaves another module’s tab where it was', async () => {
    act(() => { useAppStore.getState().showHexAt('other', pageSize + 3, 2) })
    const { container } = render(<HexView moduleId={moduleId} />)

    await waitFor(() => expect(container.querySelectorAll('.hex-line')).toHaveLength(pageSize / 16))

    expect(readHex).toHaveBeenCalledWith('w1', moduleId, 0, pageSize)
    expect(container.querySelectorAll('.hex-byte-marked')).toHaveLength(0)
  })

  it('reads the page again after an edit, so an undo shows up here', async () => {
    const { container } = render(<HexView moduleId={moduleId} />)
    await waitFor(() => expect(container.querySelectorAll('.hex-line')).toHaveLength(pageSize / 16))
    expect(readHex).toHaveBeenCalledTimes(1)

    // A byte patch is an edit like any other, and every edit bumps the state id.
    act(() => { useAppStore.setState({ workspaceStateId: 'state-2' }) })

    await waitFor(() => expect(readHex).toHaveBeenCalledTimes(2))
  })

  it('pages forward and back within the file', async () => {
    const { container } = render(<HexView moduleId={moduleId} />)
    await waitFor(() => expect(container.querySelectorAll('.hex-line')).toHaveLength(pageSize / 16))

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(readHex).toHaveBeenLastCalledWith('w1', moduleId, pageSize, pageSize))
    expect(container.querySelector('.hex-address')).toHaveTextContent('00001000')
  })
})
