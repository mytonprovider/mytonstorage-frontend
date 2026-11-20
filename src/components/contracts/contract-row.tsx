import type { CSSProperties, ReactNode } from "react"
import { CircleX, Loader, Pencil, TriangleAlert, Wallet } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge, CheckRatio, cx, DataActions, DataCell, DataLead, DataRow, GhostIcon, GhostValue, glyphClass, IconButton } from "@myton/ui"
import { DAY, EMPTY, explorerUrl, fmt, type StatusTone } from "@myton/ui/domain"
import { gatewayUrl } from "@/lib/api"
import { checksTone } from "@/lib/check-label"
import { contractProblem, contractStatus, paymentTone, shownChecks, silentProviders, verdictWord, type ContractRow as ContractRowData, type ContractVerdict } from "@/lib/contracts"
import type { ContractSortField } from "@/lib/contracts-view"
import { MIB, formatDate, nowSeconds, tonLabel } from "@/lib/format"
import { dailyCost, paidDaysLeft, payoutDays } from "@/lib/pricing"
import shared from "../shared.module.css"
import styles from "./contracts-list.module.css"

export type EditorKind = "edit" | "extend" | "fix"

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
    "files.contract": fmt.shortKey(WIDEST_ADDRESS),
    "files.bagId": fmt.shortKey(WIDEST_BAG),
    "files.desc": WIDEST_DESC,
    "files.size": fmt.bytes(WIDEST_SIZE),
    "files.paidUntil": formatDate(nowSeconds(), i18n.language),
  }
}

const GhostRatio = () => <CheckRatio passed={0} total={0} tone="gray" loading />

const GhostLead = ({ sample }: { sample: string }) => (
  <span className={cx(shared.tableLead, styles.ghostLead)}>
    <GhostValue sample={sample} className={shared.tableMono} />
    <GhostIcon />
  </span>
)

const WORDED: ContractVerdict[] = ["closed", "noPeers"]

const StatusPill = ({ wordKey, tone }: { wordKey: string; tone: StatusTone }) => {
  const { t } = useTranslation()

  return (
    <Badge tone={tone} size="sm" dot>
      {t(wordKey)}
    </Badge>
  )
}

const StatusSlot = ({ children }: { children: ReactNode }) => (
  <span className={styles.statusStack}>
    {children}
    <span className={styles.statusGhost} aria-hidden="true">
      {WORDED.map((verdict) => (
        <StatusPill key={verdict} wordKey={verdictWord(verdict)} tone="gray" />
      ))}
    </span>
  </span>
)

export const SkeletonRow = () => {
  const { t } = useTranslation()
  const sample = useSkeletonSample()

  return (
    <DataRow ghost className={styles.card}>
      <DataCell ghost lead label={t("files.bagId")}>
        <GhostLead sample={sample["files.bagId"]} />
      </DataCell>

      <DataCell ghost label={t("files.contract")}>
        <GhostLead sample={sample["files.contract"]} />
      </DataCell>

      <DataCell ghost label={t("files.desc")}>
        <GhostValue vary sample={sample["files.desc"]} />
      </DataCell>

      <DataCell ghost label={t("files.size")}>
        <GhostValue sample={sample["files.size"]} />
      </DataCell>

      <DataCell ghost label={t("files.status")}>
        <StatusSlot>
          <GhostRatio />
        </StatusSlot>
      </DataCell>

      <DataCell ghost label={t("files.paidUntil")}>
        <GhostValue sample={sample["files.paidUntil"]} />
      </DataCell>

      <DataActions fill className={styles.actions}>
        <GhostIcon size="sm" />
        <GhostIcon size="sm" />
        <GhostIcon size="sm" />
      </DataActions>
    </DataRow>
  )
}

const PaidUntil = ({ contract }: { contract: ContractRowData }) => {
  const { t, i18n } = useTranslation()
  const sample = useSkeletonSample()
  const label = t("files.paidUntil")

  if (!contract.closed && contract.state === undefined) {
    return (
      <DataCell label={label}>
        <GhostValue sample={sample["files.paidUntil"]} />
      </DataCell>
    )
  }

  const state = contract.closed ? null : (contract.state ?? null)
  const now = nowSeconds()
  const paidDays = state ? paidDaysLeft(state.fileSize, state.providers, state.balance, now) : null
  if (!state || paidDays === null) return <DataCell label={label} value={EMPTY} />

  const tone = paymentTone(paidDays, payoutDays(state.fileSize, state.providers))
  const perDay = dailyCost(state.fileSize, state.providers)
  const title = `${t("details.balance")}: ${tonLabel(state.balance)} · ${t("details.perDay")}: ${tonLabel(perDay, 6)}`

  return (
    <DataCell
      label={label}
      value={formatDate(now + paidDays * DAY, i18n.language)}
      title={title}
      valueClassName={cx(tone === "red" && styles.paidOut, tone === "yellow" && styles.paidLow)}
    />
  )
}

