import { useCallback, useEffect, useState } from "react"
import type { ContractStatus } from "@/types/contract"
import { fetchContractStatuses } from "./api"
import type { ContractRow } from "./contracts"
import { asArray, asRecord } from "./json"
import { CONTRACTS_KEY, LANGUAGE_KEY, PENDING_KEY, STATES_KEY, THEME_KEY, readStored, wipeStored, writeStored } from "./local-storage"
import { fetchAccountStates, type AccountState } from "./ton/toncenter"
import { parseStorageData, type StorageProvider } from "./ton/storage-data"

export interface ContractState {
  torrentHash: string
  fileSize: number
  balance: number
  providers: StorageProvider[]
}

export const stateOf = (account: AccountState): ContractState | null => {
  if (!account.dataBoc) return null
  const data = parseStorageData(account.dataBoc)

  return { torrentHash: data.torrentHash, fileSize: data.fileSize, balance: account.balance, providers: data.providers }
}

interface ContractsCache {
  headLt: string | null
  closedLt: string | null
  rows: ContractRow[]
}

export const readContractsCache = (owner: string): ContractsCache | null => {
  if (!owner) return null
  const raw = readStored(CONTRACTS_KEY)
  if (raw === null) return null

  try {
    const parsed = asRecord(JSON.parse(raw))
    if (parsed.owner !== owner) return null
    return {
      headLt: typeof parsed.headLt === "string" ? parsed.headLt : null,
      closedLt: typeof parsed.closedLt === "string" ? parsed.closedLt : null,
      rows: asArray(parsed.rows).filter((row): row is ContractRow => typeof asRecord(row).address === "string"),
    }
  } catch {
    return null
  }
}

export const writeContractsCache = (owner: string, cache: ContractsCache): void => {
  if (!owner) return
  const rows = cache.rows.map((row) => {
    const bare = { ...row }
    delete bare.state
    return bare
  })
  writeStored(CONTRACTS_KEY, JSON.stringify({ owner, headLt: cache.headLt, closedLt: cache.closedLt, rows }))
}

interface StateEntry {
  stateHash: string | null
  value: ContractState
}

const stateByAddress = new Map<string, StateEntry>()
const stateWatchers = new Map<string, Set<() => void>>()
let stateRead = false

const providerFrom = (raw: unknown): StorageProvider | null => {
  const { pubkey, ratePerMbDay, maxSpan, lastProofTime } = asRecord(raw)
  const numbers = [ratePerMbDay, maxSpan, lastProofTime]
  if (typeof pubkey !== "string" || numbers.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null

  return { pubkey, ratePerMbDay: ratePerMbDay as number, maxSpan: maxSpan as number, lastProofTime: lastProofTime as number }
}

const stateFrom = (raw: unknown): ContractState | null => {
  const { torrentHash, fileSize, balance, providers } = asRecord(raw)
  if (typeof fileSize !== "number" || typeof balance !== "number" || !Array.isArray(providers)) return null

  const known = providers.map(providerFrom)
  if (known.some((provider) => provider === null)) return null

  return {
    torrentHash: typeof torrentHash === "string" ? torrentHash : "",
    fileSize,
    balance,
    providers: known as StorageProvider[],
  }
}

const readStates = (): void => {
  if (stateRead) return
  stateRead = true
  try {
    const stored = asRecord(JSON.parse(readStored(STATES_KEY) ?? "null"))
    Object.entries(stored).forEach(([address, entry]) => {
      const { stateHash, value } = asRecord(entry)
      const state = stateFrom(value)
      if (state) stateByAddress.set(address, { stateHash: typeof stateHash === "string" ? stateHash : null, value: state })
    })
  } catch {
    return
  }
}

const writeStates = (): void => {
  writeStored(STATES_KEY, JSON.stringify(Object.fromEntries(stateByAddress)))
}

export const peekState = (address: string): ContractState | undefined => {
  readStates()
  return stateByAddress.get(address)?.value
}

export const knownStateHash = (address: string): string | null | undefined => {
  readStates()
  return stateByAddress.get(address)?.stateHash
}

export const putStates = (entries: { address: string; stateHash: string | null; value: ContractState }[]): void => {
  if (!entries.length) return

  readStates()
  entries.forEach(({ address, stateHash, value }) => stateByAddress.set(address, { stateHash, value }))
  writeStates()
  entries.forEach(({ address }) => stateWatchers.get(address)?.forEach((notify) => notify()))
}

export const putState = (address: string, stateHash: string | null, value: ContractState): void =>
  putStates([{ address, stateHash, value }])

export const watchState = (address: string, notify: () => void): (() => void) => {
  const watchers = stateWatchers.get(address) ?? new Set()
  watchers.add(notify)
  stateWatchers.set(address, watchers)
  return () => {
    watchers.delete(notify)
    if (!watchers.size) stateWatchers.delete(address)
  }
}

const statusesByAddress = new Map<string, ContractStatus[]>()
const statusesInFlight = new Map<string, Promise<ContractStatus[]>>()

export const peekStatuses = (address: string): ContractStatus[] => statusesByAddress.get(address) ?? []

export const getStatuses = (addresses: string[], signal?: AbortSignal): Promise<ContractStatus[]> => {
  const joined = addresses.length === 1 ? statusesInFlight.get(addresses[0]) : undefined
  if (joined) return joined

  const promise = fetchContractStatuses(addresses, signal).then((checks) => {
    addresses.forEach((address) =>
      statusesByAddress.set(
        address,
        checks.filter((status) => status.address === address),
      ),
    )
    return checks
  })

  const settled = (): void =>
    addresses.forEach((address) => {
      if (statusesInFlight.get(address) === promise) statusesInFlight.delete(address)
    })

  addresses.forEach((address) => statusesInFlight.set(address, promise))
  void promise.then(settled, settled)

  return promise
}

export const clearWalletCaches = (): void => {
  wipeStored([THEME_KEY, LANGUAGE_KEY, PENDING_KEY])
  resetContractCachesForTests()
}

export const resetContractCachesForTests = (): void => {
  stateByAddress.clear()
  stateWatchers.clear()
  stateRead = false
  statusesByAddress.clear()
  statusesInFlight.clear()
}

export const refreshState = async (address: string, signal?: AbortSignal): Promise<ContractState | null> => {
  const { accounts } = await fetchAccountStates([address], true, signal)
  const state = accounts[0] ? stateOf(accounts[0]) : null
  if (state) putState(address, accounts[0].stateHash, state)
  return state
}

interface ContractData {
  state: ContractState | null
  statuses: ContractStatus[]
  unreadable: boolean
  offline: boolean
  retry: () => void
}

export const useContractData = (address: string, withStatuses = false): ContractData => {
  const [state, setState] = useState<ContractState | null>(() => peekState(address) ?? null)
  const [statuses, setStatuses] = useState<ContractStatus[]>(() => (withStatuses ? peekStatuses(address) : []))
  const [unreadable, setUnreadable] = useState(false)
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const show = (): void => setState(peekState(address) ?? null)
    const unwatch = watchState(address, show)

    show()
    setStatuses(withStatuses ? peekStatuses(address) : [])
    setUnreadable(false)
    setOffline(false)

    if (attempt > 0) {
      refreshState(address, controller.signal)
        .then((read) => {
          if (!controller.signal.aborted && !read) setUnreadable(true)
        })
        .catch(() => {
          if (!controller.signal.aborted && peekState(address) === undefined) setOffline(true)
        })
    }

    return () => {
      controller.abort()
      unwatch()
    }
  }, [address, withStatuses, attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  return { state, statuses, unreadable, offline, retry }
}
