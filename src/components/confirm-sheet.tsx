import type { ReactNode } from "react"
import { Notice } from "./notice"
import { Sheet, SheetFooter } from "./sheet"
import shared from "./shared.module.css"

interface ConfirmSheetProps {
  open: boolean
  title: string
  subject?: string
  note?: string
  alert?: string
  children?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

export const ConfirmSheet = ({ open, title, subject, note, alert, children, confirmLabel, onConfirm, onClose }: ConfirmSheetProps) => (
  <Sheet open={open} title={title} subject={subject} onClose={onClose}>
    {alert && (
      <Notice tone="red" className={shared.sheetAlert}>
        {alert}
      </Notice>
    )}
    {note && <p className={shared.sheetNote}>{note}</p>}
    {children}
    <SheetFooter className={shared.sheetActions}>
      <button type="button" onClick={onConfirm} className={shared.danger}>
        {confirmLabel}
      </button>
    </SheetFooter>
  </Sheet>
)
