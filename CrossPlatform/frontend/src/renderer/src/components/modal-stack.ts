import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'

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

/** Guards a key handler so it only acts while `depth` names the innermost open dialog. */
export const isTopModal = (depth: number): boolean => openLayers.at(-1) === depth

/**
 * How many dialogs are stacked over this one: 0 for the outermost, 1 for a dialog it opened, and so
 * on. Pair it with `isTopModal(depth)` for Escape and `100 + depth * 10` for the backdrop's z-index.
 */
export const useModalLayer = (): number => {
  // The slot is claimed in the effect rather than during render: React renders a whole tree before
  // running any of its effects, so two dialogs mounting in the same commit would otherwise both read
  // the stack as it was and claim the same depth. Effects run in mount order, so the outer one takes
  // slot 0 and the dialog it opened takes slot 1 — the re-render that follows is what puts the new
  // depth (and the matching z-index) on screen.
  const [depth, setDepth] = useState(0)
  useEffect(() => {
    const assigned = openLayers.length
    openLayers.push(assigned)
    setDepth(assigned)
    return () => {
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
export const trapTabKey = (event: KeyboardEvent, root: HTMLElement | null): void => {
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
