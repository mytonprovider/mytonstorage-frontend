import { Hourglass, Loader } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ActionRow, Button, Card, FieldList, Notice, SectionTitle } from "@myton/ui"
import { DAY } from "@myton/ui/domain"
import { pickLang } from "@myton/ui/i18n"
import { formatDate, formatDuration, nowSeconds, SHOWN_DIGITS, tonLabel } from "@/lib/format"
import {
  gridDays,
  gridFloor,
  MIN_STORAGE_DAYS,
  paidRounds,
  proofPayments,
  roundQuote,
  storageCost,
} from "@/lib/pricing"
import { payErrorTone } from "@/lib/errors"
import type { ProviderOffer } from "@/types/bag"
import { GridRange } from "../grid-range"
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
  const lang = pickLang(i18n.language)

  const minDays = gridFloor(proofDays)
  const shownDays = gridDays(days, proofDays)
  const stepLabel = formatDuration(shownDays * DAY, lang)
  const now = nowSeconds()

  const proofSum = roundQuote(offers)
  const cost = storageCost(offers, shownDays, proofDays)
  const rounds = proofPayments(shownDays, proofDays)
  const paidUntil = now + paidRounds(cost, proofSum, rounds) * proofDays * DAY

  return (
    <div className={styles.step}>
      <div className={styles.heading}>
        <SectionTitle size="lg" icon={Hourglass}>
          <span>{t("steps.period")}</span>
        </SectionTitle>
        <span className={shared.spacer} />
        <span className={styles.value}>{stepLabel}</span>
      </div>

      <Card frame className={styles.box}>
        <GridRange label={t("steps.period")} stepDays={proofDays} days={shownDays} onChange={onDays} />

        {minDays > MIN_STORAGE_DAYS && <p className={styles.note}>{t("period.floorNote", { days: minDays })}</p>}

        <div className={styles.divider} />

        <FieldList>
          <div className={styles.total}>
            <span>{t("period.total")}</span>
            <span className={shared.spacer} />
            <span className={styles.totalValue}>
              {tonLabel(cost, SHOWN_DIGITS)}
            </span>
          </div>
          <SheetField label={t("files.topupNewUntil")} value={formatDate(paidUntil, i18n.language)} />
        </FieldList>
      </Card>

      <ActionRow className={styles.footer}>
        <Button size="xl" onClick={onBack}>
          {t("ui:ui.back")}
        </Button>
        <Button variant="primary" size="xl" onClick={onSend} disabled={sending || submitDisabled}>
          {sending && <Loader strokeWidth={2.5} aria-hidden="true" className={styles.spinner} />}
          <span>{t(sent ? "ui.continue" : "period.send")}</span>
        </Button>
      </ActionRow>

      {error && (
        <Notice tone={payErrorTone(error)} className={styles.error}>
          {t(error)}
        </Notice>
      )}
    </div>
  )
}
