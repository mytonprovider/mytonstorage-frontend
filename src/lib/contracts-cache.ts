import { useCallback, useEffect, useState } from "react"
import type { ContractStatus } from "@/types/contract"
import { fetchContractStatuses } from "./api"
import type { ContractRow } from "./contracts"
import { asArray, asRecord } from "./json"
import { CONTRACTS_KEY_PREFIX, ECONOMICS_KEY, LANGUAGE_KEY, PENDING_PAID_KEY, THEME_KEY, readStored, wipeStored, writeStored } from "./local-storage"
import type { StackEntry } from "./ton/toncenter"
import { runGetMethod, stackBigInt, stackNumber } from "./ton/toncenter"

interface ContractStorageInfo {
  bagId: string
  fileSize: number
}

export interface ContractEconomics extends ContractStorageInfo {
  balance: number
  ratesPerMibDay: number[]
  pubkeys: string[]
  spans: number[]
  lastProofs: number[]
  span: number
}

const nested = (entry: StackEntry | undefined): StackEntry[] => asArray(entry?.value) as StackEntry[]

const pubkeyOf = (entry: StackEntry | undefined): string => stackBigInt(entry).toString(16).padStart(64, "0")

const storageInfoFrom = (stack: StackEntry[]): ContractStorageInfo => {
  const [torrentHash, bagSize] = stack
  return { bagId: pubkeyOf(torrentHash), fileSize: stackNumber(bagSize) }
}

const providersFrom = (stack: StackEntry[]): Omit<ContractEconomics, keyof ContractStorageInfo> => {
  const [providerList, balance] = stack

  const attached = nested(providerList).map((entry) => {
    const [key, rate, span, lastProof] = nested(entry)
    return {
      pubkey: pubkeyOf(key),
      ratePerMibDay: stackNumber(rate),
      span: stackNumber(span),
      lastProof: stackNumber(lastProof),
    }
  })

  return {
    balance: stackNumber(balance),
    ratesPerMibDay: attached.map((provider) => provider.ratePerMibDay),
    pubkeys: attached.map((provider) => provider.pubkey),
    spans: attached.map((provider) => provider.span),
    lastProofs: attached.map((provider) => provider.lastProof),
    span: Math.max(0, ...attached.map((provider) => provider.span)),
  }
}

export const economicsFrom = (storageInfo: StackEntry[], providerStack: StackEntry[]): ContractEconomics => ({
  ...storageInfoFrom(storageInfo),
  ...providersFrom(providerStack),
})

export const fetchEconomics = async (address: string, signal?: AbortSignal): Promise<ContractEconomics> => {
  const storageInfo = knownStorageInfo(address) ?? storageInfoFrom(await runGetMethod(address, "get_storage_info", signal))
  const providers = await runGetMethod(address, "get_providers", signal)

  return { ...storageInfo, ...providersFrom(providers) }
}

interface ContractsCache {
  headLt: string
  deepLt: string | null
  rows: ContractRow[]
}

export const readContractsCache = (owner: string): ContractsCache | null => {
  if (!owner) return null
  const raw = readStored(CONTRACTS_KEY_PREFIX + owner)
  if (raw === null) return null

  try {
    const parsed = asRecord(JSON.parse(raw))
    if (typeof parsed.headLt !== "string") return null
    return {
      headLt: parsed.headLt,
      deepLt: typeof parsed.deepLt === "string" ? parsed.deepLt : null,
      rows: asArray(parsed.rows).filter((row): row is ContractRow => typeof asRecord(row).address === "string"),
    }
  } catch {
    return null
  }
}

export const writeContractsCache = (owner: string, headLt: string, deepLt: string | null, rows: ContractRow[]): void => {
  if (!owner) return
  const slim = rows.map((row) => {
    const bare = { ...row }
    delete bare.economics
    return bare
  })
  writeStored(CONTRACTS_KEY_PREFIX + owner, JSON.stringify({ headLt, deepLt, rows: slim }))
}

const ECONOMICS_TTL_MS = 3_600_000
const ECONOMICS_FRESH_MS = 60_000

interface EconomicsEntry {
  at: number
  value?: ContractEconomics
  promise?: Promise<ContractEconomics>
}

