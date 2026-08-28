import { useState, type CSSProperties } from "react"
import { FileClock } from "lucide-react"
import { useTranslation } from "react-i18next"
import { gatewayUrl } from "@/lib/api"
import { cx } from "@/lib/cx"
import { countdownTone, useCountdown } from "@/lib/countdown"
import { formatBytes, formatCountdown, shortenMiddle } from "@/lib/format"
import type { UnpaidBagsState } from "@/lib/unpaid-bags"
import type { UserBag } from "@/types/bag"
import { ConfirmSheet } from "../confirm-sheet"
import { Notice } from "../notice"
import { TableCell, TableLead } from "../table"
import shared from "../shared.module.css"
import styles from "./unpaid-list.module.css"

interface BagRowProps {
  bag: UserBag
  index: number
  deadline: number
  busy: boolean
  copied: string | null
  onCopy: (value: string) => void
  onContinue: (bag: UserBag) => void
  onAskRemove: (bagId: string) => void
}

const BagRow = ({ bag, index, deadline, busy, copied, onCopy, onContinue, onAskRemove }: BagRowProps) => {
  const { t } = useTranslation()
  const left = useCountdown(deadline)
  const tone = countdownTone(left)

  return (
    <article style={{ "--card-index": index % 10 } as CSSProperties} className={styles.card}>
      <TableLead
        shortValue={shortenMiddle(bag.bag_id.toUpperCase(), 6, 6)}
        title={bag.bag_id}
        href={gatewayUrl(bag.bag_id)}
        copy={bag.bag_id}
        copied={copied}
        onCopy={onCopy}
      />

      <TableCell label={t("files.desc")} value={bag.description} title={bag.description || undefined} />

      <TableCell label={t("files.size")} value={formatBytes(bag.bag_size)} />

      <TableCell label={t("files.timeLeft")}>
        {tone === "over" ? (
          <span className={cx(styles.timer, styles.timerOver)}>{t("files.expired")}</span>
        ) : (
          <span className={cx(styles.timer, tone === "soon" && styles.timerSoon)}>{formatCountdown(left)}</span>
        )}
      </TableCell>

      <div className={shared.tableActions}>
        {tone !== "over" && (
          <button type="button" onClick={() => onContinue(bag)} disabled={busy} className={shared.rowPrimary}>
            {t("files.continuePayment")}
          </button>
        )}
        <button type="button" onClick={() => onAskRemove(bag.bag_id)} disabled={busy} className={shared.rowDanger}>
          {t("files.remove")}
        </button>
      </div>
    </article>
  )
}

interface UnpaidListProps {
  bags: UserBag[]
  freeStorageSeconds: number
  busy: boolean
  error: string | null
  status: number | null
  errorKind: UnpaidBagsState["errorKind"]
  copied: string | null
  onRetry: () => void
  onCopy: (value: string) => void
  onContinue: (bag: UserBag) => void
  onRemove: (bagId: string) => void
}

export const UnpaidList = ({
  bags,
  freeStorageSeconds,
  busy,
  error,
  status,
  errorKind,
  copied,
  onRetry,
  onCopy,
  onContinue,
  onRemove,
}: UnpaidListProps) => {
  const { t } = useTranslation()
  const [removing, setRemoving] = useState<string | null>(null)

  if (!bags.length && !error) return null

  return (
    <section className={styles.wrap}>
      <div className={styles.heading}>
        <h2 className={shared.tableTitle}>
          <FileClock className={shared.titleIcon} aria-hidden="true" />
          <span>{t("files.unpaidTitle")}</span>
        </h2>
      </div>
      {error && (
        <Notice
          tone="red"
          className={styles.error}
          action={
            errorKind === "load" && (
              <button type="button" onClick={onRetry}>
                {t("ui.retry")}
              </button>
            )
          }
        >
          {t(error)}
          {status !== null && <span className={shared.errorCode}>{t("errors.statusCode", { status })}</span>}
        </Notice>
      )}
      {bags.length > 0 && (
        <div className={styles.list}>
          <div className={shared.tableScroll}>
            <div className={styles.head}>
              <span className={shared.tableHeadCell}>{t("files.bagId")}</span>
              <span className={shared.tableHeadCell}>{t("files.desc")}</span>
              <span className={shared.tableHeadCell}>{t("files.size")}</span>
              <span className={shared.tableHeadCell}>{t("files.timeLeft")}</span>
              <span />
            </div>

            <div className={styles.rows}>
              {bags.map((bag, index) => (
                <BagRow
                  key={bag.bag_id}
                  bag={bag}
                  index={index}
                  deadline={bag.created_at + freeStorageSeconds}
                  busy={busy}
                  copied={copied}
                  onCopy={onCopy}
                  onContinue={onContinue}
                  onAskRemove={setRemoving}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmSheet
        open={removing !== null}
        title={t("files.removeTitle")}
        note={t("files.removeNote")}
        confirmLabel={t("files.remove")}
        onConfirm={() => {
          if (removing) onRemove(removing)
          setRemoving(null)
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  )
}
