import { useCallback, useEffect, useRef, useState } from "react"
import { useTonConnectUI } from "@tonconnect/ui-react"
import type { BagInfoShort, ContractStatus, StorageContract, WalletTransaction } from "@/types/contract"
import type { Tone } from "@/types/tone"
import { failureStatus, fetchBagDetails, sessionEnded } from "./api"
import type { ContractEconomics } from "./contracts-cache"
import { dropEconomics, getEconomics, getStatuses, peekEconomics, readContractsCache, writeContractsCache } from "./contracts-cache"
import { HIDE_CLOSED_KEY, readStored, writeStored } from "./local-storage"
import { forgetPendingFound, readPendingPaid } from "./paid-link"
import type { TransactionsPage } from "./ton/toncenter"
import { ChainRequestError, fetchTransactions } from "./ton/toncenter"
import { sendAndConfirm, walletRefused, type WalletSender } from "./ton/transactions"
import { CONFIRM_TIMEOUT, payErrorKey } from "./wizard"

export const OPCODE_DEPLOY = "0x3dc680ae"
export const OPCODE_CLOSE = "0x61fff683"

interface ScannedContract {
  address: string
  createdAt: number
  closed: boolean
  lastEventAt?: number
}

export const contractsFromPage = (page: TransactionsPage): ScannedContract[] =>
  page.transactions.flatMap((transaction) =>
    (transaction.out_msgs ?? []).flatMap((message) => {
      if (!message.destination) return []
      if (message.opcode !== OPCODE_DEPLOY && message.opcode !== OPCODE_CLOSE) return []

      return [
        {
          address: page.friendly[message.destination] ?? message.destination,
          createdAt: Number(message.created_at) || transaction.now,
          closed: message.opcode === OPCODE_CLOSE,
        },
      ]
    }),
  )

const lastOf = (contract: ScannedContract): number => contract.lastEventAt ?? contract.createdAt

export interface ContractRow extends StorageContract {
  lastEventAt?: number
  pending?: number
  economics?: ContractEconomics | null
}

