import type { ReactNode } from "react"
import { Loader } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ActionRow, Button, Notice, SheetFooter } from "@myton/ui"
import { SheetField } from "../sheet-fields"
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
        <Button size="xl" onClick={onBack}>
          {t("ui:ui.back")}
        </Button>
      )}
      <Button
        variant="primary"
        size="xl"
        onClick={onContinue}
        disabled={noneSelected || checking || submitDisabled}
        title={submitDisabled ? submitReason : noneSelected ? t("catalog.noneSelected") : undefined}
      >
        {checking && <Loader strokeWidth={2.5} aria-hidden="true" className={styles.spinner} />}
        <span>{submitLabel ?? t("ui.continue")}</span>
      </Button>
    </>
  )

  if (editor) {
    return (
      <SheetFooter className={styles.footerStack}>
        {warningNotice}
        {summary}
        {declined}
        {errorNotice}
        <ActionRow className={styles.footer}>{actions}</ActionRow>
      </SheetFooter>
    )
  }

  return (
    <>
      {warningNotice}
      {summary}
      <ActionRow className={styles.footer}>{actions}</ActionRow>
      {errorNotice}
    </>
  )
}
