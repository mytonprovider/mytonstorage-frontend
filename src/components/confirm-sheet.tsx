import { Sheet, SheetFooter } from "./sheet"
import shared from "./shared.module.css"

interface ConfirmSheetProps {
  open: boolean
  title: string
  note: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

export const ConfirmSheet = ({ open, title, note, confirmLabel, onConfirm, onClose }: ConfirmSheetProps) => (
  <Sheet size="auto" open={open} title={title} onClose={onClose}>
    <p className={shared.sheetNote}>{note}</p>
    <SheetFooter className={shared.sheetActions}>
      <button type="button" onClick={onConfirm} className={shared.danger}>
        {confirmLabel}
      </button>
    </SheetFooter>
  </Sheet>
)
