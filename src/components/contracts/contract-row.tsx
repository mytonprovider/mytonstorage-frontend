import type { MouseEvent } from "react"
import { Loader } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { VERDICT_WORDS, contractStatus, paymentTone, scanUrl, type ContractRow as ContractRowData } from "@/lib/contracts"
import type { ContractSortField } from "@/lib/contracts-view"
import { MIB, SECONDS_IN_DAY, formatBytes, formatDate, nowSeconds, shortenMiddle, tonLabel } from "@/lib/format"
import { dailyCost, paidDaysLeft } from "@/lib/pricing"
import { GhostCopy, GhostValue, Ratio, TableCell, TableLead, activateOnKey } from "../table"
import shared from "../shared.module.css"
import styles from "./contracts-list.module.css"

export type EditorKind = "edit" | "extend"

export const COLUMNS: { word: string; field?: ContractSortField; hint?: string }[] = [
  { word: "files.contract", field: "address" },
  { word: "files.status", field: "status" },
  { word: "files.desc", field: "desc" },
  { word: "files.size", field: "size" },
  { word: "files.paidUntil", field: "paidUntil" },
  { word: "files.confirmations", field: "checks", hint: "files.confirmationsHint" },
]

const WIDEST_ADDRESS = "E".repeat(48)
const WIDEST_DESC = "archive-2026-01.tar.zst"
const WIDEST_SIZE = 999.99 * MIB

const GHOST_CELLS = ["files.desc", "files.size", "files.paidUntil"]

const useSkeletonSample = (): Record<string, string> => {
  const { i18n } = useTranslation()

  return {
    "files.contract": shortenMiddle(WIDEST_ADDRESS, 6, 6),
    "files.desc": WIDEST_DESC,
    "files.size": formatBytes(WIDEST_SIZE),
    "files.paidUntil": formatDate(nowSeconds(), i18n.language),
  }
}

const GhostRatio = () => <span aria-hidden="true" className={cx(shared.ratio, shared.shape)} />

const StatusPill = ({ wordKey }: { wordKey: string }) => {
  const { t } = useTranslation()

  return (
    <span className={shared.badge}>
      <span className={shared.dot} aria-hidden="true" />
      <span className={styles.pillStack}>
        <span className={shared.ellipsis}>{t(wordKey)}</span>
        <span className={styles.pillGhost} aria-hidden="true">
          {VERDICT_WORDS.map((key) => (
            <span key={key}>{t(key)}</span>
          ))}
        </span>
      </span>
    </span>
  )
}

export const SkeletonRow = () => {
  const { t } = useTranslation()
  const sample = useSkeletonSample()

  return (
    <div className={styles.item}>
      <article aria-hidden="true" className={styles.card}>
        <span className={shared.tableLead}>
          <GhostValue sample={sample["files.contract"]} />
          <GhostCopy />
        </span>

        <span className={styles.statusCell}>
          <span className={styles.statusGhost}>
            <StatusPill wordKey="files.statusStored" />
          </span>
        </span>

        {GHOST_CELLS.map((label) => (
          <TableCell key={label} ghost label={t(label)}>
            <GhostValue sample={sample[label]} />
          </TableCell>
        ))}

        <TableCell ghost label={t("files.confirmations")}>
          <GhostRatio />
        </TableCell>
      </article>
    </div>
  )
}

