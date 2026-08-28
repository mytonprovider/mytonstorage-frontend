import type { CSSProperties, KeyboardEvent } from "react"
import { cx } from "@/lib/cx"
import styles from "./tabs.module.css"

interface TabOption<T extends string> {
  value: T
  label: string
  badge?: string
}

interface TabsProps<T extends string> {
  options: Array<TabOption<T>>
  value: T
  onChange: (value: T) => void
}

export const tabId = (value: string): string => `tab-${value}`

export const tabPanelId = (value: string): string => `tabpanel-${value}`

const indexOnKey = (key: string, index: number, count: number): number | null => {
  if (key === "ArrowLeft") return (index - 1 + count) % count
  if (key === "ArrowRight") return (index + 1) % count
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return null
}

export const Tabs = <T extends string>({ options, value, onChange }: TabsProps<T>) => {
  const index = Math.max(0, options.findIndex((option) => option.value === value))

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = indexOnKey(event.key, index, options.length)
    if (next === null) return
    event.preventDefault()
    event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus()
    onChange(options[next].value)
  }

  return (
    <span
      role="tablist"
      className={styles.tablist}
      style={{ "--count": options.length, "--index": index } as CSSProperties}
    >
      <span aria-hidden="true" className={styles.pill} />
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={tabId(option.value)}
            aria-selected={selected}
            aria-controls={selected ? tabPanelId(option.value) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
            className={cx(styles.tab, selected && styles.selected)}
          >
            <span>{option.label}</span>
            {option.badge && <span className={styles.badge}>{option.badge}</span>}
          </button>
        )
      })}
    </span>
  )
}
