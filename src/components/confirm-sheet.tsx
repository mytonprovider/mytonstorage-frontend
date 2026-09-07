import { Sheet, SheetFooter } from "./sheet"
import shared from "./shared.module.css"

interface ConfirmSheetProps {
  open: boolean
  title: string
  subject?: string
  note: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

export const ConfirmSheet = ({ open, title, subject, note, confirmLabel, onConfirm, onClose }: ConfirmSheetProps) => (
  <Sheet open={open} title={title} subject={subject} onClose={onClose}>
    <p className={shared.sheetNote}>{note}</p>
    <SheetFooter className={shared.sheetActions}>
      <button type="button" onClick={onConfirm} className={shared.danger}>
        {confirmLabel}
      </button>
    </SheetFooter>
  </Sheet>
)
