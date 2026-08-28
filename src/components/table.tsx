import type { CSSProperties, KeyboardEvent, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { CopyButton } from "./copy-button"
import shared from "./shared.module.css"
import styles from "./table.module.css"

export const activateOnKey =
  (activate: () => void) =>
  (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    activate()
  }

interface TableLeadProps {
  shortValue: string
  title: string
  href?: string
  copy: string
  copied: string | null
  onCopy: (value: string) => void
}

export const TableLead = ({ shortValue, title, href, copy, copied, onCopy }: TableLeadProps) => {
  const { t } = useTranslation()

  return (
    <span className={shared.tableLead}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={title}
          onClick={(event) => event.stopPropagation()}
          className={styles.leadLink}
        >
          {shortValue}
        </a>
      ) : (
        <span title={title} className={shared.tableMono}>
          {shortValue}
        </span>
      )}
      <CopyButton value={copy} copied={copied === copy} onCopy={onCopy} label={`${t("ui.copy")} ${shortValue}`} />
    </span>
  )
}

interface TableCellProps {
  label: string
  value?: string
  title?: string
  ghost?: boolean
  children?: ReactNode
}

export const TableCell = ({ label, value, title, ghost, children }: TableCellProps) => (
  <div className={shared.tableCell}>
    <span className={cx(shared.tableLabel, ghost && shared.ghost)}>{label}</span>
    {children ?? (
      <span title={title} className={cx(shared.tableValue, ghost && shared.shape)}>
        {value}
      </span>
    )}
  </div>
)

export const Ratio = ({ valid, total }: { valid: number; total: number }) => {
  const { t } = useTranslation()

  if (total === 0) return <span className={shared.ratio}>{t("status.noChecksYet")}</span>

  return (
    <span className={shared.ratio}>
      <span className={shared.valid}>{valid}</span>
      <span className={shared.slash}>/</span>
      <span className={shared.total}>{total}</span>
    </span>
  )
}

export const GhostValue = ({ width }: { width: string }) => (
  <span className={styles.ghostValue} style={{ "--ghost-w": width } as CSSProperties} />
)

export const GhostCopy = () => <span className={styles.ghostCopy} />
