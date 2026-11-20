import type { ReactNode } from "react"
import { FieldGroup, FieldRow, ShortId, skeletonClass } from "@myton/ui"
import styles from "./sheet-fields.module.css"

interface SheetSectionProps {
  title: string
  children: ReactNode
}

export const SheetSection = ({ title, children }: SheetSectionProps) => (
  <FieldGroup title={title} className={styles.section}>
    {children}
  </FieldGroup>
)

export interface SheetFieldProps {
  label: string
  value?: string
  // A key, address or hash: ShortId fits it to the row, so the value is left out.
  id?: string
  title?: string
  href?: string
  mono?: boolean
  upper?: boolean
  alert?: boolean
  warn?: boolean
  ghost?: boolean
  copy?: string
  copied?: string | null
  onCopy?: (value: string) => void
}

export const SheetField = ({ id, value = "", upper, mono, alert, warn, ghost, copy, copied, ...field }: SheetFieldProps) => (
  <FieldRow
    {...field}
    value={id ? <ShortId value={id} upper={Boolean(upper)} /> : value}
    upper={id ? undefined : upper}
    mono={id ? undefined : mono}
    tone={alert ? "red" : warn ? "yellow" : undefined}
    copy={copy}
    copied={copy !== undefined && copied === copy}
    hidden={ghost}
    labelClassName={ghost ? skeletonClass() : undefined}
    valueClassName={ghost ? skeletonClass() : undefined}
  />
)