const economicsByAddress = new Map<string, EconomicsEntry>()
let mirrored = false

const mirror = (): void => {
  if (mirrored) return
  mirrored = true
  try {
    const stored = asRecord(JSON.parse(readStored(ECONOMICS_KEY) ?? "null"))
    Object.entries(stored).forEach(([address, entry]) => {
      const { at, value } = asRecord(entry)
      if (typeof at === "number" && typeof asRecord(value).fileSize === "number") {
        economicsByAddress.set(address, { at, value: value as ContractEconomics })
      }
    })
  } catch {
    return
  }
}

const persistEconomics = (): void => {
  const kept: Record<string, { at: number; value: ContractEconomics }> = {}
  economicsByAddress.forEach((entry, address) => {
    if (entry.value !== undefined && Date.now() - entry.at < ECONOMICS_TTL_MS) kept[address] = { at: entry.at, value: entry.value }
  })
  writeStored(ECONOMICS_KEY, JSON.stringify(kept))
}

const knownStorageInfo = (address: string): ContractStorageInfo | undefined => {
  mirror()
  const value = economicsByAddress.get(address)?.value
  return value && { bagId: value.bagId, fileSize: value.fileSize }
}

export const peekEconomics = (address: string, now = Date.now()): ContractEconomics | undefined => {
  mirror()
  const known = economicsByAddress.get(address)
  return known?.value !== undefined && now - known.at < ECONOMICS_TTL_MS ? known.value : undefined
}

interface EconomicsRead {
  fetcher?: typeof fetchEconomics
  now?: number
  maxAge?: number
}

export const getEconomics = (
  address: string,
  { fetcher = fetchEconomics, now = Date.now(), maxAge = ECONOMICS_TTL_MS }: EconomicsRead = {},
): Promise<ContractEconomics> => {
  mirror()
  const known = economicsByAddress.get(address)
  if (known?.value !== undefined && now - known.at < maxAge) return Promise.resolve(known.value)
  if (known?.promise) return known.promise

  const promise = fetcher(address)
    .then((value) => {
      if (value.fileSize > 0) {
        economicsByAddress.set(address, { at: Date.now(), value })
        persistEconomics()
      } else {
        economicsByAddress.delete(address)
      }
      return value
    })
    .catch((failure: unknown) => {
      economicsByAddress.set(address, { at: known?.at ?? 0, value: known?.value })
      throw failure
    })

  economicsByAddress.set(address, { at: known?.at ?? 0, value: known?.value, promise })
  return promise
}

export const dropEconomics = (address: string): void => {
  mirror()
  economicsByAddress.delete(address)
  persistEconomics()
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
  wipeStored([THEME_KEY, LANGUAGE_KEY, PENDING_PAID_KEY])
  resetContractCachesForTests()
}

export const resetContractCachesForTests = (): void => {
  economicsByAddress.clear()
  statusesByAddress.clear()
  statusesInFlight.clear()
  mirrored = false
}

interface ContractData {
  economics: ContractEconomics | null
  statuses: ContractStatus[]
  unreadable: boolean
  offline: boolean
  retry: () => void
}

export const useContractData = (address: string, withStatuses = false): ContractData => {
  const [economics, setEconomics] = useState<ContractEconomics | null>(null)
  const [statuses, setStatuses] = useState<ContractStatus[]>([])
  const [unreadable, setUnreadable] = useState(false)
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    const shown = peekEconomics(address)
    setEconomics(shown ?? null)
    setStatuses(withStatuses ? peekStatuses(address) : [])
    setUnreadable(false)
    setOffline(false)

    getEconomics(address, { maxAge: ECONOMICS_FRESH_MS })
      .then((read) => {
        if (controller.signal.aborted) return
        if (read.fileSize === 0) {
          setUnreadable(true)
          return
        }
        setEconomics(read)
      })
      .catch(() => {
        if (controller.signal.aborted || shown !== undefined) return
        setOffline(true)
      })

    if (withStatuses) {
      getStatuses([address], controller.signal)
        .then(() => {
          if (!controller.signal.aborted) setStatuses(peekStatuses(address))
        })
        .catch(() => undefined)
    }

    return () => controller.abort()
  }, [address, withStatuses, attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  return { economics, statuses, unreadable, offline, retry }
}
