import { useState, type CSSProperties, type ReactNode } from "react"
import { Check, CircleX, Loader, ScrollText, Server, Wallet } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import {
  LOW_BALANCE_DAYS,
  contractTone,
  scanUrl,
  type ContractRow as ContractRowData,
  type ContractsState,
} from "@/lib/contracts"
import { SECONDS_IN_DAY, formatBytes, formatDate, nowSeconds, shortenMiddle, tonLabel } from "@/lib/format"
import { dailyCost, paidDaysLeft, proofDelays } from "@/lib/pricing"
import { payErrorTone } from "@/lib/wizard"
import { ConfirmSheet } from "../confirm-sheet"
import { ContractDetails } from "./contract-details"
import { Hint } from "../hint"
import { IconButton } from "../icon-button"
import { Notice } from "../notice"
import { Sheet } from "../sheet"
import { GhostCopy, GhostValue, Ratio, TableCell, TableLead, activateOnKey } from "../table"
import shared from "../shared.module.css"
import styles from "./contracts-list.module.css"

const SKELETON_ROWS = 3
const ROW_PORTION = 10

export interface OpenEditor {
  address: string
  kind: "edit" | "extend"
}

export const visibleContracts = (contracts: ContractRowData[], hideClosed: boolean): ContractRowData[] =>
  contracts.filter((contract) => !(hideClosed && contract.closed))

const SKELETON_WIDTH: Record<string, string> = {
  "files.contract": "7.8em",
  "files.desc": "8.5em",
  "files.size": "3.1em",
  "files.paidUntil": "5.5em",
}

const STATUS_WORDS = {
  green: "files.statusStored",
  yellow: "status.partial",
  red: "files.statusNone",
  orange: "files.statusChecking",
  gray: "files.statusChecking",
} as const

const PILL_WORDS = ["files.statusStored", "status.partial", "files.statusNone", "files.statusChecking", "files.closed"]

const StatusPill = ({ wordKey }: { wordKey: string }) => {
  const { t } = useTranslation()

  return (
    <span className={shared.badge}>
      <span className={shared.dot} aria-hidden="true" />
      <span className={styles.pillStack}>
        <span className={shared.ellipsis}>{t(wordKey)}</span>
        <span className={styles.pillGhost} aria-hidden="true">
          {PILL_WORDS.map((key) => (
            <span key={key}>{t(key)}</span>
          ))}
        </span>
      </span>
    </span>
  )
}

const SkeletonRow = () => {
  const { t } = useTranslation()

  return (
    <div className={styles.item}>
      <article aria-hidden="true" className={styles.card}>
        <span className={shared.tableLead}>
          <GhostValue width={SKELETON_WIDTH["files.contract"]} />
          <GhostCopy />
        </span>

        <span className={styles.statusCell}>
          <span className={styles.statusGhost}>
            <StatusPill wordKey="files.statusStored" />
          </span>
        </span>

        {["files.desc", "files.size", "files.paidUntil"].map((label) => (
          <TableCell key={label} ghost label={t(label)}>
            <GhostValue width={SKELETON_WIDTH[label]} />
          </TableCell>
        ))}

        <TableCell ghost label={t("files.confirmations")}>
          <span className={cx(shared.ratio, shared.shape)}>5 / 5</span>
        </TableCell>
      </article>
    </div>
  )
}

const PaidUntil = ({ contract }: { contract: ContractRowData }) => {
  const { t, i18n } = useTranslation()
  const label = t("files.paidUntil")

  if (!contract.closed && contract.economics === undefined) {
    return (
      <TableCell label={label}>
        <GhostValue width={SKELETON_WIDTH["files.paidUntil"]} />
      </TableCell>
    )
  }

  const economics = contract.closed ? null : (contract.economics ?? null)
  const now = nowSeconds()
  const paidDays = economics
    ? paidDaysLeft(
        economics.fileSize,
        economics.ratesPerMibDay,
        economics.spans,
        economics.balance,
        proofDelays(economics.spans, economics.lastProofs, now),
      )
    : null
  if (!economics || paidDays === null) return <TableCell label={label} value="" />

  const perDay = dailyCost(economics.fileSize, economics.ratesPerMibDay)
  const title = `${t("details.balance")}: ${tonLabel(economics.balance)} · ${t("details.perDay")}: ${tonLabel(perDay, 6)}`

  return (
    <TableCell label={label}>
      <span title={title} className={cx(shared.tableValue, paidDays < LOW_BALANCE_DAYS && styles.paidLow)}>
        {formatDate(now + paidDays * SECONDS_IN_DAY, i18n.language)}
      </span>
    </TableCell>
  )
}

