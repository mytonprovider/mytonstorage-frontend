import { useCallback, useEffect, useRef, useState } from "react"
import { useTonConnectUI } from "@tonconnect/ui-react"
import type { BagInfoShort, ContractStatus, StorageContract, WalletTransaction } from "@/types/contract"
import type { Tone } from "@/types/tone"
import { failureStatus, fetchBagDetails, notifyProviders, sessionEnded } from "./api"
import type { ContractState } from "./contracts-cache"
import { CONTRACT_RESERVE, MIN_BOUNTY, fullBounty } from "./pricing"
import { pubkeyFrom } from "./providers"
import type { StorageProvider } from "./ton/storage-data"
import { getStatuses, knownStateHash, peekState, putStates, readContractsCache, refreshState, stateOf, writeContractsCache } from "./contracts-cache"
import { MIB, nowSeconds } from "./format"
import { readListView, writeListView } from "./local-storage"
import { forgetPendingFound, readPendingPaid } from "./paid-link"
import { ADDRESS_BATCH, ChainRequestError, fetchAccountStates, fetchMessages, type MessagesPage, type MessagesQuery } from "./ton/toncenter"
import { sendAndConfirm, walletRefused, type WalletSender } from "./ton/transactions"
import { CONFIRM_TIMEOUT, payErrorKey } from "./errors"

const OPCODE_MODIFY = "0x3dc680ae"
const OPCODE_TERMINATED = "0xb6236d63"
export const STORAGE_CODE_HASH = "OFpfDduEHBfdUYoyfDItfQmOkceV65oVL+m+XNIOQMk="

export const INDEX_LAG_SECONDS = 300
const SYNC_INTERVAL_MS = 30_000

interface ScannedContract {
  address: string
  createdAt: number
  closed: boolean
  lastEventAt?: number
}

const lastOf = (contract: ScannedContract): number => contract.lastEventAt ?? contract.createdAt

export interface ContractRow extends StorageContract {
  lastEventAt?: number
  checked?: string[]
  stored?: string[]
  enriched?: boolean
  state?: ContractState | null
}

