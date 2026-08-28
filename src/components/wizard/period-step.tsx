import { Hourglass, Loader, Wallet } from "lucide-react"
import { useTranslation } from "react-i18next"
import { formatDate, formatDuration, nowSeconds, SECONDS_IN_DAY, SHOWN_DIGITS, tonLabel } from "@/lib/format"
import {
  gridDays,
  gridFloor,
  MIN_STORAGE_DAYS,
  paidRounds,
  proofPayments,
  roundQuote,
  storageCost,
} from "@/lib/pricing"
import { payErrorTone } from "@/lib/wizard"
import type { ProviderOffer } from "@/types/bag"
import { GridRange } from "../grid-range"
import { Notice } from "../notice"
import { SheetField } from "../sheet-fields"
import shared from "../shared.module.css"
import styles from "./period-step.module.css"

interface PeriodStepProps {
  days: number
  proofDays: number
  offers: ProviderOffer[]
  sending: boolean
  sent: boolean
  submitDisabled: boolean
  error: string | null
  onDays: (days: number) => void
  onBack: () => void
  onSend: () => void
}

export const PeriodStep = ({
  days,
  proofDays,
  offers,
  sending,
  sent,
  submitDisabled,
  error,
  onDays,
  onBack,
  onSend,
}: PeriodStepProps) => {
  const { t, i18n } = useTranslation()

  const minDays = gridFloor(proofDays)
  const shownDays = gridDays(days, proofDays)
  const stepLabel = formatDuration(shownDays * SECONDS_IN_DAY, t)
  const now = nowSeconds()

  const proofSum = roundQuote(offers)
  const cost = storageCost(offers, shownDays, proofDays)
  const rounds = proofPayments(shownDays, proofDays)
  const paidUntil = now + paidRounds(cost, proofSum, rounds) * proofDays * SECONDS_IN_DAY

  return (
    <div className={styles.step}>
      <div className={styles.heading}>
        <h2 className={shared.tableTitle}>
          <Hourglass className={shared.titleIcon} aria-hidden="true" />
          <span>{t("steps.period")}</span>
        </h2>
        <span className={shared.spacer} />
        <span className={styles.value}>{stepLabel}</span>
      </div>

      <div className={styles.box}>
        <GridRange label={t("steps.period")} stepDays={proofDays} days={shownDays} onChange={onDays} />

        {minDays > MIN_STORAGE_DAYS && <p className={styles.note}>{t("period.floorNote", { days: minDays })}</p>}
      </div>

      <div className={styles.payHeading}>
        <h2 className={shared.tableTitle}>
          <Wallet className={shared.titleIcon} aria-hidden="true" />
          <span>{t("details.payment")}</span>
        </h2>
      </div>

      <div className={styles.box}>
        <div className={styles.fields}>
          <div className={styles.total}>
            <span>{t("period.total")}</span>
            <span className={shared.spacer} />
            <span className={styles.totalValue}>
              {tonLabel(cost, SHOWN_DIGITS)}
            </span>
          </div>
          <SheetField label={t("files.paidUntil")} value={formatDate(paidUntil, i18n.language)} />
          <p className={styles.fieldNote}>{t("period.payNote")}</p>
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" onClick={onBack} className={shared.secondary}>
          {t("ui.back")}
        </button>
        <button type="button" onClick={onSend} disabled={sending || submitDisabled} className={shared.primary}>
          {sending && <Loader strokeWidth={2.5} aria-hidden="true" className={styles.spinner} />}
          <span>{t(sent ? "ui.continue" : "period.send")}</span>
        </button>
      </div>

      {error && (
        <Notice tone={payErrorTone(error)} className={styles.error}>
          {t(error)}
        </Notice>
      )}
    </div>
  )
}
