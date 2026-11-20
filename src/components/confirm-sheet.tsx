import type { ReactNode } from "react"
import { ConfirmBody, Sheet } from "@myton/ui"

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

export const ConfirmSheet = ({ open, title, subject, onClose, ...body }: ConfirmSheetProps) => (
  <Sheet open={open} title={title} subject={subject} onClose={onClose}>
    <ConfirmBody {...body} close={onClose} />
  </Sheet>
)