const withState = (row: ContractRow, state: ContractState | null | undefined, now: number): ContractRow => {
  const funded = state !== null && state !== undefined && state.balance > CONTRACT_RESERVE
  if (!row.closed || !funded) return { ...row, state }
  return { ...row, state, closed: false, lastEventAt: Math.max(lastOf(row), now) }
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

interface Sweep {
  found: ScannedContract[]
  cursor: string | null
}

interface SweepOptions {
  signal?: AbortSignal
  now?: number
  fetchPage?: (query: MessagesQuery, signal?: AbortSignal) => Promise<MessagesPage>
  onPage?: (found: ScannedContract[]) => Promise<void> | void
}

const sweep = async (
  query: Omit<MessagesQuery, "startLt" | "endLt">,
  cursor: string | null,
  pick: (page: MessagesPage) => ScannedContract[],
  { signal, now = nowSeconds(), fetchPage = fetchMessages, onPage }: SweepOptions,
): Promise<Sweep> => {
  const found: ScannedContract[] = []
  let startLt = cursor === null ? null : (BigInt(cursor) + 1n).toString()
  let endLt: string | null = null
  let settledLt = cursor

  for (;;) {
    if (signal?.aborted) break
    const page = await fetchPage({ ...query, startLt, endLt }, signal)
    const picked = pick(page)
    found.push(...picked)
    if (picked.length) await onPage?.(picked)
    page.messages.forEach((message) => {
      if (message.createdAt <= now - INDEX_LAG_SECONDS && (settledLt === null || BigInt(message.createdLt) > BigInt(settledLt))) {
        settledLt = message.createdLt
      }
    })
    if (!page.hasMore || page.lastLt === null) break
    if (startLt === null) endLt = (BigInt(page.lastLt) - 1n).toString()
    else startLt = (BigInt(page.lastLt) + 1n).toString()
  }

  return { found, cursor: settledLt }
}

export const discover = (owner: string, cursor: string | null, options: SweepOptions = {}): Promise<Sweep> =>
  sweep({ source: owner, opcode: OPCODE_MODIFY }, cursor, (page) => {
    const byAddress = new Map<string, ScannedContract>()

    page.messages.forEach((message) => {
      const address = page.friendly[message.destination] ?? message.destination
      const known = byAddress.get(address)
      byAddress.set(address, {
        address,
        createdAt: Math.min(known?.createdAt ?? message.createdAt, message.createdAt),
        closed: false,
        lastEventAt: Math.max(known?.lastEventAt ?? 0, message.createdAt),
      })
    })

    return [...byAddress.values()]
  }, options)

export const findClosed = (owner: string, cursor: string | null, options: SweepOptions = {}): Promise<Sweep> =>
  sweep({ destination: owner, opcode: OPCODE_TERMINATED }, cursor, (page) =>
    page.messages.map((message) => ({ address: page.friendly[message.source] ?? message.source, createdAt: message.createdAt, closed: true, lastEventAt: message.createdAt })),
  options)

interface StatesIo {
  fetchStates?: typeof fetchAccountStates
  signal?: AbortSignal
  now?: number
}

export const refreshStates = async (rows: ContractRow[], { fetchStates = fetchAccountStates, signal, now = nowSeconds() }: StatesIo = {}): Promise<ContractRow[]> => {
  if (!rows.length) return rows

  const firstRead = rows.every((row) => knownStateHash(row.address) === undefined)
  const light = await fetchStates(rows.map((row) => row.address), firstRead, signal)
  const byAddress = new Map(light.accounts.map((account) => [light.friendly[account.address] ?? account.address, account]))

  const stale = firstRead
    ? []
    : rows.filter((row) => {
        const account = byAddress.get(row.address)
        return account?.codeHash === STORAGE_CODE_HASH && (account.stateHash === null || account.stateHash !== knownStateHash(row.address))
      })
  const full = stale.length ? await fetchStates(stale.map((row) => row.address), true, signal) : light
  putStates(
    full.accounts.flatMap((account) => {
      const state = account.codeHash === STORAGE_CODE_HASH ? stateOf(account) : null
      if (!state) return []
      return [{ address: full.friendly[account.address] ?? account.address, stateHash: account.stateHash, value: state }]
    }),
  )

  return rows.flatMap((row) => {
    const account = byAddress.get(row.address)
    if (!account) return [{ ...row, state: peekState(row.address) ?? null }]
    if (account.codeHash !== STORAGE_CODE_HASH && !row.closed) return []
    const state = peekState(row.address) ?? null
    return [withState({ ...row, bagId: row.bagId || state?.torrentHash || "", size: row.size || state?.fileSize || 0 }, state, now)]
  })
}

const replaceRows = (rows: ContractRow[], asked: Set<string>, fresh: ContractRow[]): ContractRow[] => {
  const byAddress = new Map(fresh.map((row) => [row.address, row]))
  return rows.flatMap((row) => {
    if (!asked.has(row.address)) return [row]
    const kept = byAddress.get(row.address)
    return kept ? [kept] : []
  })
}

const applyBags = (rows: ContractRow[], asked: Set<string>, bags: BagInfoShort[]): ContractRow[] => {
  const byAddress = new Map(bags.map((bag) => [bag.contract_address, bag]))
  return rows.map((row) => {
    if (!asked.has(row.address)) return row
    const bag = byAddress.get(row.address)
    return { ...row, enriched: true, bagId: bag?.bag_id ?? row.bagId, description: bag?.description ?? row.description, size: bag?.size ?? row.size }
  })
}

const applyChecks = (rows: ContractRow[], asked: Set<string>, checks: ContractStatus[]): ContractRow[] =>
  rows.map((row) => (asked.has(row.address) && !row.closed ? { ...row, ...countChecks(checks, row.address) } : row))

interface PassIo {
  signal: AbortSignal
  onRows: (rows: ContractRow[]) => void
  onUnauthorized: (error: unknown) => boolean
  focus?: string[]
  fetchPage?: SweepOptions["fetchPage"]
  fetchStates?: typeof fetchAccountStates
  fetchBags?: typeof fetchBagDetails
  fetchStatuses?: typeof getStatuses
  now?: number
}

export const runPass = async (owner: string, cursors: Cursors, start: ContractRow[], io: PassIo): Promise<Cursors> => {
  const { signal, onRows, onUnauthorized, focus, fetchPage, fetchStates, fetchBags = fetchBagDetails, fetchStatuses = getStatuses, now } = io
  let rows = start
  let drawn: Promise<void> = Promise.resolve()

  const show = (next: ContractRow[]): void => {
    rows = next
    if (!signal.aborted) onRows(rows)
  }

  const enrich = (asked: Set<string>): Promise<void> => {
    const batch = rows.filter((row) => asked.has(row.address))
    const missing = batch.filter((row) => !row.enriched).map((row) => row.address)
    const open = batch.filter((row) => !row.closed).map((row) => row.address)
    const bags = fetchBags(missing, signal)
      .then((found) => show(applyBags(rows, asked, found)))
      .catch((error: unknown) => {
        if (sessionEnded(error) && !signal.aborted) onUnauthorized(error)
      })
    const checks = fetchStatuses(open, signal)
      .then((found) => show(applyChecks(rows, asked, found)))
      .catch(() => undefined)
    return Promise.all([bags, checks]).then(() => undefined)
  }

  const settle = async (addresses: string[]): Promise<void> => {
    const asked = new Set(addresses)
    const fresh = await refreshStates(rows.filter((row) => asked.has(row.address)), { fetchStates, signal })
    if (signal.aborted) return
    show(replaceRows(rows, asked, fresh))
    drawn = enrich(asked)
  }

  const closed = await findClosed(owner, cursors.closedLt, { signal, fetchPage, now })
  if (signal.aborted) return cursors
  show(mergeRows(rows, closed.found.filter((event) => rows.some((row) => row.address === event.address))))

  const found = await discover(owner, cursors.headLt, {
    signal,
    fetchPage,
    now,
    onPage: async (contracts) => {
      await drawn
      if (signal.aborted) return
      const addresses = contracts.map((contract) => contract.address)
      const onPage = new Set(addresses)
      forgetPendingFound(addresses)
      show(mergeRows(rows, [...contracts, ...closed.found.filter((event) => onPage.has(event.address))]))
      for (let at = 0; at < addresses.length; at += ADDRESS_BATCH) {
        await drawn
        if (signal.aborted) return
        await settle(addresses.slice(at, at + ADDRESS_BATCH))
      }
    },
  })
  if (signal.aborted) return cursors

  const seen = new Set(found.found.map((contract) => contract.address))
  const wanted = focus ? new Set(focus) : null
  const rest = rows.filter((row) => !seen.has(row.address) && (!wanted || wanted.has(row.address))).map((row) => row.address)
  for (let at = 0; at < rest.length; at += ADDRESS_BATCH) {
    await drawn
    if (signal.aborted) return cursors
    await settle(rest.slice(at, at + ADDRESS_BATCH))
  }
  await drawn

  return { headLt: found.cursor, closedLt: closed.cursor }
}

export const checkRan = (status: ContractStatus): status is ContractStatus & { reason: number } => status.reason !== null

const keyOf = (pubkey: string): string => pubkeyFrom(pubkey) ?? pubkey

export const countChecks = (
  statuses: ContractStatus[],
  address: string,
): { valid: number; total: number; checked: string[]; stored: string[] } => {
  const own = statuses.filter((status) => status.address === address)
  const checked = own.filter(checkRan).map((status) => keyOf(status.provider_pubkey))
  const stored = own.filter((status) => status.reason === 0).map((status) => keyOf(status.provider_pubkey))
  return { valid: stored.length, total: own.length, checked, stored }
}

export interface ShownChecks {
  valid: number
  total: number
  ran: number
}

export const shownChecks = (
  contract: Pick<ContractRow, "valid" | "total" | "checked" | "stored" | "state">,
): ShownChecks | null => {
  if (contract.checked === undefined || contract.state === undefined) return null
  if (contract.state === null) return { valid: contract.valid, total: contract.total, ran: contract.checked.length }

  const hired = new Set(contract.state.providers.map((provider) => keyOf(provider.pubkey)))
  const among = (keys: string[]): number => keys.filter((key) => hired.has(keyOf(key))).length
  return { valid: among(contract.stored ?? []), total: hired.size, ran: among(contract.checked) }
}

export const checksTone = (checks: ShownChecks): Tone | undefined => (checks.ran === 0 ? "gray" : undefined)

export const PROOF_GRACE_SECONDS = 3600
const START_WINDOW_SECONDS = 86_400
const LATE_PROOF_SHARE = 0.1
const PICKUP_SECONDS = 7200
const FETCH_BYTES_PER_SECOND = 5 * MIB

const hiredAt = (contract: Pick<ContractRow, "createdAt" | "lastEventAt">): number => contract.lastEventAt ?? contract.createdAt

const proofGrace = (maxSpan: number): number => Math.max(PROOF_GRACE_SECONDS, Math.round(maxSpan * LATE_PROOF_SHARE))

const fetchWindow = (fileSize: number, maxSpan: number): number =>
  Math.min(PICKUP_SECONDS + Math.round(fileSize / FETCH_BYTES_PER_SECOND), maxSpan)

const proofDue = ({ lastProofTime, maxSpan }: StorageProvider, hired: number, fileSize: number): number =>
  lastProofTime > 0
    ? lastProofTime + maxSpan + proofGrace(maxSpan)
    : hired + Math.max(START_WINDOW_SECONDS, fetchWindow(fileSize, maxSpan))

const payDue = ({ lastProofTime, maxSpan }: StorageProvider, hired: number): number =>
  (lastProofTime > 0 ? lastProofTime : hired) + maxSpan + PROOF_GRACE_SECONDS

const unpaid = (state: ContractState, hired: number, now: number): boolean => {
  const available = Math.max(0, state.balance - CONTRACT_RESERVE)
  return state.providers.some(
    (provider) =>
      now > payDue(provider, hired) && available < Math.max(MIN_BOUNTY, fullBounty(state.fileSize, provider.ratePerMbDay, provider.maxSpan)),
  )
}

export type ContractVerdict = "closed" | "noData" | "unpaid" | "notHired" | "stored" | "partial" | "unchecked" | "lost"

type VerdictInput = Pick<ContractRow, "closed" | "state" | "createdAt" | "lastEventAt" | "valid" | "total" | "checked" | "stored">

export const contractVerdict = (contract: VerdictInput, now: number): ContractVerdict | null => {
  if (contract.closed) return "closed"

  const state = contract.state
  if (state === undefined) return null
  if (state === null) return "noData"
  if (!state.providers.length) return "notHired"

  const hired = hiredAt(contract)
  if (unpaid(state, hired, now)) return "unpaid"

  const checks = shownChecks(contract)
  if (checks === null) return null
  if (checks.ran > 0) return checks.valid === checks.total ? "stored" : checks.valid === 0 ? "lost" : "partial"

  const inTime = state.providers.some((provider) => now <= proofDue(provider, hired, state.fileSize))
  return inTime ? "unchecked" : "lost"
}

const VERDICT_LOOK: Record<ContractVerdict, { tone: Tone; word: string }> = {
  closed: { tone: "gray", word: "files.closed" },
  noData: { tone: "gray", word: "status.noData" },
  unpaid: { tone: "red", word: "files.statusUnpaid" },
  notHired: { tone: "gray", word: "files.statusNotHired" },
  stored: { tone: "green", word: "files.statusStored" },
  partial: { tone: "yellow", word: "files.statusPartial" },
  unchecked: { tone: "gray", word: "files.statusUnchecked" },
  lost: { tone: "red", word: "files.statusNone" },
}

export const VERDICT_WORDS: string[] = Object.values(VERDICT_LOOK).map(({ word }) => word)

export const verdictWord = (verdict: ContractVerdict): string => VERDICT_LOOK[verdict].word

export const contractStatus = (contract: VerdictInput, now: number): { tone: Tone; word: string } | null => {
  const verdict = contractVerdict(contract, now)
  return verdict && VERDICT_LOOK[verdict]
}

export const scanUrl = (address: string): string => `https://tonscan.org/address/${address}`

export const txUrl = (hash: string): string => `https://tonscan.org/tx/${hash}`

export const LOW_BALANCE_DAYS = 3

export const paymentTone = (paidDays: number | null): Extract<Tone, "red" | "yellow"> | null =>
  paidDays === null ? null : paidDays < 1 ? "red" : paidDays < LOW_BALANCE_DAYS ? "yellow" : null

const ACTION_TIMEOUT_MS = 180_000

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

type ActionResult = ContractsFailure | "refused" | null

type ContractRunner = (contract: string, build: () => Promise<WalletTransaction>, notify?: string[]) => Promise<boolean>

export const runContractAction = (
  lock: { current: string | null },
  sender: WalletSender,
  contract: string,
  build: () => Promise<WalletTransaction>,
): Promise<ActionResult> | null => {
  if (lock.current !== null) return null
  lock.current = contract

  const settle = async (): Promise<ActionResult> => {
    try {
      const transaction = await build()
      const confirmed = await sendAndConfirm(sender, transaction, ACTION_TIMEOUT_MS)
      return confirmed ? null : { key: CONFIRM_TIMEOUT, status: null, kind: "action" }
    } catch (error) {
      if (walletRefused(error)) return "refused"
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
  refreshing: boolean
  onShown: (addresses: string[]) => void
  error: string | null
  status: number | null
  errorKind: ContractsFailure["kind"] | null
  busy: string | null
  hideClosed: boolean
  onHideClosed: (value: boolean) => void
  reload: () => void
  refresh: () => void
  run: ContractRunner
}

interface Cursors {
  headLt: string | null
  closedLt: string | null
}

const hydrate = (owner: string): { cursors: Cursors; rows: ContractRow[] } => {
  const cache = readContractsCache(owner)
  return {
    cursors: { headLt: cache?.headLt ?? null, closedLt: cache?.closedLt ?? null },
    rows: withPending(
      (cache?.rows ?? []).map((row) => withState(row, peekState(row.address), nowSeconds())),
      owner,
    ),
  }
}

export const useContracts = ({ owner, onUnauthorized }: ContractsOptions): ContractsState => {
  const [tonConnectUI] = useTonConnectUI()

  const [boot] = useState(() => hydrate(owner))
  const [list, setList] = useState<ContractRow[]>(boot.rows)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [failure, setFailure] = useState<ContractsFailure | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [hideClosed, setHideClosed] = useState(() => readListView().hideClosed)
  const [attempt, setAttempt] = useState(0)

  const listRef = useRef(boot.rows)
  const busyLock = useRef<string | null>(null)
  const cursors = useRef<Cursors>(boot.cursors)
  const hydratedFor = useRef(owner)
  const running = useRef<AbortController | null>(null)
  const syncing = useRef<AbortController | null>(null)
  const shown = useRef<string[]>([])
  const swept = useRef(false)
  const unnotified = useRef<{ contract: string; providers: string[] } | null>(null)

  useEffect(() => {
    if (hydratedFor.current === owner) return
    hydratedFor.current = owner
    swept.current = false
    unnotified.current = null
    const next = hydrate(owner)
    cursors.current = next.cursors
    listRef.current = next.rows
    setList(next.rows)
    setFailure(null)
  }, [owner])

  const notifyPending = useCallback(async () => {
    const pending = unnotified.current
    if (!pending) return
    unnotified.current = null
    try {
      await notifyProviders(pending.contract, pending.providers)
    } catch (error) {
      unnotified.current ??= pending
      onUnauthorized(error)
    }
  }, [onUnauthorized])

  const sync = useCallback(
    async (controller: AbortController, full = false) => {
      const { signal } = controller
      if (!owner) return
      if (syncing.current && !syncing.current.signal.aborted) return
      syncing.current = controller
      const everything = full || !swept.current
      setRefreshing(true)
      if (!listRef.current.length) setLoading(true)
      setFailure(null)

      try {
        listRef.current = withPending(listRef.current, owner)
        setList(listRef.current)
        cursors.current = await runPass(owner, cursors.current, listRef.current, {
          signal,
          onUnauthorized,
          focus: everything ? undefined : shown.current,
          onRows: (rows) => {
            listRef.current = rows
            setList(rows)
            if (rows.length) setLoading(false)
            writeContractsCache(owner, { ...cursors.current, rows })
          },
        })
        if (everything && !signal.aborted) swept.current = true
        if (!signal.aborted) void notifyPending()
      } catch (error) {
        if (signal.aborted) return
        if (onUnauthorized(error)) return
        setFailure(loadFailure(error))
      } finally {
        if (syncing.current === controller) {
          syncing.current = null
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [owner, onUnauthorized, notifyPending],
  )

  useEffect(() => {
    if (!owner) return
    const controller = new AbortController()
    running.current = controller
    void sync(controller)

    const tick = (): void => {
      if (document.visibilityState === "visible") void sync(controller)
    }
    const timer = window.setInterval(tick, SYNC_INTERVAL_MS)
    document.addEventListener("visibilitychange", tick)

    return () => {
      controller.abort()
      running.current = null
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [owner, attempt, sync])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  const refresh = useCallback(() => {
    if (running.current) void sync(running.current, true)
  }, [sync])

  const onShown = useCallback((addresses: string[]) => {
    shown.current = addresses
  }, [])

  const run: ContractRunner = async (contract, build, providers) => {
    const pending = runContractAction(busyLock, tonConnectUI, contract, build)
    if (!pending) return false
    setBusy(contract)
    let confirmed = false
    try {
      const failure = await pending
      if (failure === null) confirmed = true
      else if (failure !== "refused") setFailure(failure)
    } catch (error) {
      if (!onUnauthorized(error)) setFailure(actionFailure(error))
    } finally {
      void refreshState(contract).then((state) => {
        if (!state) return
        listRef.current = listRef.current.map((row) => (row.address === contract ? { ...row, state } : row))
        setList(listRef.current)
      })
      if (running.current) void sync(running.current)
      setBusy(null)
    }

    if (confirmed && providers) {
      unnotified.current = { contract, providers }
      await notifyPending()
    }
    return confirmed
  }

  const onHideClosed = (value: boolean) => {
    setHideClosed(value)
    writeListView({ hideClosed: value })
  }

  return {
    list,
    loading,
    refreshing,
    onShown,
    error: failure?.key ?? null,
    status: failure?.status ?? null,
    errorKind: failure?.kind ?? null,
    busy,
    hideClosed,
    onHideClosed,
    reload,
    refresh,
    run,
  }
}
