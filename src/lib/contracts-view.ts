import { contractVerdict, shownChecks, type ContractRow, type ContractVerdict } from "./contracts"
import { paidDaysLeft } from "./pricing"

export type StatusFilter = ContractVerdict

export const STATUS_FILTERS: StatusFilter[] = ["stored", "partial", "lost", "unchecked", "unpaid", "notHired", "noData", "closed"]

export const matchesStatuses = (row: ContractRow, statuses: StatusFilter[], now: number): boolean => {
  if (!statuses.length) return true
  const verdict = contractVerdict(row, now)
  return verdict !== null && statuses.includes(verdict)
}

export const statusCounts = (rows: ContractRow[], now: number): Record<StatusFilter, number> => {
  const counts: Record<StatusFilter, number> = { stored: 0, partial: 0, lost: 0, unchecked: 0, unpaid: 0, notHired: 0, noData: 0, closed: 0 }

  rows.forEach((row) => {
    const verdict = contractVerdict(row, now)
    if (verdict !== null) counts[verdict] += 1
  })

  return counts
}

export const matchesQuery = (row: ContractRow, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  return [row.address, row.bagId, row.description].some((value) => value.toLowerCase().includes(needle))
}

const SORT_FIELDS = ["createdAt", "address", "bagId", "desc", "paidUntil", "size", "checks", "status"] as const

export type ContractSortField = (typeof SORT_FIELDS)[number]
export type SortDirection = "asc" | "desc"

export const isSortField = (value: string): value is ContractSortField => SORT_FIELDS.some((field) => field === value)

const HEAVINESS: Record<ContractVerdict, number> = {
  unpaid: 0,
  lost: 1,
  notHired: 2,
  partial: 3,
  unchecked: 4,
  stored: 5,
  noData: 6,
  closed: 7,
}

const NO_VALUE = Number.MAX_SAFE_INTEGER

const valueOf = (row: ContractRow, field: ContractSortField, now: number): number | string => {
  switch (field) {
    case "createdAt":
      return row.createdAt
    case "address":
      return row.address
    case "bagId":
      return row.bagId
    case "desc":
      return row.description
    case "size":
      return row.size || row.state?.fileSize || 0
    case "checks": {
      const checks = shownChecks(row)
      return checks !== null && checks.ran > 0 ? checks.valid / checks.total : NO_VALUE
    }
    case "status": {
      const verdict = contractVerdict(row, now)
      return verdict === null ? HEAVINESS.noData : HEAVINESS[verdict]
    }
    case "paidUntil": {
      if (row.closed || !row.state) return NO_VALUE
      const left = paidDaysLeft(row.state.fileSize, row.state.providers, row.state.balance, now)
      return left ?? 0
    }
  }
}

export const sortContracts = (
  rows: ContractRow[],
  field: ContractSortField,
  direction: SortDirection,
  now: number,
): ContractRow[] => {
  const sign = direction === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = valueOf(a, field, now)
    const right = valueOf(b, field, now)
    return typeof left === "string" ? left.localeCompare(right as string) * sign : (left - (right as number)) * sign
  })
}

export interface ListView {
  statuses: StatusFilter[]
  query: string
  field: ContractSortField
  direction: SortDirection
  hideClosed: boolean
}

export const openContracts = (rows: ContractRow[], hideClosed: boolean): ContractRow[] =>
  rows.filter((row) => !(hideClosed && row.closed))

export const visibleContracts = (rows: ContractRow[], view: ListView, now: number): ContractRow[] => {
  const kept = openContracts(rows, view.hideClosed && !view.statuses.includes("closed")).filter(
    (row) => matchesStatuses(row, view.statuses, now) && matchesQuery(row, view.query),
  )

  return sortContracts(kept, view.field, view.direction, now)
}
