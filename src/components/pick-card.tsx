import type { LucideIcon } from "lucide-react"
import { cx } from "@/lib/cx"
import type { Tone } from "@/types/tone"
import { Hint } from "./hint"
import shared from "./shared.module.css"

interface PickCardProps {
  icon: LucideIcon
  title: string
  note: string
  hint?: string
  tone?: Tone
  active: boolean
  disabled?: boolean
  role?: "radio" | "button"
  onPick: () => void
  className?: string
}

export const PickCard = ({ icon: Icon, title, note, hint, tone, active, disabled, role = "radio", onPick, className }: PickCardProps) => (
  <button
    type="button"
    role={role}
    aria-checked={role === "radio" ? active : undefined}
    aria-pressed={role === "button" ? active : undefined}
    disabled={disabled}
    data-tone={tone}
    onClick={onPick}
    className={cx(shared.pickCard, active && shared.pickCardOn, className)}
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
