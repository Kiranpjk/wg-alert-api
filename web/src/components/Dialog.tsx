import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

export function Dialog({ title, children, onClose, drawer = false }: {
  title: string
  children: ReactNode
  onClose: () => void
  drawer?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previousFocus = document.activeElement
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return <dialog ref={ref} aria-modal="true" aria-labelledby={titleId} className={drawer ? 'dialog drawer' : 'dialog'}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]',
      )).filter((item) => item.getClientRects().length > 0)
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }}>
    <div className="dialog-content">
      <header className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button>
      </header>
      {children}
    </div>
  </dialog>
}
