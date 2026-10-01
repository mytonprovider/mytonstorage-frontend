import { useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { Hint } from "./hint"
import shared from "./shared.module.css"

type SortDirection = "asc" | "desc"

interface SortColumnProps {
  label: string
  hint?: string
  active: boolean
  direction: SortDirection
  onSort?: () => void
  className?: string
}

export const SortColumn = ({ label, hint, active, direction, onSort, className }: SortColumnProps) => {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)

  const body = (
    <>
      <span title={label} className={shared.ellipsis}>
        {label}
      </span>
      {hint && <Hint focusable={false} open={focused} text={hint} />}
    </>
  )

  if (!onSort) {
    return (
      <span className={cx(shared.sortColumn, className)}>
        {body}
      </span>
    )
  }

  const state = active ? t(direction === "asc" ? "ui.sortedAsc" : "ui.sortedDesc", { label }) : t("ui.sortColumn", { label })

  return (
    <button
      type="button"
      onClick={onSort}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-label={hint ? `${state}. ${hint}` : state}
      className={cx(shared.sortColumn, active && shared.sortColumnOn, className)}
    >
      {body}
      {active && direction === "asc" ? (
        <ArrowUp className={shared.sortColumnIcon} aria-hidden="true" />
      ) : (
        <ArrowDown className={cx(shared.sortColumnIcon, !active && shared.sortColumnIdle)} aria-hidden="true" />
      )}
    </button>
  )
}
