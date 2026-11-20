import { useRef, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Button, Popover } from "@myton/ui"
import shared from "./shared.module.css"
import styles from "./menu.module.css"

// A menu taller than this scrolls: twenty countries stood the screen high
const MAX_HEIGHT = 320

interface MenuProps {
  labels?: string[]
  label: string
  active: boolean
  open: boolean
  onToggle: () => void
  align?: "left" | "right"
  children: ReactNode
}

export const Menu = ({ label, labels, active, open, onToggle, align = "left", children }: MenuProps) => {
  const triggerRef = useRef<HTMLButtonElement>(null)

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
        <span className={shared.stack}>
          <span title={label} className={shared.ellipsis}>
            {label}
          </span>
          {labels && (
            <span aria-hidden="true" className={shared.stackGhost}>
              {labels.map((text) => (
                <span key={text}>{text}</span>
              ))}
            </span>
          )}
        </span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </button>
      {open && (
        <Popover
          anchor={triggerRef}
          align={align === "right" ? "end" : "start"}
          fit="content"
          maxHeight={MAX_HEIGHT}
          onDismiss={onToggle}
        >
          {children}
        </Popover>
      )}
    </div>
  )
}

interface RangeMenuBodyProps {
  onReset: () => void
  resetLabel: string
  children: ReactNode
}

export const RangeMenuBody = ({ onReset, resetLabel, children }: RangeMenuBodyProps) => (
  <div className={styles.rangePanel}>
    {children}
    <div className={styles.rangeFoot}>
      <Button variant="text" tone="red" onClick={onReset}>
        {resetLabel}
      </Button>
    </div>
  </div>
)