const PaidUntil = ({ contract }: { contract: ContractRowData }) => {
  const { t, i18n } = useTranslation()
  const sample = useSkeletonSample()
  const label = t("files.paidUntil")

  if (!contract.closed && contract.state === undefined) {
    return (
      <TableCell label={label}>
        <GhostValue sample={sample["files.paidUntil"]} />
      </TableCell>
    )
  }

  const state = contract.closed ? null : (contract.state ?? null)
  const now = nowSeconds()
  const paidDays = state ? paidDaysLeft(state.fileSize, state.providers, state.balance, now) : null
  if (!state || paidDays === null) return <TableCell label={label} value="" />

  const tone = paymentTone(paidDays)
  const perDay = dailyCost(state.fileSize, state.providers)
  const title = `${t("details.balance")}: ${tonLabel(state.balance)} · ${t("details.perDay")}: ${tonLabel(perDay, 6)}`

  return (
    <TableCell label={label}>
      <span title={title} className={cx(shared.tableValue, tone === "red" && styles.paidOut, tone === "yellow" && styles.paidLow)}>
        {formatDate(now + paidDays * SECONDS_IN_DAY, i18n.language)}
      </span>
    </TableCell>
  )
}

interface ContractRowProps {
  contract: ContractRowData
  openKind: EditorKind | null
  active: boolean
  busy: boolean
  copied: string | null
  onCopy: (value: string) => void
  onOpen: () => void
  onAction: (kind: EditorKind) => void
  onAskWithdraw: () => void
}

export const ContractRow = ({ contract, openKind, active, busy, copied, onCopy, onOpen, onAction, onAskWithdraw }: ContractRowProps) => {
  const { t } = useTranslation()
  const sample = useSkeletonSample()
  const status = contractStatus(contract, nowSeconds())

  const act = (run: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    run()
  }

  return (
    <article
      data-tone={status?.tone}
      role="button"
      tabIndex={0}
      aria-label={`${t("files.details")} ${shortenMiddle(contract.address, 6, 6)}`}
      aria-haspopup="dialog"
      onClick={onOpen}
      onKeyDown={activateOnKey(onOpen)}
      className={cx(styles.card, openKind !== null && styles.cardOpen)}
    >
      <TableLead
        shortValue={shortenMiddle(contract.address, 6, 6)}
        title={contract.address}
        href={scanUrl(contract.address)}
        copy={contract.address}
        copied={copied}
        onCopy={onCopy}
      />

      <span className={styles.statusCell}>
        {status ? (
          <StatusPill wordKey={status.word} />
        ) : (
          <span className={styles.statusGhost}>
            <StatusPill wordKey="files.statusStored" />
          </span>
        )}
      </span>

      {contract.enriched ? (
        <TableCell label={t("files.desc")} value={contract.description} title={contract.description || undefined} />
      ) : (
        <TableCell ghost label={t("files.desc")}>
          <GhostValue sample={sample["files.desc"]} />
        </TableCell>
      )}

      {contract.enriched || contract.size > 0 ? (
        <TableCell label={t("files.size")} value={formatBytes(contract.size)} />
      ) : (
        <TableCell ghost label={t("files.size")}>
          <GhostValue sample={sample["files.size"]} />
        </TableCell>
      )}

      <PaidUntil contract={contract} />

      <TableCell label={t("files.confirmations")}>
        {contract.closed ? null : contract.pending === undefined ? (
          <GhostRatio />
        ) : (
          <Ratio valid={contract.valid} total={contract.total} />
        )}
      </TableCell>

      {!contract.closed && (
        <div className={cx(shared.tableActions, styles.actions)}>
          {active ? (
            <Loader strokeWidth={2.5} aria-hidden="true" className={cx(shared.spinner, styles.actionsWait)} />
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                data-active={openKind === "extend" ? "" : undefined}
                className={cx(shared.rowAction, styles.opened)}
                onClick={act(() => onAction("extend"))}
              >
                {t("files.topup")}
              </button>
              <button
                type="button"
                disabled={busy}
                data-active={openKind === "edit" ? "" : undefined}
                className={cx(shared.rowAction, styles.opened)}
                onClick={act(() => onAction("edit"))}
              >
                {t("files.edit")}
              </button>
              <button type="button" disabled={busy} className={shared.rowDanger} onClick={act(onAskWithdraw)}>
                {t("files.withdraw")}
              </button>
            </>
          )}
        </div>
      )}
    </article>
  )
}