interface ContractRowProps {
  contract: ContractRowData
  openKind: OpenEditor["kind"] | null
  active: boolean
  busy: boolean
  copied: string | null
  onCopy: (value: string) => void
  onOpen: () => void
  onAction: (kind: OpenEditor["kind"]) => void
  onAskWithdraw: () => void
}

const ContractRow = ({ contract, openKind, active, busy, copied, onCopy, onOpen, onAction, onAskWithdraw }: ContractRowProps) => {
  const { t } = useTranslation()

  return (
    <article
      data-tone={contractTone(contract)}
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
        <StatusPill wordKey={contract.closed ? "files.closed" : STATUS_WORDS[contractTone(contract)]} />
      </span>

      <TableCell
        label={t("files.desc")}
        value={contract.description}
        title={contract.description || undefined}
      />

      <TableCell label={t("files.size")} value={formatBytes(contract.size)} />

      <PaidUntil contract={contract} />

      <TableCell label={t("files.confirmations")}>
        {contract.closed ? null : <Ratio valid={contract.valid} total={contract.total} />}
      </TableCell>

      {!contract.closed && (
        <>
          <div className={styles.actions}>
            {active ? (
              <Loader strokeWidth={2.5} aria-hidden="true" className={cx(shared.spinner, styles.actionsWait)} />
            ) : (
              <>
                <IconButton
                  size="xs"
                  label={t("files.providers")}
                  disabled={busy}
                  data-active={openKind === "edit" ? "" : undefined}
                  className={styles.action}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAction("edit")
                  }}
                >
                  <Server className={styles.actionIcon} aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="xs"
                  label={t("files.topup")}
                  disabled={busy}
                  data-active={openKind === "extend" ? "" : undefined}
                  className={styles.action}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAction("extend")
                  }}
                >
                  <Wallet className={styles.actionIcon} aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="xs"
                  danger
                  label={t("files.withdraw")}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAskWithdraw()
                  }}
                >
                  <CircleX className={styles.actionIcon} aria-hidden="true" />
                </IconButton>
              </>
            )}
          </div>

          <div className={styles.mobileActions}>
            <button
              type="button"
              disabled={busy}
              data-active={openKind === "extend" ? "" : undefined}
              className={cx(shared.rowPrimary, styles.mobileAction)}
              onClick={(event) => {
                event.stopPropagation()
                onAction("extend")
              }}
            >
              {t("files.topup")}
            </button>
            <button
              type="button"
              disabled={busy}
              data-active={openKind === "edit" ? "" : undefined}
              className={cx(shared.rowAction, styles.mobileAction)}
              onClick={(event) => {
                event.stopPropagation()
                onAction("edit")
              }}
            >
              {t("files.providers")}
            </button>
            <button
              type="button"
              disabled={busy}
              className={shared.rowDanger}
              onClick={(event) => {
                event.stopPropagation()
                onAskWithdraw()
              }}
            >
              {t("files.withdraw")}
            </button>
          </div>
        </>
      )}
    </article>
  )
}

interface ContractsListProps {
  contracts: ContractRowData[]
  loading: boolean
  error: string | null
  status: number | null
  errorKind: ContractsState["errorKind"]
  hideClosed: boolean
  hasMore: boolean
  hasUnpaid: boolean
  busy: string | null
  copied: string | null
  editing: OpenEditor | null
  renderEditor: (contract: ContractRowData, kind: OpenEditor["kind"]) => ReactNode
  onRetry: () => void
  onHideClosed: (value: boolean) => void
  onCopy: (value: string) => void
  onEditingChange: (editor: OpenEditor | null) => void
  onWithdraw: (address: string) => void
}

