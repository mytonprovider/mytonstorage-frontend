import type { CSSProperties, MouseEvent, ReactNode } from "react"
import { CircleX, Loader, Pencil, Wallet } from "lucide-react"
import { useTranslation } from "react-i18next"
import { gatewayUrl } from "@/lib/api"
import { cx } from "@/lib/cx"
import { contractStatus, contractVerdict, paymentTone, scanUrl, shownChecks, verdictWord, type ContractRow as ContractRowData, type ContractVerdict } from "@/lib/contracts"
import type { ContractSortField } from "@/lib/contracts-view"
import { MIB, SECONDS_IN_DAY, formatBytes, formatDate, nowSeconds, shortenMiddle, tonLabel } from "@/lib/format"
import { dailyCost, paidDaysLeft } from "@/lib/pricing"
import { IconButton } from "../icon-button"
import { GhostCopy, GhostIcon, GhostValue, Ratio, TableCell, TableLead, activateOnKey } from "../table"
import shared from "../shared.module.css"
import styles from "./contracts-list.module.css"

export type EditorKind = "edit" | "extend"

export const COLUMNS: { word: string; field?: ContractSortField; hint?: string }[] = [
  { word: "files.bagId", field: "bagId" },
  { word: "files.contract", field: "address" },
  { word: "files.desc", field: "desc" },
  { word: "files.size", field: "size" },
  { word: "files.status", field: "checks", hint: "files.statusHint" },
  { word: "files.paidUntil", field: "paidUntil" },
]

const WIDEST_ADDRESS = "E".repeat(48)
const WIDEST_BAG = "F".repeat(64)
const WIDEST_DESC = "archive-2026-01.tar.zst"
const WIDEST_SIZE = 999.99 * MIB
const DESC_HEAD = 17
const DESC_TAIL = 17


const useSkeletonSample = (): Record<string, string> => {
  const { i18n } = useTranslation()

  return {
    "files.contract": shortenMiddle(WIDEST_ADDRESS, 6, 6),
    "files.bagId": shortenMiddle(WIDEST_BAG, 6, 6),
    "files.desc": WIDEST_DESC,
    "files.size": formatBytes(WIDEST_SIZE),
    "files.paidUntil": formatDate(nowSeconds(), i18n.language),
  }
}

const GhostRatio = () => (
  <span aria-hidden="true" className={shared.ratio}>
    <span className={cx(shared.ratioTotal, shared.shape)}>0</span>
    <span className={shared.slash}>/</span>
    <span className={cx(shared.ratioTotal, shared.shape)}>0</span>
  </span>
)

const GhostLead = ({ sample }: { sample: string }) => (
  <span className={cx(shared.tableLead, styles.ghostLead)}>
    <GhostValue mono sample={sample} />
    <GhostCopy />
  </span>
)

const WORDED: ContractVerdict[] = ["closed", "noPeers"]

const StatusPill = ({ wordKey, tone }: { wordKey: string; tone?: string }) => {
  const { t } = useTranslation()

  return (
    <span data-tone={tone} className={shared.badge}>
      <span className={shared.dot} aria-hidden="true" />
      {t(wordKey)}
    </span>
  )
}

const StatusSlot = ({ children }: { children: ReactNode }) => (
  <span className={styles.statusStack}>
    {children}
    <span className={styles.statusGhost} aria-hidden="true">
      {WORDED.map((verdict) => (
        <StatusPill key={verdict} wordKey={verdictWord(verdict)} />
      ))}
    </span>
  </span>
)

