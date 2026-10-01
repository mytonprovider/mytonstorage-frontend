import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { Check, RefreshCw, ScrollText } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { verdictWord, type ContractRow as ContractRowData, type ContractsState } from "@/lib/contracts"
import {
  STATUS_FILTERS,
  isSortField,
  statusCounts,
  visibleContracts,
  type ContractSortField,
  type SortDirection,
  type StatusFilter,
} from "@/lib/contracts-view"
import { nowSeconds, shortenMiddle } from "@/lib/format"
import { readListView, writeListView } from "@/lib/local-storage"
import { payErrorTone } from "@/lib/errors"
import { useDismiss } from "@/lib/dismiss"
import { COLUMNS, ContractRow, SkeletonRow, type EditorKind } from "./contract-row"
import { ConfirmSheet } from "../confirm-sheet"
import { ContractDetails } from "./contract-details"
import { Menu, MenuOption } from "../menu"
import { Notice } from "../notice"
import { SearchField } from "../search-field"
import { Sheet } from "../sheet"
import { SortColumn } from "../sort-column"
import shared from "../shared.module.css"
import styles from "./contracts-list.module.css"

const SKELETON_ROWS = 3
const ROW_PORTION = 10
const ASC_FIRST: ContractSortField[] = ["status", "paidUntil", "checks", "address", "desc"]

const storedView = (): { rows: number; field: ContractSortField; direction: SortDirection } => {
  const { shown, sort, dir } = readListView()

  return {
    rows: shown > 0 ? Math.ceil(shown / ROW_PORTION) * ROW_PORTION : 0,
    field: isSortField(sort) ? sort : "createdAt",
    direction: dir === "asc" ? "asc" : "desc",
  }
}

export interface OpenEditor {
  address: string
  kind: EditorKind
}