export const mergeRows = (rows: ContractRow[], scanned: ScannedContract[]): ContractRow[] => {
  const byAddress = new Map(rows.map((row) => [row.address, row]))

  scanned.forEach((event) => {
    const known = byAddress.get(event.address)
    if (!known) {
      byAddress.set(event.address, {
        ...event,
        lastEventAt: lastOf(event),
        bagId: "",
        description: "",
        size: 0,
        valid: 0,
        total: 0,
      })
      return
    }
    byAddress.set(event.address, {
      ...known,
      createdAt: Math.min(known.createdAt, event.createdAt),
      lastEventAt: Math.max(lastOf(known), lastOf(event)),
      closed: lastOf(event) >= lastOf(known) ? event.closed : known.closed,
    })
  })

  return [...byAddress.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export const withPending = (rows: ContractRow[], owner: string): ContractRow[] => {
  const pending = readPendingPaid()
  if (!owner || !pending?.linked || pending.owner !== owner) return rows
  if (rows.some((row) => row.address === pending.contract)) return rows

  return [
    {
      address: pending.contract,
      createdAt: Math.floor(pending.at / 1000),
      closed: false,
      bagId: pending.bagId,
      description: pending.description ?? "",
      size: pending.size ?? 0,
      valid: 0,
      total: 0,
    },
    ...rows,
  ].sort((a, b) => b.createdAt - a.createdAt)
}

export const requeueEconomics = (rows: ContractRow[]): ContractRow[] =>
  rows.some((row) => row.economics === null)
    ? rows.map((row) => (row.economics === null ? { ...row, economics: undefined } : row))
    : rows

const PAGE_SIZE = 100

interface ScanOptions {
  maxPages?: number
  beforeLt?: string | null
  stopLt?: string | null
  signal?: AbortSignal
  onPage?: (contracts: ScannedContract[], nextLt: string | null) => void
  fetchPage?: typeof fetchTransactions
}

interface ContractScan {
  topLt: string | null
  nextLt: string | null
}

export const scanContracts = async (account: string, options: ScanOptions = {}): Promise<ContractScan> => {
  const { maxPages = 10, beforeLt = null, stopLt = null, signal, onPage, fetchPage = fetchTransactions } = options

  let cursor = beforeLt
  let topLt: string | null = null

  for (let page = 0; page < maxPages; page++) {
    if (signal?.aborted) break

    const fetched = await fetchPage(account, PAGE_SIZE, cursor, signal)
    topLt ??= fetched.transactions[0]?.lt ?? null
    cursor = fetched.nextLt
    onPage?.(contractsFromPage(fetched), cursor)

    if (!fetched.hasMore) break
    if (stopLt !== null && cursor !== null && BigInt(cursor) < BigInt(stopLt)) break
  }

  return { topLt, nextLt: cursor }
}

export const checkRan = (status: ContractStatus): status is ContractStatus & { reason: number } => status.reason !== null

export const countChecks = (
  statuses: ContractStatus[],
  address: string,
): { valid: number; total: number; pending: number } => {
  const own = statuses.filter((status) => status.address === address)
  return {
    valid: own.filter((status) => status.reason === 0).length,
    total: own.length,
    pending: own.filter((status) => !checkRan(status)).length,
  }
}

export const contractTone = (contract: Pick<StorageContract, "valid" | "total" | "closed"> & { pending?: number }): Tone => {
  if (contract.closed) return "gray"
  if (contract.total === 0) return "orange"
  if (contract.valid === contract.total) return "green"
  if (contract.pending !== 0) return "orange"
  if (contract.valid > contract.total / 2) return "yellow"
  return "red"
}

export const scanUrl = (address: string): string => `https://tonscan.org/address/${address}`

export const txUrl = (hash: string): string => `https://tonscan.org/tx/${hash}`

export const LOW_BALANCE_DAYS = 3

const ACTION_TIMEOUT_MS = 180_000
const CATCHUP_PAGES = 10

interface ContractsOptions {
  owner: string
  onUnauthorized: (error: unknown) => boolean
}

interface ContractsFailure {
  key: string
  status: number | null
  kind: "load" | "action"
}

export const loadFailure = (error: unknown): ContractsFailure => ({
  key: "errors.failedToLoadContracts",
  status: error instanceof ChainRequestError ? error.status : failureStatus(error),
  kind: "load",
})

export const actionFailure = (error: unknown): ContractsFailure => ({
  key: payErrorKey(error, { withBag: false }),
  status: failureStatus(error),
  kind: "action",
})

export const runContractAction = (
  lock: { current: string | null },
  sender: WalletSender,
  contract: string,
  build: () => Promise<WalletTransaction>,
): Promise<ContractsFailure | null> | null => {
  if (lock.current !== null) return null
  lock.current = contract

  const settle = async (): Promise<ContractsFailure | null> => {
    try {
      const transaction = await build()
      const confirmed = await sendAndConfirm(sender, transaction, ACTION_TIMEOUT_MS)
      return confirmed ? null : { key: CONFIRM_TIMEOUT, status: null, kind: "action" }
    } catch (error) {
      if (walletRefused(error)) return null
      throw error
    } finally {
      lock.current = null
    }
  }

  return settle()
}

export interface ContractsState {
  list: ContractRow[]
  loading: boolean
  error: string | null
  status: number | null
  errorKind: ContractsFailure["kind"] | null
  busy: string | null
  hasMore: boolean
  hideClosed: boolean
  onHideClosed: (value: boolean) => void
  reload: () => void
  run: (contract: string, build: () => Promise<WalletTransaction>) => Promise<void>
}

const hydrate = (owner: string): { headLt: string | null; deepLt: string | null; rows: ContractRow[] } => {
  const cache = readContractsCache(owner)
  return {
    headLt: cache?.headLt ?? null,
    deepLt: cache?.deepLt ?? null,
    rows: withPending(
      (cache?.rows ?? []).map((row) => ({ ...row, economics: peekEconomics(row.address) })),
      owner,
    ),
  }
}

export const useContracts = ({ owner, onUnauthorized }: ContractsOptions): ContractsState => {
  const [tonConnectUI] = useTonConnectUI()

  const [boot] = useState(() => hydrate(owner))
  const [list, setList] = useState<ContractRow[]>(boot.rows)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<ContractsFailure | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [hideClosed, setHideClosed] = useState(readStored(HIDE_CLOSED_KEY) === "1")
  const [hasMore, setHasMore] = useState(boot.deepLt !== null)
  const [attempt, setAttempt] = useState(0)

  const listRef = useRef(boot.rows)
  const busyLock = useRef<string | null>(null)
  const cursors = useRef({ headLt: boot.headLt, deepLt: boot.deepLt })
  const hydratedFor = useRef(owner)
  const running = useRef<AbortController | null>(null)

  useEffect(() => {
    if (hydratedFor.current === owner) return
    hydratedFor.current = owner
    const next = hydrate(owner)
    cursors.current = { headLt: next.headLt, deepLt: next.deepLt }
    listRef.current = next.rows
    setList(next.rows)
    setHasMore(next.deepLt !== null)
    setFailure(null)
  }, [owner])

  const sync = useCallback(
    async (signal: AbortSignal) => {
      if (!owner) return
      setLoading(true)
      setFailure(null)
      const asked = new Set<string>()

      const patch = (update: (rows: ContractRow[]) => ContractRow[]): void => {
        listRef.current = update(listRef.current)
        setList(listRef.current)
      }

      const persist = (): void => {
        if (cursors.current.headLt !== null) {
          writeContractsCache(owner, cursors.current.headLt, cursors.current.deepLt, listRef.current)
        }
      }

      const append = (found: ScannedContract[]): void => {
        if (!found.length || signal.aborted) return
        forgetPendingFound(found.map((contract) => contract.address))
        patch((rows) => mergeRows(rows, found))
      }

      patch(requeueEconomics)
      patch((rows) => withPending(rows, owner))

      const enrich = async (addresses: string[]): Promise<void> => {
        const fresh = addresses.filter((address) => !asked.has(address))
        fresh.forEach((address) => asked.add(address))
        const rows = listRef.current.filter((row) => fresh.includes(row.address))
        const missing = rows.filter((row) => !row.bagId).map((row) => row.address)
        const open = rows.filter((row) => !row.closed).map((row) => row.address)

        const [bags, checks] = await Promise.all([
          fetchBagDetails(missing, signal).catch((error: unknown) => {
            if (sessionEnded(error)) throw error
            return [] as BagInfoShort[]
          }),
          getStatuses(open, signal).catch(() => [] as ContractStatus[]),
        ])
        if (signal.aborted || (!bags.length && !checks.length)) return

        const checkedFor = new Set(open)
        patch((rows) =>
          rows.map((row) => {
            const bag = bags.find((detail) => detail.contract_address === row.address)
            const counted = checks.length > 0 && checkedFor.has(row.address) ? countChecks(checks, row.address) : null
            if (!bag && !counted) return row
            return {
              ...row,
              bagId: bag?.bag_id ?? row.bagId,
              description: bag?.description ?? row.description,
              size: bag?.size ?? row.size,
              valid: counted?.valid ?? row.valid,
              total: counted?.total ?? row.total,
              pending: counted?.pending ?? row.pending,
            }
          }),
        )
        persist()
      }

      const econPass = async (): Promise<void> => {
        for (;;) {
          if (signal.aborted) return
          const next = listRef.current.find(
            (row) => row.economics === undefined && (!row.closed || !row.bagId || row.size === 0),
          )
          if (!next) return
          const address = next.address
          try {
            const value = await getEconomics(address)
            if (signal.aborted) return
            patch((rows) =>
              rows.map((row) =>
                row.address === address
                  ? {
                      ...row,
                      economics: value,
                      bagId: row.bagId || value.bagId,
                      size: row.size || value.fileSize,
                    }
                  : row,
              ),
            )
            persist()
          } catch {
            if (signal.aborted) return
            patch((rows) => rows.map((row) => (row.address === address ? { ...row, economics: null } : row)))
          }
        }
      }

      const dig = async (): Promise<void> => {
        while (!signal.aborted && cursors.current.deepLt !== null) {
          const found: ScannedContract[] = []
          const dug = await scanContracts(owner, {
            signal,
            beforeLt: cursors.current.deepLt,
            maxPages: 1,
            onPage: (page) => {
              found.push(...page)
              append(page)
            },
          })
          if (signal.aborted) return
          cursors.current.deepLt = dug.nextLt
          setHasMore(dug.nextLt !== null)
          persist()
          if (found.length) await enrich(found.map((contract) => contract.address))
        }
      }

      try {
        const head = cursors.current.headLt
        const caught = await scanContracts(owner, {
          signal,
          stopLt: head,
          maxPages: head === null ? 1 : CATCHUP_PAGES,
          onPage: (page) => append(page),
        })
        if (signal.aborted) return

        if (caught.topLt !== null) cursors.current.headLt = caught.topLt
        if (head === null) {
          cursors.current.deepLt = caught.nextLt
        } else if (caught.nextLt !== null && BigInt(caught.nextLt) >= BigInt(head)) {
          cursors.current.deepLt = caught.nextLt
        }
        setHasMore(cursors.current.deepLt !== null)
        persist()

        await enrich(listRef.current.map((row) => row.address))
        if (signal.aborted) return
        setLoading(false)

        const digging = dig()
        await econPass()
        await digging
        await econPass()
      } catch (error) {
        if (signal.aborted) return
        if (onUnauthorized(error)) return
        setFailure(loadFailure(error))
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    },
    [owner, onUnauthorized],
  )

  useEffect(() => {
    if (!owner) return
    const controller = new AbortController()
    running.current = controller
    void sync(controller.signal)
    return () => {
      controller.abort()
      running.current = null
    }
  }, [owner, attempt, sync])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  const run = async (contract: string, build: () => Promise<WalletTransaction>) => {
    const pending = runContractAction(busyLock, tonConnectUI, contract, build)
    if (!pending) return
    setBusy(contract)
    try {
      const failure = await pending
      if (failure) setFailure(failure)
    } catch (error) {
      if (!onUnauthorized(error)) setFailure(actionFailure(error))
    } finally {
      dropEconomics(contract)
      listRef.current = listRef.current.map((row) => (row.address === contract ? { ...row, economics: undefined } : row))
      setList(listRef.current)
      if (running.current) void sync(running.current.signal)
      setBusy(null)
    }
  }

  const onHideClosed = (value: boolean) => {
    setHideClosed(value)
    writeStored(HIDE_CLOSED_KEY, value ? "1" : "0")
  }

  return {
    list,
    loading,
    error: failure?.key ?? null,
    status: failure?.status ?? null,
    errorKind: failure?.kind ?? null,
    busy,
    hasMore,
    hideClosed,
    onHideClosed,
    reload,
    run,
  }
}
