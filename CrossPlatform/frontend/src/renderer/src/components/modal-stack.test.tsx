import { useEffect, useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTopModal, trapTabKey, useModalLayer } from './modal-stack'

/**
 * Stands in for an option dialog: claims a layer, and closes on Escape only while it is the innermost
 * one — exactly the guard the real dialogs use, with their `window` listener registered in mount
 * order so the outer one would fire first without it.
 */
const Layer = ({ name, onClose }: { name: string; onClose(): void }): React.JSX.Element => {
  const depth = useModalLayer()
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isTopModal(depth))
        onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [depth, onClose])
  return <div data-testid={`layer-${name}`} data-depth={depth} />
}

/** The outermost dialog, plus whatever it has opened on top of itself. */
const Stack = ({ inner, onOuterClose, onInnerClose }: { inner: boolean; onOuterClose(): void; onInnerClose(): void }): React.JSX.Element => (
  <>
    <Layer name="outer" onClose={onOuterClose} />
    {inner && <Layer name="inner" onClose={onInnerClose} />}
  </>
)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useModalLayer', () => {
  it('numbers the dialogs in the order they opened, and frees the slot on close', () => {
    const { rerender } = render(<Stack inner onOuterClose={vi.fn()} onInnerClose={vi.fn()} />)
    expect(screen.getByTestId('layer-outer').dataset.depth).toBe('0')
    expect(screen.getByTestId('layer-inner').dataset.depth).toBe('1')

    rerender(<Stack inner={false} onOuterClose={vi.fn()} onInnerClose={vi.fn()} />)
    // The outer dialog had slot 0 all along, so closing the inner one leaves it where it was.
    expect(screen.getByTestId('layer-outer').dataset.depth).toBe('0')
  })

  it('lets Escape through only to the innermost dialog', () => {
    const onOuterClose = vi.fn()
    const onInnerClose = vi.fn()
    const { rerender } = render(<Stack inner onOuterClose={onOuterClose} onInnerClose={onInnerClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onInnerClose).toHaveBeenCalledTimes(1)
    expect(onOuterClose).not.toHaveBeenCalled()

    // Once the picker is gone, the dialog underneath takes Escape again.
    rerender(<Stack inner={false} onOuterClose={onOuterClose} onInnerClose={onInnerClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOuterClose).toHaveBeenCalledTimes(1)
    expect(onInnerClose).toHaveBeenCalledTimes(1)
  })
})

describe('trapTabKey', () => {
  const Harness = (): React.JSX.Element => {
    const root = useRef<HTMLDivElement>(null)
    return (
      <div ref={root} onKeyDown={(event) => trapTabKey(event, root.current)}>
        <button type="button">first</button>
        <button type="button">middle</button>
        <button type="button">last</button>
      </div>
    )
  }

  it('wraps Tab from the last control back to the first', () => {
    render(<Harness />)
    const last = screen.getByRole('button', { name: 'last' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }))
  })

  it('wraps Shift+Tab from the first control to the last', () => {
    render(<Harness />)
    const first = screen.getByRole('button', { name: 'first' })
    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }))
  })

  it('leaves Tab alone in the middle of the dialog', () => {
    render(<Harness />)
    const middle = screen.getByRole('button', { name: 'middle' })
    middle.focus()
    fireEvent.keyDown(middle, { key: 'Tab' })
    expect(document.activeElement).toBe(middle)
  })
})