interface ContractsListProps {
  contracts: ContractRowData[]
  loading: boolean
  error: string | null
  status: number | null
  errorKind: ContractsState["errorKind"]
  hideClosed: boolean
  hasUnpaid: boolean
  busy: string | null
  copied: string | null
  editing: OpenEditor | null
  renderEditor: (contract: ContractRowData, kind: OpenEditor["kind"]) => ReactNode
  onRetry: () => void
  onRefresh: () => void
  refreshing: boolean
  onShown: (addresses: string[]) => void
  onRenotify: () => void
  notifyStatus: ContractsState["notifyStatus"]
  onNotify: (contract: string, providers: string[]) => void
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
  hasUnpaid,
  busy,
  copied,
  editing,
  renderEditor,
  onRetry,
  onRefresh,
  refreshing,
  onShown,
  onRenotify,
  notifyStatus,
  onNotify,
  onHideClosed,
  onCopy,
  onEditingChange,
  onWithdraw,
}: ContractsListProps) => {
  const { t } = useTranslation()
  const [withdrawFor, setWithdrawFor] = useState<string | null>(null)
  const [infoFor, setInfoFor] = useState<string | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [stored] = useState(storedView)
  const [shownLimit, setShownLimit] = useState(stored.rows || ROW_PORTION)
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null)
  const [query, setQuery] = useState("")
  const [sortField, setSortField] = useState(stored.field)
  const [sortDirection, setSortDirection] = useState(stored.direction)

  useDismiss(statusOpen, () => setStatusOpen(false))

  const statuses = useMemo(() => statusCounts(contracts, nowSeconds()), [contracts])
  const visible = useMemo(
    () =>
      visibleContracts(
        contracts,
        { status: statusFilter, query, field: sortField, direction: sortDirection, hideClosed },
        nowSeconds(),
      ),
    [contracts, statusFilter, query, sortField, sortDirection, hideClosed],
  )
  const portion = visible.slice(0, shownLimit)

  useEffect(() => {
    if (portion.length > 0) writeListView({ shown: portion.length })
  }, [portion.length])

  const shownKey = portion.map((contract) => contract.address).join(" ")
  useEffect(() => {
    onShown(shownKey ? shownKey.split(" ") : [])
  }, [shownKey, onShown])

  const infoContract = contracts.find((contract) => contract.address === infoFor) ?? null
  const editingContract = contracts.find((contract) => contract.address === editing?.address) ?? null

  const pickStatus = (next: StatusFilter | null) => {
    setStatusFilter(next)
    setShownLimit(ROW_PORTION)
    setStatusOpen(false)
  }

  const search = (next: string) => {
    setQuery(next)
    setShownLimit(ROW_PORTION)
  }

  const reset = () => {
    setStatusFilter(null)
    setQuery("")
    setShownLimit(ROW_PORTION)
  }

  const orderBy = (field: ContractSortField, direction: SortDirection) => {
    setSortField(field)
    setSortDirection(direction)
    setShownLimit(ROW_PORTION)
    writeListView({ sort: field, dir: direction })
  }

  const sort = (field: ContractSortField) => {
    const first: SortDirection = ASC_FIRST.includes(field) ? "asc" : "desc"
    if (sortField !== field) return orderBy(field, first)
    if (sortDirection === first) return orderBy(field, first === "asc" ? "desc" : "asc")
    orderBy("createdAt", "desc")
  }

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
        <div className={styles.headActions}>
          <button type="button" disabled={refreshing} onClick={onRefresh} className={styles.toggle}>
            <RefreshCw aria-hidden="true" className={cx(styles.refreshIcon, refreshing && shared.spinner)} />
            <span>{t("files.refresh")}</span>
          </button>
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
      </div>

      {error && (
        <Notice
          tone={payErrorTone(error)}
          className={styles.error}
          action={
            errorKind === "load" ? (
              <button type="button" onClick={onRetry}>
                {t("ui.retry")}
              </button>
            ) : (
              errorKind === "notify" && (
                <button type="button" onClick={onRenotify}>
                  {t("files.notifyAgain")}
                </button>
              )
            )
          }
        >
          {t(error)}
          {status !== null && <span className={shared.errorCode}>{t("errors.statusCode", { status })}</span>}
        </Notice>
      )}

      {(contracts.length > ROW_PORTION || statusFilter !== null || query.trim() !== "") && (
        <div className={styles.tools}>
          <SearchField
            value={query}
            onChange={search}
            placeholder={t("files.searchPlaceholder")}
            className={cx(shared.searchFieldOnPage, styles.search)}
          />
          <Menu
            label={statusFilter === null ? t("files.statusAny") : t(verdictWord(statusFilter))}
            active={statusFilter !== null}
            open={statusOpen}
            onToggle={() => setStatusOpen(!statusOpen)}
          >
            {STATUS_FILTERS.map((option) => (
              <MenuOption
                key={option}
                label={t(verdictWord(option))}
                count={statuses[option]}
                selected={statusFilter === option}
                dimmed={statuses[option] === 0 && statusFilter !== option}
                onToggle={() => pickStatus(statusFilter === option ? null : option)}
              />
            ))}
          </Menu>
        </div>
      )}

      {!loading && visible.length === 0 ? (
        <div className={shared.emptyState}>
          {statusFilter !== null || query.trim() !== "" ? (
            <>
              <p>{t("files.noMatches")}</p>
              <button type="button" onClick={reset} className={cx(shared.textDanger, styles.reset)}>
                {t("ui.reset")}
              </button>
            </>
          ) : (
            <>
              <p>{t("files.empty")}</p>
              <p className={shared.emptyHint}>{t(hasUnpaid ? "files.emptyUnpaid" : "files.emptyHint")}</p>
            </>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          <div className={styles.scroll}>
            <div className={styles.head}>
              {COLUMNS.map(({ word, field, hint }) => (
                <SortColumn
                  key={word}
                  label={t(word)}
                  hint={hint && t(hint)}
                  active={field !== undefined && sortField === field}
                  direction={sortDirection}
                  onSort={field && (() => sort(field))}
                />
              ))}
              <span />
            </div>

            <div className={styles.rows}>
              {loading &&
                visible.length === 0 &&
                Array.from({ length: stored.rows || SKELETON_ROWS }, (_, index) => <SkeletonRow key={index} />)}
              {portion.map((contract, index) => {
                const openKind =
                  editing && editing.address === contract.address && !contract.closed ? editing.kind : null

                return (
                  <div key={contract.address} style={{ "--card-index": index % ROW_PORTION } as CSSProperties} className={styles.item}>
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
            </div>
          </div>

          {visible.length > portion.length && (
            <div className={styles.more}>
              <span role="status" className={styles.showing}>
                {t("ui.showing", { shown: portion.length, total: visible.length })}
              </span>
              <button type="button" className={shared.secondary} onClick={() => setShownLimit((count) => count + ROW_PORTION)}>
                {t("files.showMore")}
              </button>
            </div>
          )}
        </div>
      )}

      <Sheet open={infoContract !== null} title={t("files.details")} onClose={() => setInfoFor(null)}>
        {infoContract && (
          <ContractDetails
            contract={infoContract}
            copied={copied}
            onCopy={onCopy}
            notifyState={notifyStatus?.contract === infoContract.address ? notifyStatus.state : null}
            onNotify={(providers) => onNotify(infoContract.address, providers)}
          />
        )}
      </Sheet>

      <Sheet
        open={editing !== null && editingContract !== null}
        title={t(editing?.kind === "extend" ? "files.topupTitle" : "files.editTitle")}
        subject={editingContract ? shortenMiddle(editingContract.address, 6, 6) : undefined}
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
        subject={withdrawFor ? shortenMiddle(withdrawFor, 6, 6) : undefined}
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
