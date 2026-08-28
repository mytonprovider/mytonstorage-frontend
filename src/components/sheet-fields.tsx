import type { ComponentType, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { CopyButton } from "./copy-button"
import shared from "./shared.module.css"
import styles from "./sheet-fields.module.css"

interface SheetSectionProps {
  icon: ComponentType<{ className?: string; "aria-hidden"?: "true" }>
  title: string
  children: ReactNode
}

export const SheetSection = ({ icon: Icon, title, children }: SheetSectionProps) => (
  <section className={shared.panel}>
    <h3 className={styles.title}>
      <Icon className={shared.titleIcon} aria-hidden="true" />
      <span>{title}</span>
    </h3>
    <div className={styles.fields}>{children}</div>
  </section>
)

export interface SheetFieldProps {
  label: string
  value: string
  title?: string
  href?: string
  mono?: boolean
  upper?: boolean
  alert?: boolean
  ghost?: boolean
  copy?: string
  copied?: string | null
  onCopy?: (value: string) => void
}

export const SheetField = ({
  label,
  value,
  title,
  href,
  mono,
  upper,
  alert,
  ghost,
  copy,
  copied,
  onCopy,
}: SheetFieldProps) => {
  const { t } = useTranslation()

  return (
    <div aria-hidden={ghost ? "true" : undefined} className={styles.field}>
      <span className={cx(styles.label, ghost && shared.shape)}>{label}</span>
      <span className={styles.gap} />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={title}
          className={cx(styles.value, styles.link, mono && styles.mono, upper && styles.upper)}
        >
          {value}
        </a>
      ) : (
        <span
          title={title}
          className={cx(styles.value, mono && styles.mono, upper && styles.upper, alert && styles.alert, ghost && shared.shape)}
        >
          {value}
        </span>
      )}
      {copy && onCopy && (
        <CopyButton
          value={copy}
          copied={copied === copy}
          onCopy={onCopy}
          label={`${t("ui.copy")} ${value}`}
          className={styles.copy}
        />
      )}
    </div>
  )
}
