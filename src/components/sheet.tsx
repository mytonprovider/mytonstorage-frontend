import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { useSheetDrag } from "@/lib/sheet-drag"
import { IconButton } from "./icon-button"
import shared from "./shared.module.css"
import styles from "./sheet.module.css"

const LEAVE_GUARD_MS = 400

let lockCount = 0

const FooterSlot = createContext<HTMLDivElement | null>(null)

interface SheetFooterProps {
  className?: string
  children: ReactNode
}

export const SheetFooter = ({ className, children }: SheetFooterProps) => {
  const slot = useContext(FooterSlot)
  const row = <div className={className}>{children}</div>

  return slot ? createPortal(row, slot) : row
}

interface SheetProps {
  open: boolean
  title: string
  subject?: string
  size?: "full" | "auto"
  wide?: boolean
  onClose: () => void
  children: ReactNode
}

export const Sheet = ({ open, title, subject, size = "full", wide, onClose, children }: SheetProps) => {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const timer = useRef(0)
  const pressedBackdrop = useRef(false)
  const [leaving, setLeaving] = useState(false)
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)

  const requestClose = useCallback(() => {
    setLeaving(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(onClose, LEAVE_GUARD_MS)
  }, [onClose])

  const drag = useSheetDrag(open, requestClose)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) {
      dialog.showModal()
      dialog.focus()
    }
    if (!open && dialog.open) dialog.close()
    setLeaving(false)
  }, [open])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    const cancel = (event: Event) => {
      event.preventDefault()
      requestClose()
    }

    dialog.addEventListener("cancel", cancel)
    return () => dialog.removeEventListener("cancel", cancel)
  }, [requestClose])

  useLayoutEffect(() => {
    if (!open) return
    const root = document.documentElement
    lockCount += 1
    if (lockCount === 1) {
      const width = root.clientWidth
      root.style.overflow = "hidden"
      const grown = root.clientWidth - width
      if (grown > 0 && !CSS.supports("scrollbar-gutter", "stable")) root.style.paddingRight = `${grown}px`
    }
    return () => {
      lockCount -= 1
      if (lockCount === 0) {
        root.style.overflow = ""
        root.style.paddingRight = ""
      }
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className={cx(styles.sheet, size === "auto" && styles.auto, wide && styles.wide)}
      aria-label={subject ? `${title} ${subject}` : title}
      tabIndex={-1}
      data-dragging={drag.dragging ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
      style={drag.offset === null ? undefined : ({ "--sheet-y": `${drag.offset}px` } as CSSProperties)}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === ref.current
      }}
      onClick={(event) => {
        if (event.target === ref.current && pressedBackdrop.current) requestClose()
      }}
      onTransitionEnd={(event) => {
        if (!leaving || event.target !== ref.current) return
        window.clearTimeout(timer.current)
        onClose()
      }}
    >
      <div className={styles.header} onPointerDown={drag.onPointerDown}>
        <span className={styles.grabber} aria-hidden="true" />
        <span className={styles.title} title={title}>
          {title}
        </span>
        {subject && <span className={styles.subject}>{subject}</span>}
        <span className={shared.spacer} />
        <IconButton label={t("ui.close")} onClick={requestClose}>
          <X className={styles.closeIcon} aria-hidden="true" />
        </IconButton>
      </div>
      <div className={styles.body} ref={drag.bodyRef} onPointerDown={drag.onPointerDown}>
        <FooterSlot.Provider value={slot}>{children}</FooterSlot.Provider>
      </div>
      <div ref={setSlot} className={styles.footer} />
    </dialog>
  )
}
