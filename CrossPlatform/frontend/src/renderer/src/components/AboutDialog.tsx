import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import appIconUrl from '../../../../../packaging/linux/icons/128x128.png'

interface AboutDialogProps {
  onClose(): void
}

export const AboutDialog = ({ onClose }: AboutDialogProps): React.JSX.Element => {
  const dialog = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => closeButton.current?.focus(), [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const keepFocusInDialog = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Tab' || !dialog.current)
      return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    if (focusable.length === 0)
      return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialog} className="modal about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" aria-describedby="about-description" onKeyDown={keepFocusInDialog}>
        <div className="modal-title">
          <span id="about-title">About dnSpy</span>
          <button ref={closeButton} type="button" className="icon-button" aria-label="Close About" title="Close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="about-content">
          <div className="about-brand">
            <img className="about-logo" src={appIconUrl} alt="" />
            <div>
              <div className="about-name">dnSpy</div>
              <div className="about-version">Version 1.0.0</div>
            </div>
          </div>
          <p id="about-description">Cross-platform .NET assembly browser, decompiler, editor and debugger.</p>
          <p className="about-license">Licensed under GNU GPL v3.0 only.</p>
        </div>
        <div className="modal-actions">
          <span className="modal-action-spacer" />
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
