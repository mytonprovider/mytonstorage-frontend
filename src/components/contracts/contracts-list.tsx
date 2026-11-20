import { useEffect, useMemo, useState, type ReactNode } from "react"
import { RefreshCw, ScrollText } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Button,
  Card,
  cx,
  FieldList,
  CheckMark,
  DataHeadCell,
  DataTable,
  DataTableHead,
  DataTableRows,
  EmptyState,
  FilterOption,
  LoadError,
  Notice,
  SearchField,
  SectionTitle,
  Sheet,
  ShowMore,
  SortColumn,
} from "@myton/ui"
import { fmt } from "@myton/ui/domain"
import { contractProblem, verdictWord, type ContractRow as ContractRowData, type ContractsState } from "@/lib/contracts"
import {
  STATUS_FILTERS,
  isSortField,
  statusCounts,
  visibleContracts,
  type ContractSortField,
  type SortDirection,
  type StatusFilter,
} from "@/lib/contracts-view"
import { nowSeconds, tonLabel } from "@/lib/format"
import { readListView, writeListView } from "@/lib/local-storage"
import { payErrorTone } from "@/lib/errors"
import { COLUMNS, ContractRow, SkeletonRow, type EditorKind } from "./contract-row"
import { ConfirmSheet } from "../confirm-sheet"
import { ContractDetails } from "./contract-details"
import { Menu } from "../menu"
import shared from "../shared.module.css"
import styles from "./contracts-list.module.css"

const SKELETON_ROWS = 3
const ROW_PORTION = 10
const TOOLBAR_FROM = 5
const ASC_FIRST: ContractSortField[] = ["paidUntil", "checks", "address", "bagId", "desc"]

