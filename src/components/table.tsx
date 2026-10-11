import type { CSSProperties, KeyboardEvent, ReactNode, Ref, UIEventHandler } from "react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { CopyButton } from "./copy-button"
import shared from "./shared.module.css"
import styles from "./table.module.css"

interface TablePartProps {
  className?: string
  style?: CSSProperties
  children: ReactNode
}

export const TableScroll = ({ className, style, children, ref, onScroll }: TablePartProps & {
  ref?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
}) => (
  <div ref={ref} style={style} onScroll={onScroll} className={cx(shared.tableScroll, className)}>
    {children}
  </div>
)

export const TableFrame = ({ className, style, children }: TablePartProps) => (
  <div style={style} className={cx(shared.tableFrame, className)}>
    {children}
  </div>
)

export const TableHead = ({ className, children }: TablePartProps) => (
  <div className={cx(shared.tableHead, className)}>{children}</div>
)

export const TableRows = ({ className, style, children, ref }: TablePartProps & { ref?: Ref<HTMLDivElement> }) => (
  <div ref={ref} style={style} className={cx(shared.tableRows, className)}>
    {children}
  </div>
)

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
  upper?: boolean
  href?: string
  copy: string
  copied: string | null
  copyOnWide?: boolean
  onCopy: (value: string) => void
}

export const TableLead = ({ shortValue, title, upper, href, copy, copied, copyOnWide, onCopy }: TableLeadProps) => {
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
          className={cx(styles.leadLink, upper && styles.upper)}
        >
          {shortValue}
        </a>
      ) : (
        <span title={title} className={cx(shared.tableMono, upper && styles.upper)}>
          {shortValue}
        </span>
      )}
      <CopyButton
        value={copy}
        copied={copied === copy}
        onCopy={onCopy}
        label={`${t("ui.copy")} ${shortValue}`}
        className={cx(copyOnWide && styles.copyOnWide)}
      />
    </span>
  )
}

interface TableCellProps {
  label: string
  value?: string
  title?: string
  ghost?: boolean
  labelClassName?: string
  children?: ReactNode
}

export const TableCell = ({ label, value, title, ghost, labelClassName, children }: TableCellProps) => (
  <div className={shared.tableCell}>
    <span className={cx(ghost ? shared.tableLabelGhost : shared.tableLabel, labelClassName)}>{label}</span>
    {children ?? (
      <span title={title} className={cx(shared.tableValue, ghost && shared.shape)}>
        {value}
      </span>
    )}
  </div>
)

export const Ratio = ({ valid, total, tone }: { valid: number; total: number; tone?: string }) => {
  if (total === 0) return null

  return (
    <span className={shared.ratio}>
      <span data-tone={tone ?? (valid === total ? "green" : valid * 2 > total ? "yellow" : "red")} className={shared.ratioValid}>
        {valid}
      </span>
      <span className={shared.slash}>/</span>
      <span className={shared.ratioTotal}>{total}</span>
    </span>
  )
}

export const GhostValue = ({ sample, mono, vary }: { sample: string; mono?: boolean; vary?: boolean }) => (
  <span aria-hidden="true" className={cx(styles.ghostValue, mono && shared.tableMono, vary && styles.ghostVary)}>
    {sample}
  </span>
)

export const GhostGlyph = () => <span aria-hidden="true" className={styles.ghostIcon} />

export const GhostIcon = ({ size = "xs" }: { size?: "xs" | "sm" }) => (
  <span aria-hidden="true" className={cx(styles.ghostBox, styles[size])}>
    <GhostGlyph />
  </span>
)

export const GhostCopy = () => <GhostIcon />