export const SkeletonRow = () => {
  const { t } = useTranslation()
  const sample = useSkeletonSample()

  return (
    <article aria-hidden="true" className={styles.card}>
      <TableCell ghost label={t("files.bagId")} labelClassName={styles.cellLabel}>
        <GhostLead sample={sample["files.bagId"]} />
      </TableCell>

      <TableCell ghost label={t("files.contract")}>
        <GhostLead sample={sample["files.contract"]} />
      </TableCell>

      <TableCell ghost label={t("files.desc")}>
        <GhostValue vary sample={sample["files.desc"]} />
      </TableCell>

      <TableCell ghost label={t("files.size")}>
        <GhostValue sample={sample["files.size"]} />
      </TableCell>

      <TableCell ghost label={t("files.status")}>
        <StatusSlot>
          <GhostRatio />
        </StatusSlot>
      </TableCell>

      <TableCell ghost label={t("files.paidUntil")}>
        <GhostValue sample={sample["files.paidUntil"]} />
      </TableCell>

      <div className={cx(shared.tableActions, styles.actions)}>
        <GhostIcon size="sm" />
        <GhostIcon size="sm" />
        <GhostIcon size="sm" />
      </div>
    </article>
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
  index: number
  openKind: EditorKind | null
  active: boolean
  busy: boolean
  copied: string | null
  onCopy: (value: string) => void
  onOpen: () => void
  onAction: (kind: EditorKind) => void
  onAskWithdraw: () => void
}

export const ContractRow = ({ contract, index, openKind, active, busy, copied, onCopy, onOpen, onAction, onAskWithdraw }: ContractRowProps) => {
  const { t } = useTranslation()
  const sample = useSkeletonSample()
  const status = contractStatus(contract)
  const verdict = contractVerdict(contract)
  const checks = verdict !== null && !WORDED.includes(verdict) && shownChecks(contract)

  const act = (run: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    run()
  }

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`${t("files.details")} ${shortenMiddle(contract.address, 6, 6)}`}
      aria-haspopup="dialog"
      onClick={onOpen}
      onKeyDown={activateOnKey(onOpen)}
      style={{ "--card-index": index } as CSSProperties}
      className={cx(styles.card, openKind !== null && styles.cardOpen)}
    >
      <TableCell label={t("files.bagId")} labelClassName={styles.cellLabel}>
        {contract.bagId ? (
          <TableLead
            shortValue={shortenMiddle(contract.bagId, 6, 6)}
            title={contract.bagId}
            upper
            href={gatewayUrl(contract.bagId)}
            copy={contract.bagId}
            copied={copied}
            copyOnWide
            onCopy={onCopy}
          />
        ) : (
          <GhostLead sample={sample["files.bagId"]} />
        )}
      </TableCell>

      <TableCell label={t("files.contract")}>
        <TableLead
          shortValue={shortenMiddle(contract.address, 6, 6)}
          title={contract.address}
          href={scanUrl(contract.address)}
          copy={contract.address}
          copied={copied}
          copyOnWide
          onCopy={onCopy}
        />
      </TableCell>

      {contract.enriched ? (
        <TableCell label={t("files.desc")}>
          <span title={contract.description || undefined} className={cx(shared.tableValue, styles.desc)}>
            {shortenMiddle(contract.description, DESC_HEAD, DESC_TAIL)}
          </span>
        </TableCell>
      ) : (
        <TableCell label={t("files.desc")}>
          <GhostValue vary sample={sample["files.desc"]} />
        </TableCell>
      )}

      {contract.enriched || contract.size > 0 ? (
        <TableCell label={t("files.size")} value={formatBytes(contract.size)} />
      ) : (
        <TableCell label={t("files.size")}>
          <GhostValue sample={sample["files.size"]} />
        </TableCell>
      )}

      <TableCell label={t("files.status")}>
        <StatusSlot>
          {checks ? <Ratio valid={checks.valid} total={checks.total} /> : status ? <StatusPill wordKey={status.word} tone={status.tone} /> : <GhostRatio />}
        </StatusSlot>
      </TableCell>

      <PaidUntil contract={contract} />

      {!contract.closed && (
        <div className={cx(shared.tableActions, styles.actions)}>
          {active ? (
            <Loader strokeWidth={2.5} aria-hidden="true" className={cx(shared.spinner, styles.actionsWait)} />
          ) : (
            <>
              <IconButton
                size="sm"
                label={t("files.topup")}
                disabled={busy}
                data-active={openKind === "extend" ? "" : undefined}
                className={styles.opened}
                onClick={act(() => onAction("extend"))}
              >
                <Wallet className={styles.actionIcon} aria-hidden="true" />
              </IconButton>
              <IconButton
                size="sm"
                label={t("files.edit")}
                disabled={busy}
                data-active={openKind === "edit" ? "" : undefined}
                className={styles.opened}
                onClick={act(() => onAction("edit"))}
              >
                <Pencil className={styles.actionIcon} aria-hidden="true" />
              </IconButton>
              <IconButton size="sm" danger label={t("files.withdraw")} disabled={busy} onClick={act(onAskWithdraw)}>
                <CircleX className={styles.actionIcon} aria-hidden="true" />
              </IconButton>
            </>
          )}
        </div>
      )}
    </article>
  )
}