const storedView = (): { rows: number; field: ContractSortField; direction: SortDirection } => {
  const { shown, sort, dir } = readListView()
  const known = isSortField(sort)

  return {
    rows: shown > 0 ? Math.ceil(shown / ROW_PORTION) * ROW_PORTION : 0,
    field: known ? sort : "createdAt",
    direction: known && dir === "asc" ? "asc" : "desc",
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
  onOpenProvider: (pubkey: string) => void
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
  onOpenProvider,
  onEditingChange,
  onWithdraw,
}: ContractsListProps) => {
  const { t } = useTranslation()
  const [withdrawFor, setWithdrawFor] = useState<string | null>(null)
  const [infoFor, setInfoFor] = useState<string | null>(null)
  const [viewedFor, setViewedFor] = useState<string | null>(null)
  const openInfo = (address: string) => {
    setViewedFor(address)
    setInfoFor(address)
  }
  const [statusOpen, setStatusOpen] = useState(false)
  const [stored] = useState(storedView)
  const [shownLimit, setShownLimit] = useState(stored.rows || ROW_PORTION)
  const [picked, setPicked] = useState<StatusFilter[]>([])
  const [query, setQuery] = useState("")
  const [sortField, setSortField] = useState(stored.field)
  const [sortDirection, setSortDirection] = useState(stored.direction)

  const statuses = useMemo(() => statusCounts(contracts), [contracts])
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
  // A first load that failed has no list to call empty; the error stands in its place
  const unread = errorKind === "load" && contracts.length === 0

  useEffect(() => {
    if (portion.length > 0) writeListView({ shown: portion.length })
  }, [portion.length])

  const shownKey = portion.map((contract) => contract.address).join(" ")
  useEffect(() => {
    onShown(shownKey ? shownKey.split(" ") : [])
  }, [shownKey, onShown])

  const infoContract = contracts.find((contract) => contract.address === infoFor) ?? null
  const editingContract = contracts.find((contract) => contract.address === editing?.address) ?? null
  const withdrawContract = contracts.find((contract) => contract.address === withdrawFor) ?? null
  const withdrawLost = withdrawContract !== null && contractProblem(withdrawContract, nowSeconds()) === "lost"
  const withdrawAlert = withdrawContract?.state?.providers.length === 0 ? "fix.emptyNote" : "fix.lostNote"
  const statusLabels = [
    t("files.statusAny"),
    ...STATUS_FILTERS.map((option) => t(verdictWord(option))),
    t("files.statuses", { count: STATUS_FILTERS.length }),
  ]
  const editorTitle = { extend: "files.topupTitle", edit: "files.editTitle", fix: "fix.titleReplace" }

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
        <SectionTitle size="lg" icon={ScrollText}>
          <span>{t("files.title")}</span>
        </SectionTitle>
        <span className={shared.spacer} />
        <div className={styles.headActions}>
          <Button variant="text" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw aria-hidden="true" className={cx(styles.refreshIcon, refreshing && shared.spinner)} />
            <span>{t("files.refresh")}</span>
          </Button>
          <Button variant="text" role="checkbox" aria-checked={hideClosed} onClick={() => onHideClosed(!hideClosed)}>
            <CheckMark checked={hideClosed} />
            <span>{t("files.hideClosed")}</span>
          </Button>
        </div>
      </div>

      {error && errorKind === "load" && (
        <LoadError message={t(error)} status={status} onRetry={onRetry} className={cx(shared.listError, contracts.length > 0 && shared.listErrorCompact)} />
      )}
      {error && errorKind !== "load" && (
        <Notice tone={payErrorTone(error)} className={shared.listError}>
          {t(error)}
          {status !== null && <span className={shared.errorCode}>{t("errors.statusCode", { status })}</span>}
        </Notice>
      )}

      {(contracts.length > TOOLBAR_FROM || filtering) && (
        <div className={styles.tools}>
          <SearchField
            value={query}
            onChange={search}
            label={t("files.searchPlaceholder")}
            size="md"
            className={styles.search}
          />
          <Menu
            labels={statusLabels}
            label={
              picked.length === 0
                ? t("files.statusAny")
                : picked.length === 1
                  ? t(verdictWord(picked[0]))
                  : t("files.statuses", { count: picked.length })
            }
            active={picked.length > 0}
            open={statusOpen}
            onToggle={() => setStatusOpen(!statusOpen)}
          >
            {STATUS_FILTERS.map((option) => (
              <FilterOption
                key={option}
                label={t(verdictWord(option))}
                count={statuses[option]}
                checked={picked.includes(option)}
                disabled={statuses[option] === 0 && !picked.includes(option)}
                onToggle={() => pickStatus(option)}
              />
            ))}
          </Menu>
        </div>
      )}

      {unread ? null : !loading && visible.length === 0 ? (
        filtering ? (
          <EmptyState
            title={t("files.noMatches")}
            action={
              <Button variant="text" tone="red" onClick={reset}>
                {t("ui:ui.reset")}
              </Button>
            }
          />
        ) : contracts.length > 0 ? (
          <EmptyState
            title={t("files.noActive")}
            action={
              <Button variant="text" tone="accent" onClick={() => onHideClosed(false)}>
                {t("files.showClosed")}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t("files.empty")} hint={t(hasUnpaid ? "files.emptyUnpaid" : "files.emptyHint")} />
        )
      ) : (
        <div className={styles.list}>
          <DataTable framed stack columns={`repeat(${COLUMNS.length + 1}, max-content)`}>
            <DataTableHead>
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
              <DataHeadCell className={styles.actionsHead}>{t("files.actions")}</DataHeadCell>
            </DataTableHead>

            <DataTableRows className={styles.rows}>
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
                    viewed={contract.address === viewedFor}
                    onCopy={onCopy}
                    onOpen={() => openInfo(contract.address)}
                    onAction={(kind) => toggleFor(contract.address, kind)}
                    onAskWithdraw={() => setWithdrawFor(contract.address)}
                  />
                )
              })}
            </DataTableRows>
          </DataTable>

          {portion.length > 0 && (
            <ShowMore
              shown={portion.length}
              total={visible.length}
              onMore={() => setShownLimit((count) => count + ROW_PORTION)}
            />
          )}
        </div>
      )}

      <Sheet open={infoContract !== null} wide title={t("files.details")} onClose={() => setInfoFor(null)}>
        {infoContract && (
          <ContractDetails
            contract={infoContract}
            copied={copied}
            onCopy={onCopy}
            onOpenProvider={onOpenProvider}
            onAction={(kind) => {
              setInfoFor(null)
              onEditingChange({ address: infoContract.address, kind })
            }}
            onAskWithdraw={() => {
              setInfoFor(null)
              setWithdrawFor(infoContract.address)
            }}
          />
        )}
      </Sheet>

      <Sheet
        open={editing !== null && editingContract !== null}
        title={t(editorTitle[editing?.kind ?? "edit"])}
        subject={editingContract ? fmt.shortKey(editingContract.address) : undefined}
        wide={editing?.kind === "edit" || editing?.kind === "fix"}
        onClose={() => onEditingChange(null)}
      >
        <div className={shared.sheetBody}>
          {editing && editingContract && renderEditor(editingContract, editing.kind)}
        </div>
      </Sheet>

      <ConfirmSheet
        open={withdrawFor !== null}
        title={t("files.withdrawTitle")}
        subject={withdrawFor ? fmt.shortKey(withdrawFor) : undefined}
        alert={withdrawLost ? t(withdrawAlert) : undefined}
        note={withdrawContract?.state ? undefined : t("files.withdrawNote")}
        confirmLabel={t(withdrawLost ? "files.withdrawTitle" : "files.withdraw")}
        onConfirm={() => {
          if (withdrawFor) onWithdraw(withdrawFor)
        }}
        onClose={() => setWithdrawFor(null)}
      >
        {withdrawContract?.state && (
          <Card pad="row" className={styles.closeCard}>
            <FieldList>
              <div className={styles.closeTotal}>
                <span>{t("details.balance")}</span>
                <span className={shared.spacer} />
                <span className={styles.closeBalance}>{tonLabel(withdrawContract.state.balance)}</span>
              </div>
              <span className={styles.closeNote}>{t("files.withdrawNote")}</span>
            </FieldList>
          </Card>
        )}
      </ConfirmSheet>
    </div>
  )
}