interface ContractRowProps {
  contract: ContractRowData
  index: number
  openKind: EditorKind | null
  active: boolean
  busy: boolean
  copied: string | null
  viewed: boolean
  onCopy: (value: string) => void
  onOpen: () => void
  onAction: (kind: EditorKind) => void
  onAskWithdraw: () => void
}

export const ContractRow = ({ contract, index, openKind, active, busy, copied, viewed, onCopy, onOpen, onAction, onAskWithdraw }: ContractRowProps) => {
  const { t, i18n } = useTranslation()
  const sample = useSkeletonSample()
  const status = contractStatus(contract)
  const checks = shownChecks(contract)
  const ratio = !contract.closed && checks !== null && checks.ran > 0 ? checks : null
  const now = nowSeconds()
  const problem = contractProblem(contract, now)

  const problemLabel = (): string => {
    const state = contract.state
    if (problem === "lost" || !state) return t(state?.providers.length === 0 ? "fix.emptyNote" : "fix.lostNote")
    if (problem === "replace") return t("fix.summary", { count: silentProviders(contract, now).length, total: state.providers.length })
    const paidDays = paidDaysLeft(state.fileSize, state.providers, state.balance, now) ?? 0
    return t(paidDays > 0 ? "fix.balanceLow" : "fix.balanceOut", { date: formatDate(now + paidDays * DAY, i18n.language) })
  }

  const statusMark = ratio ? (
    <CheckRatio passed={ratio.valid} total={ratio.total} tone={checksTone(ratio.valid, ratio.total)} />
  ) : status ? (
    <StatusPill wordKey={status.word} tone={status.tone} />
  ) : (
    <GhostRatio />
  )

  return (
    <DataRow
      onOpen={onOpen}
      label={`${t("files.details")} ${fmt.shortKey(contract.address)}`}
      viewed={viewed}
      style={{ "--card-index": index } as CSSProperties}
      className={cx(styles.card, openKind !== null && styles.cardOpen)}
    >
      <DataCell lead label={t("files.bagId")}>
        {contract.bagId ? (
          <DataLead
            value={fmt.shortKey(contract.bagId)}
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
      </DataCell>

      <DataCell label={t("files.contract")}>
        <DataLead
          value={fmt.shortKey(contract.address)}
          title={contract.address}
          href={explorerUrl(contract.address)}
          copy={contract.address}
          copied={copied}
          copyOnWide
          onCopy={onCopy}
        />
      </DataCell>

      {contract.enriched ? (
        <DataCell
          label={t("files.desc")}
          value={fmt.shortenMiddle(contract.description, DESC_HEAD, DESC_TAIL)}
          title={contract.description || undefined}
          valueClassName={styles.desc}
        />
      ) : (
        <DataCell label={t("files.desc")}>
          <GhostValue vary sample={sample["files.desc"]} />
        </DataCell>
      )}

      {contract.enriched || contract.size > 0 ? (
        <DataCell label={t("files.size")} value={fmt.bytes(contract.size)} />
      ) : (
        <DataCell label={t("files.size")}>
          <GhostValue sample={sample["files.size"]} />
        </DataCell>
      )}

      <DataCell label={t("files.status")}>
        <StatusSlot>{statusMark}</StatusSlot>
      </DataCell>

      <PaidUntil contract={contract} />

      {!contract.closed && (
        <DataActions fill className={styles.actions}>
          {active ? (
            <Loader strokeWidth={2.5} aria-hidden="true" className={cx(shared.spinner, styles.actionsWait)} />
          ) : (
            <>
              {problem && (
                <IconButton
                  size="sm"
                  tone="yellow"
                  data-problem={problem}
                  label={problemLabel()}
                  disabled={busy}
                  pressed={(problem === "replace" && openKind === "fix") || (problem === "balance" && openKind === "extend")}
                  onClick={problem === "lost" ? onAskWithdraw : () => onAction(problem === "balance" ? "extend" : "fix")}
                >
                  <TriangleAlert className={glyphClass("sm")} aria-hidden="true" />
                </IconButton>
              )}
              <IconButton
                size="sm"
                label={t("files.topup")}
                disabled={busy}
                pressed={openKind === "extend"}
                onClick={() => onAction("extend")}
              >
                <Wallet className={glyphClass("sm")} aria-hidden="true" />
              </IconButton>
              <IconButton
                size="sm"
                label={t("files.edit")}
                disabled={busy}
                pressed={openKind === "edit"}
                onClick={() => onAction("edit")}
              >
                <Pencil className={glyphClass("sm")} aria-hidden="true" />
              </IconButton>
              <IconButton size="sm" tone="red" label={t("files.withdraw")} disabled={busy} onClick={onAskWithdraw}>
                <CircleX className={glyphClass("sm")} aria-hidden="true" />
              </IconButton>
            </>
          )}
        </DataActions>
      )}
    </DataRow>
  )
}
