import { useState, type CSSProperties } from "react"
import { FileClock } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Button,
  cx,
  DataActions,
  DataCell,
  DataHeadCell,
  DataLead,
  DataRow,
  DataTable,
  DataTableHead,
  DataTableRows,
  LoadError,
  Notice,
  SectionTitle,
} from "@myton/ui"
import { EMPTY, fmt } from "@myton/ui/domain"
import { gatewayUrl } from "@/lib/api"
import { countdownTone, useCountdown } from "@/lib/countdown"
import { formatCountdown } from "@/lib/format"
import type { UnpaidBagsState } from "@/lib/unpaid-bags"
import type { UserBag } from "@/types/bag"
import { ConfirmSheet } from "../confirm-sheet"
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
    <DataRow style={{ "--card-index": index % 10 } as CSSProperties} className={styles.card}>
      <DataLead
        value={fmt.shortKey(bag.bag_id)}
        title={bag.bag_id}
        upper
        href={gatewayUrl(bag.bag_id)}
        copy={bag.bag_id}
        copied={copied}
        onCopy={onCopy}
      />

      <DataCell label={t("files.desc")} value={bag.description || EMPTY} title={bag.description || undefined} />

      <DataCell label={t("files.size")} value={fmt.bytes(bag.bag_size)} />

      <DataCell
        label={t("files.timeLeft")}
        value={tone === "over" ? t("files.expired") : formatCountdown(left)}
        valueClassName={cx(styles.timer, tone === "over" && styles.timerOver, tone === "soon" && styles.timerSoon)}
      />

      <DataActions>
        {tone !== "over" && (
          <Button variant="primary" size="md" onClick={() => onContinue(bag)} disabled={busy}>
            {t("files.continuePayment")}
          </Button>
        )}
        <Button size="md" tone="red" onClick={() => onAskRemove(bag.bag_id)} disabled={busy}>
          {t("files.remove")}
        </Button>
      </DataActions>
    </DataRow>
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
        <SectionTitle size="lg" icon={FileClock}>
          <span>{t("files.unpaidTitle")}</span>
        </SectionTitle>
      </div>
      {error && errorKind === "load" && (
        <LoadError message={t(error)} status={status} onRetry={onRetry} className={cx(shared.listError, bags.length > 0 && shared.listErrorCompact)} />
      )}
      {error && errorKind !== "load" && (
        <Notice tone="red" className={shared.listError}>
          {t(error)}
          {status !== null && <span className={shared.errorCode}>{t("errors.statusCode", { status })}</span>}
        </Notice>
      )}
      {bags.length > 0 && (
        <DataTable framed stack columns="max-content fit-content(32ch) max-content max-content max-content">
          <DataTableHead>
            <DataHeadCell>{t("files.bagId")}</DataHeadCell>
            <DataHeadCell>{t("files.desc")}</DataHeadCell>
            <DataHeadCell>{t("files.size")}</DataHeadCell>
            <DataHeadCell>{t("files.timeLeft")}</DataHeadCell>
            <span />
          </DataTableHead>

          <DataTableRows>
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
          </DataTableRows>
        </DataTable>
      )}

      <ConfirmSheet
        open={removing !== null}
        title={t("files.removeTitle")}
        note={t("files.removeNote")}
        confirmLabel={t("files.remove")}
        onConfirm={() => {
          if (removing) onRemove(removing)
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  )
}
