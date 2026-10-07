import { useEffect, useMemo, useState, type ReactNode } from "react"
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
import { TableFrame, TableRows, TableScroll } from "../table"
import shared from "../shared.module.css"
import styles from "./contracts-list.module.css"

const SKELETON_ROWS = 3
const ROW_PORTION = 10
const TOOLBAR_FROM = 5
const ASC_FIRST: ContractSortField[] = ["status", "paidUntil", "checks", "address", "bagId", "desc"]

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
  const [picked, setPicked] = useState<StatusFilter[]>([])
  const [query, setQuery] = useState("")
  const [sortField, setSortField] = useState(stored.field)
  const [sortDirection, setSortDirection] = useState(stored.direction)

  useDismiss(statusOpen, () => setStatusOpen(false))

  const statuses = useMemo(() => statusCounts(contracts, nowSeconds()), [contracts])
  const options = useMemo(
    () => STATUS_FILTERS.filter((option) => statuses[option] > 0 || picked.includes(option)),
    [statuses, picked],
  )
  const filtering = picked.length > 0 || query.trim() !== ""
  const visible = useMemo(
    () =>
      visibleContracts(
        contracts,
        { statuses: picked, query, field: sortField, direction: sortDirection, hideClosed },
        nowSeconds(),
      ),
    [contracts, picked, query, sortField, sortDirection, hideClosed],
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

  const pickStatus = (option: StatusFilter) => {
    setPicked((chosen) => (chosen.includes(option) ? chosen.filter((kept) => kept !== option) : [...chosen, option]))
    setShownLimit(ROW_PORTION)
  }

  const search = (next: string) => {
    setQuery(next)
    setShownLimit(ROW_PORTION)
  }

  const reset = () => {
    setPicked([])
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

      {(contracts.length > TOOLBAR_FROM || filtering) && (
        <div className={styles.tools}>
          <SearchField
            value={query}
            onChange={search}
            placeholder={t("files.searchPlaceholder")}
            className={cx(shared.searchFieldOnPage, styles.search)}
          />
          <Menu
            labels={[t("files.statusAny"), ...STATUS_FILTERS.map((option) => t(verdictWord(option))), t("files.statuses", { count: STATUS_FILTERS.length })]}
            label={
              picked.length === 0
                ? t("files.statusAny")
                : picked.length === 1
                  ? t(verdictWord(picked[0]))
                  : t("files.statuses", { count: picked.length })
            }
            active={picked.length > 0}
            disabled={options.length === 0}
            open={statusOpen}
            onToggle={() => setStatusOpen(!statusOpen)}
          >
            {options.map((option) => (
              <MenuOption
                key={option}
                label={t(verdictWord(option))}
                count={statuses[option]}
                selected={picked.includes(option)}
                dimmed={statuses[option] === 0}
                onToggle={() => pickStatus(option)}
              />
            ))}
          </Menu>
        </div>
      )}

      {!loading && visible.length === 0 ? (
        <div className={shared.emptyState}>
          {filtering ? (
            <>
              <p>{t("files.noMatches")}</p>
              <button type="button" onClick={reset} className={cx(shared.textDanger, styles.reset)}>
                {t("ui.reset")}
              </button>
            </>
          ) : contracts.length > 0 ? (
            <>
              <p>{t("files.noActive")}</p>
              <button type="button" onClick={() => onHideClosed(false)} className={cx(shared.textAccent, styles.reset)}>
                {t("files.showClosed")}
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
          <TableScroll className={styles.scroll}>
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
              <span className={cx(shared.tableHeadCell, styles.actionsHead)}>{t("files.actions")}</span>
            </div>

            <TableFrame className={styles.frame}>
              <TableRows className={styles.rows}>
                {loading &&
                  visible.length === 0 &&
                  Array.from({ length: stored.rows || SKELETON_ROWS }, (_, index) => <SkeletonRow key={index} />)}
                {portion.map((contract, index) => {
                  const openKind =
                    editing && editing.address === contract.address && !contract.closed ? editing.kind : null

                  return (
                    <ContractRow
                      key={contract.address}
                      contract={contract}
                      index={index % ROW_PORTION}
                      openKind={openKind}
                      active={busy === contract.address}
                      busy={busy !== null}
                      copied={copied}
                      onCopy={onCopy}
                      onOpen={() => setInfoFor(contract.address)}
                      onAction={(kind) => toggleFor(contract.address, kind)}
                      onAskWithdraw={() => setWithdrawFor(contract.address)}
                    />
                  )
                })}
              </TableRows>
            </TableFrame>
          </TableScroll>

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
