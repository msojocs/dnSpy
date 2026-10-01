import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'

export const WindowControls = (): React.JSX.Element => {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.dnSpy.isWindowMaximized().then((value) => {
      if (mounted) setIsMaximized(value)
    })
    const unsubscribe = window.dnSpy.onWindowMaximizedChange(setIsMaximized)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const toggleMaximize = async (): Promise<void> => {
    setIsMaximized(await window.dnSpy.toggleMaximizeWindow())
  }

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        className="window-control-button"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void window.dnSpy.minimizeWindow()}
      >
        <Minus size={15} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="window-control-button"
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        title={isMaximized ? 'Restore' : 'Maximize'}
        onClick={() => void toggleMaximize()}
      >
        {isMaximized ? <Copy size={12} strokeWidth={1.4} /> : <Square size={12} strokeWidth={1.4} />}
      </button>
      <button
        type="button"
        className="window-control-button window-close-button"
        aria-label="Close window"
        title="Close"
        onClick={() => void window.dnSpy.closeWindow()}
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  )
}
