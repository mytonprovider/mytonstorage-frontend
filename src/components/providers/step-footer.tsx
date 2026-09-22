import type { ReactNode } from "react"
import { Loader } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Notice } from "../notice"
import { SheetField } from "../sheet-fields"
import { SheetFooter } from "../sheet"
import shared from "../shared.module.css"
import styles from "./providers-step.module.css"

interface StepFooterProps {
  editor: boolean
  warning?: string
  total?: string
  until?: string
  declined: ReactNode
  error: string | null
  checking: boolean
  noneSelected: boolean
  submitDisabled: boolean
  submitReason?: string
  submitLabel?: string
  onBack?: () => void
  onContinue: () => void
}

export const StepFooter = ({
  editor,
  warning,
  total,
  until,
  declined,
  error,
  checking,
  noneSelected,
  submitDisabled,
  submitReason,
  submitLabel,
  onBack,
  onContinue,
}: StepFooterProps) => {
  const { t } = useTranslation()

  const warningNotice = warning && (
    <Notice tone="yellow" className={styles.stepError}>
      {warning}
    </Notice>
  )

  const summary = total && (
    <div className={styles.summary}>
      <div className={styles.total}>
        <span>{t("period.total")}</span>
        <span className={shared.spacer} />
        <span className={styles.totalValue}>{total}</span>
      </div>
      {until && <SheetField label={t("files.topupNewUntil")} value={until} />}
    </div>
  )

  const errorNotice = error && (
    <Notice tone="red" className={styles.stepError}>
      {t(error)}
    </Notice>
  )

  const actions = (
    <>
      {onBack && (
        <button type="button" onClick={onBack} className={shared.secondary}>
          {t("ui.back")}
        </button>
      )}
      <span className={shared.spacer} />
      <button
        type="button"
        onClick={onContinue}
        disabled={noneSelected || checking || submitDisabled}
        title={submitDisabled ? submitReason : noneSelected ? t("catalog.noneSelected") : undefined}
        className={shared.primary}
      >
        {checking && <Loader strokeWidth={2.5} aria-hidden="true" className={styles.spinner} />}
        <span>{submitLabel ?? t("ui.continue")}</span>
      </button>
    </>
  )

  if (editor) {
    return (
      <SheetFooter className={styles.footerStack}>
        {warningNotice}
        {summary}
        {declined}
        {errorNotice}
        <div className={styles.footer}>{actions}</div>
      </SheetFooter>
    )
  }

  return (
    <>
      {warningNotice}
      {summary}
      <SheetFooter className={styles.footer}>{actions}</SheetFooter>
      {errorNotice}
    </>
  )
}
