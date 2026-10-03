import { useEffect, useRef, useState } from 'react'
// The `window` listener below works with the platform's own event; `trapTabKey` is called from React
// handlers and takes the synthetic one.
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * The dialogs currently on screen, outermost first. dnSpy's option dialogs stack — an Edit Method
 * dialog opens the type picker, which can open the custom-attribute editor — and two things have to
 * follow that order:
 *
 *  - Escape. Each dialog registers its own `window` keydown listener, and those fire in registration
 *    order, so without a guard the *outer* dialog closes first and the stack collapses from the middle.
 *  - The backdrop's z-index. `.modal-backdrop` is a flat 100, so a dialog drawn inside another one
 *    would not cover it.
 */
const openLayers: number[] = []

/**
 * How many dialogs are stacked over this one: 0 for the outermost, 1 for a dialog it opened, and so
 * on. Pair it with `100 + depth * 10` for the backdrop's z-index, and hand the dialog's close handler
 * to `onEscape` to have Escape reach only the innermost dialog on screen.
 *
 * The slot is claimed, and its Escape listener armed, in one effect — which is also why that listener
 * guards on the number the effect just took rather than on the one this hook returns. A dialog is on
 * screen a render before the number exists: a listener registered against the returned value answers
 * Escape with the depth of the dialog underneath and stays deaf to it until React gets around to
 * running the effect again, which is long enough for the key the user pressed while the picker was
 * still appearing to be swallowed. `onEscape` is kept in a ref for the same reason — the caller writes
 * it fresh on every render, and the listener is armed only once.
 */
export const useModalLayer = (onEscape?: () => void): number => {
  const [depth, setDepth] = useState(0)
  const escape = useRef(onEscape)
  useEffect(() => { escape.current = onEscape })

  useEffect(() => {
    const assigned = openLayers.length
    openLayers.push(assigned)
    setDepth(assigned)
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && openLayers.at(-1) === assigned) {
        event.preventDefault()
        escape.current?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      const index = openLayers.lastIndexOf(assigned)
      if (index !== -1)
        openLayers.splice(index, 1)
    }
  }, [])
  return depth
}

/**
 * Wraps Tab focus inside `root`, the way WPF's dialogs do implicitly through their window chrome.
 * Extracted from the Options dialog so every dialog added on top of it traps focus the same way.
 */
export const trapTabKey = (event: ReactKeyboardEvent, root: HTMLElement | null): void => {
  if (event.key !== 'Tab' || !root)
    return
  const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
  if (focusable.length === 0)
    return
  const first = focusable[0]
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
