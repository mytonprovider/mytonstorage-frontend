import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { useContractData } from "@/lib/contracts-cache"
import {
  ceilShown,
  formatDate,
  formatDuration,
  formatTon,
  GHOST_TON,
  GRAM,
  NANO,
  nowSeconds,
  SECONDS_IN_DAY,
  SHOWN_DIGITS,
  tonLabel,
} from "@/lib/format"
import {
  FEE_TOPUP,
  MIN_PROVIDER_BALANCE,
  MIN_STORAGE_DAYS,
  dailyCost,
  gridDays,
  minTopupDays,
  paidDaysLeft,
  payoutDays,
  proofDelays,
  restartBalance,
  roundDays,
  topupForDays,
} from "@/lib/pricing"
import { GridRange } from "../grid-range"
import { Notice } from "../notice"
import { SheetFooter } from "../sheet"
import { SheetField } from "../sheet-fields"
import shared from "../shared.module.css"
import styles from "./extend-form.module.css"

const DEFAULT_TARGET_DAYS = 30
const MIN_MANUAL_TON = MIN_PROVIDER_BALANCE / NANO
const MAX_MANUAL_TON = 1000

interface ExtendFormProps {
  address: string
  onSubmit: (nanotons: number) => void
}

export const ExtendForm = ({ address, onSubmit }: ExtendFormProps) => {
  const { t, i18n } = useTranslation()
  const { economics, unreadable, offline, retry } = useContractData(address)
  const [pickedDays, setPickedDays] = useState<number | null>(null)
  const [amount, setAmount] = useState("0.5")

  const perDay = economics ? dailyCost(economics.fileSize, economics.ratesPerMibDay) : 0
  const perRoundDays = economics ? roundDays(economics.spans) : 0
  const payout = economics ? payoutDays(economics.fileSize, economics.ratesPerMibDay, economics.spans) : 0
  const priced = perDay > 0 && payout > 0
  const restart = economics ? restartBalance(economics.fileSize, economics.ratesPerMibDay, economics.spans) : 0
  const missing = economics ? Math.max(0, restart - economics.balance) : 0
  const now = nowSeconds()
  const delays = economics ? proofDelays(economics.spans, economics.lastProofs, now) : []
  const stepDays = payout || perRoundDays || MIN_STORAGE_DAYS
  const floorDays = economics
    ? Math.max(MIN_STORAGE_DAYS, Math.ceil(minTopupDays(economics.fileSize, economics.ratesPerMibDay, economics.spans, economics.balance)))
    : MIN_STORAGE_DAYS
  const days = gridDays(pickedDays ?? DEFAULT_TARGET_DAYS, stepDays, floorDays)
  const topup = economics
    ? ceilShown(
        Math.max(
          topupForDays(economics.fileSize, economics.ratesPerMibDay, economics.spans, economics.balance, days, delays),
          missing,
        ),
      )
    : 0
  const cost = topup + FEE_TOPUP
  const newBalance = economics ? economics.balance + cost : 0
  const paidDays = economics
    ? paidDaysLeft(economics.fileSize, economics.ratesPerMibDay, economics.spans, economics.balance, delays)
    : null
  const newPaidDays = economics
    ? paidDaysLeft(economics.fileSize, economics.ratesPerMibDay, economics.spans, newBalance, delays)
    : null
  const addedLabel =
    paidDays === null || newPaidDays === null ? "" : formatDuration((newPaidDays - paidDays) * SECONDS_IN_DAY, t)
  const manualTon = Number(amount.replace(",", "."))
  const manualValid = Number.isFinite(manualTon) && manualTon >= MIN_MANUAL_TON && manualTon <= MAX_MANUAL_TON

  if (offline) {
    return (
      <div className={styles.form}>
        <Notice
          tone="red"
          action={
            <button type="button" onClick={retry}>
              {t("ui.retry")}
            </button>
          }
        >
          {t("files.topupOffline")}
        </Notice>
      </div>
    )
  }

  if (unreadable || (economics && !priced)) {
    return (
      <div className={styles.form}>
        <Notice tone="red">{t("files.topupUnknown")}</Notice>
        <label className={cx(styles.label, styles.field)} htmlFor="extend-amount">
          {t("files.topupAmount")}, {GRAM}
        </label>
        <input
          id="extend-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-describedby="extend-bounds"
          className={cx(shared.amount, styles.field)}
        />
        <p id="extend-bounds" className={styles.bounds}>
          {t("files.topupBounds", { min: formatTon(MIN_PROVIDER_BALANCE), max: MAX_MANUAL_TON })}
        </p>
        <SheetFooter className={shared.sheetActions}>
          <button
            type="button"
            disabled={!manualValid}
            onClick={() => onSubmit(Math.ceil(manualTon * NANO))}
            className={shared.primary}
          >
            {t("files.topup")}
          </button>
        </SheetFooter>
      </div>
    )
  }

  if (!economics) {
    return (
      <div className={styles.form}>
        <div aria-hidden="true" className={styles.ghostBody}>
          <div className={styles.total}>
            <span className={shared.shape}>{t("files.topupAddDays")}</span>
            <span className={shared.spacer} />
            <span className={cx(styles.totalValue, shared.shape)}>{formatDuration(DEFAULT_TARGET_DAYS * SECONDS_IN_DAY, t)}</span>
          </div>
          <span className={cx(styles.ghostRange, shared.ghost)} />
          <div className={styles.panel}>
            <div className={styles.fields}>
              <div className={styles.total}>
                <span className={shared.shape}>{t("period.total")}</span>
                <span className={shared.spacer} />
                <span className={cx(styles.totalValue, shared.shape)}>{tonLabel(GHOST_TON, SHOWN_DIGITS)}</span>
              </div>
              <SheetField ghost label={t("files.topupNewUntil")} value={formatDate(now, i18n.language)} />
            </div>
          </div>
        </div>
        <SheetFooter className={shared.sheetActions}>
          <button type="button" disabled className={shared.primary}>
            {t("files.topup")}
          </button>
        </SheetFooter>
      </div>
    )
  }

  return (
    <div className={styles.form}>
      <div className={styles.total}>
        <span>{t("files.topupAddDays")}</span>
        <span className={shared.spacer} />
        <span className={styles.totalValue}>{addedLabel}</span>
      </div>

      <div className={styles.range}>
        <GridRange
          label={t("files.topupAddDays")}
          stepDays={stepDays}
          floorDays={floorDays}
          days={days}
          onChange={setPickedDays}
        />
      </div>

      <div className={styles.panel}>
        <div className={styles.fields}>
          <div className={styles.total}>
            <span>{t("period.total")}</span>
            <span className={shared.spacer} />
            <span className={styles.totalValue}>{tonLabel(cost, SHOWN_DIGITS)}</span>
          </div>
          <SheetField
            label={t("files.topupNewUntil")}
            value={newPaidDays === null ? "" : formatDate(now + newPaidDays * SECONDS_IN_DAY, i18n.language)}
          />
        </div>
      </div>

      <SheetFooter className={shared.sheetActions}>
        <button type="button" onClick={() => onSubmit(cost)} className={shared.primary}>
          {t("files.topup")}
        </button>
      </SheetFooter>
    </div>
  )
}