export const ContractsList = ({
  contracts,
  loading,
  error,
  status,
  errorKind,
  hideClosed,
  hasMore,
  hasUnpaid,
  busy,
  copied,
  editing,
  renderEditor,
  onRetry,
  onHideClosed,
  onCopy,
  onEditingChange,
  onWithdraw,
}: ContractsListProps) => {
  const { t } = useTranslation()
  const [withdrawFor, setWithdrawFor] = useState<string | null>(null)
  const [infoFor, setInfoFor] = useState<string | null>(null)
  const [shownLimit, setShownLimit] = useState(ROW_PORTION)

  const visible = visibleContracts(contracts, hideClosed)
  const portion = visible.slice(0, shownLimit)
  const infoContract = contracts.find((contract) => contract.address === infoFor) ?? null
  const editingContract = contracts.find((contract) => contract.address === editing?.address) ?? null

  const toggleFor = (address: string, kind: OpenEditor["kind"]) => {
    const same = editing !== null && editing.address === address && editing.kind === kind
    onEditingChange(same ? null : { address, kind })
  }

  return (
    <div>
      <div className={styles.heading}>
        <h2 className={shared.tableTitle}>
          <ScrollText className={shared.titleIcon} aria-hidden="true" />
          <span>{t("files.title")}</span>
        </h2>
        <span className={shared.spacer} />
        <button
          type="button"
          role="checkbox"
          aria-checked={hideClosed}
          onClick={() => onHideClosed(!hideClosed)}
          className={styles.toggle}
        >
          <span className={cx(shared.check, hideClosed && shared.checkOn)}>
            {hideClosed && <Check strokeWidth={3.5} className={shared.checkIcon} aria-hidden="true" />}
          </span>
          <span>{t("files.hideClosed")}</span>
        </button>
      </div>

      {error && (
        <Notice
          tone={payErrorTone(error)}
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

      {!loading && !hasMore && visible.length === 0 ? (
        <div className={shared.emptyState}>
          <p>{t("files.empty")}</p>
          <p className={shared.emptyHint}>{t(hasUnpaid ? "files.emptyUnpaid" : "files.emptyHint")}</p>
        </div>
      ) : (
        <div className={styles.list}>
          <div className={styles.scroll}>
            <div className={styles.head}>
              <span className={shared.tableHeadCell}>{t("files.contract")}</span>
              <span className={shared.tableHeadCell}>{t("files.status")}</span>
              <span className={shared.tableHeadCell}>{t("files.desc")}</span>
              <span className={shared.tableHeadCell}>{t("files.size")}</span>
              <span className={shared.tableHeadCell}>{t("files.paidUntil")}</span>
              <span className={shared.tableHeadCell}>
                <span>{t("files.confirmations")}</span>
                <Hint text={t("files.confirmationsHint")} />
              </span>
              <span />
            </div>

            <div className={styles.rows}>
              {loading &&
                visible.length === 0 &&
                Array.from({ length: SKELETON_ROWS }, (_, index) => <SkeletonRow key={index} />)}
              {portion.map((contract, index) => {
                const openKind =
                  editing && editing.address === contract.address && !contract.closed ? editing.kind : null

                return (
                  <div key={contract.address} style={{ "--card-index": index % 10 } as CSSProperties} className={styles.item}>
                    <ContractRow
                      contract={contract}
                      openKind={openKind}
                      active={busy === contract.address}
                      busy={busy !== null}
                      copied={copied}
                      onCopy={onCopy}
                      onOpen={() => setInfoFor(contract.address)}
                      onAction={(kind) => toggleFor(contract.address, kind)}
                      onAskWithdraw={() => setWithdrawFor(contract.address)}
                    />
                  </div>
                )
              })}

              {hasMore && portion.length >= visible.length && (
                <div aria-hidden="true" className={styles.digging}>
                  <GhostValue width="10em" />
                </div>
              )}
            </div>
          </div>

          {visible.length > portion.length && (
            <div className={styles.more}>
              {!hasMore && (
                <span role="status" className={styles.showing}>
                  {t("ui.showing", { shown: portion.length, total: visible.length })}
                </span>
              )}
              <button type="button" className={shared.secondary} onClick={() => setShownLimit((count) => count + ROW_PORTION)}>
                {t("files.showMore")}
              </button>
            </div>
          )}
        </div>
      )}

      <Sheet open={infoContract !== null} title={t("files.details")} onClose={() => setInfoFor(null)}>
        {infoContract && <ContractDetails contract={infoContract} copied={copied} onCopy={onCopy} />}
      </Sheet>

      <Sheet
        open={editing !== null && editingContract !== null}
        title={t(editing?.kind === "extend" ? "files.topupTitle" : "files.providersTitle")}
        subject={editingContract ? shortenMiddle(editingContract.address, 6, 6) : undefined}
        size={editing?.kind === "extend" ? "auto" : "full"}
        wide={editing?.kind === "edit"}
        onClose={() => onEditingChange(null)}
      >
        <div className={shared.sheetBody}>
          {editing && editingContract && renderEditor(editingContract, editing.kind)}
        </div>
      </Sheet>

      <ConfirmSheet
        open={withdrawFor !== null}
        title={t("files.withdrawTitle")}
        note={t("files.withdrawNote")}
        confirmLabel={t("files.withdraw")}
        onConfirm={() => {
          if (withdrawFor) onWithdraw(withdrawFor)
          setWithdrawFor(null)
        }}
        onClose={() => setWithdrawFor(null)}
      />
    </div>
  )
}
