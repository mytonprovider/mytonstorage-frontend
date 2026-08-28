import { useCallback, useEffect, useRef, type ReactNode } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cx } from "@/lib/cx"
import { VIEWPORT_EDGE, clampToViewport } from "@/lib/dom"
import shared from "./shared.module.css"
import styles from "./menu.module.css"

const GAP = 6

interface MenuProps {
  label: string
  active: boolean
  open: boolean
  onToggle: () => void
  align?: "left" | "right"
  children: ReactNode
}

export const Menu = ({ label, active, open, onToggle, align = "left", children }: MenuProps) => {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return
    if (!panel.matches(":popover-open")) panel.showPopover()

    panel.style.maxHeight = ""
    panel.style.minWidth = ""
    const rect = trigger.getBoundingClientRect()
    if (rect.width > panel.offsetWidth) panel.style.minWidth = `${rect.width}px`

    const below = window.innerHeight - rect.bottom - GAP - VIEWPORT_EDGE
    const above = rect.top - GAP - VIEWPORT_EDGE
    const drop = panel.offsetHeight <= below || below >= above
    const wanted = align === "right" ? rect.right - panel.offsetWidth : rect.left

    panel.style.left = `${clampToViewport(wanted, panel.offsetWidth)}px`
    panel.style.maxHeight = `${Math.max(drop ? below : above, 0)}px`
    panel.style.top = drop ? `${rect.bottom + GAP}px` : "auto"
    panel.style.bottom = drop ? "auto" : `${window.innerHeight - rect.top + GAP}px`
  }, [align])

  useEffect(() => {
    if (!open) return
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, { passive: true, capture: true })
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, { capture: true })
    }
  }, [open, place])

  return (
    <div data-menuroot="1" className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        data-tone={active ? "accent" : "field"}
        className={styles.trigger}
      >
        <span title={label} className={shared.ellipsis}>{label}</span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </button>
      {open && (
        <div ref={panelRef} popover="manual" className={styles.popover}>
          {children}
        </div>
      )}
    </div>
  )
}

interface MenuOptionProps {
  label: string
  count: number
  selected: boolean
  dimmed: boolean
  onToggle: () => void
}

export const MenuOption = ({ label, count, selected, dimmed, onToggle }: MenuOptionProps) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={selected}
    aria-disabled={dimmed || undefined}
    onClick={dimmed ? undefined : onToggle}
    className={styles.option}
  >
    <span className={cx(styles.check, selected && styles.checked)}>
      {selected && <Check strokeWidth={3.5} className={styles.checkIcon} aria-hidden="true" />}
    </span>
    <span className={shared.ellipsis}>{label}</span>
    <span className={shared.spacer} />
    <span className={styles.count}>{count}</span>
  </button>
)

interface RangeMenuBodyProps {
  value: string
  unit: string
  note?: string
  onReset: () => void
  resetLabel: string
  children: ReactNode
}

export const RangeMenuBody = ({ value, unit, note, onReset, resetLabel, children }: RangeMenuBodyProps) => (
  <div className={styles.rangePanel}>
    <div className={styles.rangeHead}>
      <span className={styles.rangeValue}>{value}</span>
      <span className={styles.rangeUnit}>{unit}</span>
    </div>
    {children}
    {note && <p className={styles.rangeNote}>{note}</p>}
    <div className={styles.rangeFoot}>
      <button type="button" onClick={onReset} className={shared.textDanger}>
        {resetLabel}
      </button>
    </div>
  </div>
)
