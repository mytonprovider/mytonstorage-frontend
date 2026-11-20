import type { LucideIcon } from "lucide-react"
import { cx, Hint } from "@myton/ui"
import shared from "./shared.module.css"

interface PickCardProps {
  icon: LucideIcon
  title: string
  note: string
  hint?: string
  active: boolean
  onPick: () => void
}

export const PickCard = ({ icon: Icon, title, note, hint, active, onPick }: PickCardProps) => (
  <button
    type="button"
    role="radio"
    aria-checked={active}
    onClick={onPick}
    className={cx(shared.pickCard, active && shared.pickCardOn)}
  >
    {hint && (
      <span className={shared.pickCardHint}>
        <Hint text={hint} />
      </span>
    )}
    <span className={shared.pickCardIcon}>
      <Icon className={shared.pickCardGlyph} aria-hidden="true" />
    </span>
    <span className={shared.pickCardTitle}>{title}</span>
    <span className={shared.pickCardNote}>{note}</span>
  </button>
)
