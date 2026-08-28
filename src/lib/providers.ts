import { useCallback, useEffect, useMemo, useState } from "react"
import type { Provider } from "@/types/provider"
import type { Tone } from "@/types/tone"
import { failureStatus, fetchProviders } from "./api"
import { BYTES_IN_GIB, NANO, SECONDS_IN_DAY } from "./format"
import { MAX_SELECTED } from "./pricing"

export interface ProviderFilters {
  countries: string[]
  ratingMin: number | null
  ratingMax: number | null
  priceMin: number | null
  priceMax: number | null
}

export type Diversity = "differentCountries" | "any"

export type SortField = "pubkey" | "rating" | "status" | "uptime" | "price" | "freeSpace" | "workingTime" | "location"

export type SortDirection = "asc" | "desc"

interface ProviderStatus {
  tone: Tone
  key: string
  ratio: number
  rated: boolean
}

export const NO_FILTERS: ProviderFilters = {
  countries: [],
  ratingMin: null,
  ratingMax: null,
  priceMin: null,
  priceMax: null,
}

export const MIN_UPTIME = 20

export const MIN_AUTOPICK_UPTIME = 50

const SPACE_FULL_SCORE = 2000 * BYTES_IN_GIB

const UNAVAILABLE = [101, 102, 103, 201, 203]
const NOT_STORED = [301, 302]
const NO_PROOFS = [401, 402, 403]

export const hasFilters = (filters: ProviderFilters): boolean =>
  filters.countries.length > 0 ||
  filters.ratingMin != null ||
  filters.ratingMax != null ||
  filters.priceMin != null ||
  filters.priceMax != null

export const freeSpace = (provider: Provider): number | null => {
  const telemetry = provider.telemetry
  if (!telemetry || telemetry.total_provider_space_bytes == null || telemetry.used_provider_space_bytes == null) {
    return null
  }
  return Math.max(0, telemetry.total_provider_space_bytes - telemetry.used_provider_space_bytes)
}

export const priceInTon = (provider: Provider): number => (provider.price || 0) / NANO

export const spanAllows = (provider: Provider, proofDays: number): boolean => {
  const span = Math.round(proofDays * SECONDS_IN_DAY)
  if (!provider.max_span) return false
  const lowest = provider.min_span ?? 0

  return span >= lowest && span <= provider.max_span
}

export const STATUS_KEYS = [
  "noData",
  "unstable",
  "partial",
  "stable",
  "unavailable",
  "notStored",
  "noProofs",
  "unknown",
] as const

export const statusPercent = (ratio: number): number => Math.floor(ratio * 100)

export const statusOf = (provider: Provider): ProviderStatus => {
  const stats = (provider.statuses_reason_stats ?? []).filter((stat) => stat.cnt > 0)
  const total = stats.reduce((sum, stat) => sum + stat.cnt, 0)
  const valid = stats.find((stat) => stat.reason === 0)?.cnt ?? 0
  const ratio = provider.status_ratio != null ? provider.status_ratio : total ? valid / total : 0

  if (provider.status == null) return { tone: "gray", key: "noData", ratio, rated: false }

  if (provider.status === 0) {
    if (ratio < 0.8) return { tone: "red", key: "unstable", ratio, rated: true }
    if (ratio < 0.99) return { tone: "yellow", key: "partial", ratio, rated: true }
    return { tone: "green", key: "stable", ratio, rated: true }
  }

  if (UNAVAILABLE.includes(provider.status)) return { tone: "gray", key: "unavailable", ratio, rated: false }
  if (NOT_STORED.includes(provider.status)) return { tone: "red", key: "notStored", ratio, rated: false }
  if (NO_PROOFS.includes(provider.status)) return { tone: "orange", key: "noProofs", ratio, rated: false }

  return { tone: "gray", key: "unknown", ratio, rated: false }
}

const PUBKEY = /^[0-9a-fA-F]{64}$/

export const pubkeyFrom = (input: string): string | null => {
  const candidate = input.trim()
  return PUBKEY.test(candidate) ? candidate.toLowerCase() : null
}

export const matchesQuery = (provider: Provider, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  return !needle || provider.pubkey.toLowerCase().includes(needle)
}

const withinFilters = (provider: Provider, filters: ProviderFilters): boolean => {
  const country = provider.location?.country ?? ""
  if (filters.countries.length && !filters.countries.includes(country)) return false

  const rating = provider.rating || 0
  if (filters.ratingMin != null && rating < filters.ratingMin) return false
  if (filters.ratingMax != null && rating > filters.ratingMax) return false

  const price = priceInTon(provider)
  if (filters.priceMin != null && price < filters.priceMin) return false
  if (filters.priceMax != null && price > filters.priceMax) return false

  return true
}

const canHostBag = (provider: Provider, bagSize: number): boolean => {
  if ((provider.uptime || 0) <= MIN_UPTIME) return false

  const free = freeSpace(provider)
  if (free == null || free === 0) return false
  if (free < bagSize) return false
  if (provider.max_bag_size_bytes > 0 && bagSize > provider.max_bag_size_bytes) return false

  return true
}

const matchesApartFromSpan = (
  provider: Provider,
  filters: ProviderFilters,
  query: string,
  bagSize: number,
): boolean => matchesQuery(provider, query) && withinFilters(provider, filters) && canHostBag(provider, bagSize)

export const matches = (
  provider: Provider,
  filters: ProviderFilters,
  proofDays: number,
  query: string,
  bagSize = 0,
): boolean => matchesApartFromSpan(provider, filters, query, bagSize) && spanAllows(provider, proofDays)

export const countSpanMismatched = (
  all: Provider[],
  filters: ProviderFilters,
  proofDays: number,
  bagSize = 0,
): number =>
  all.filter((provider) => matchesApartFromSpan(provider, filters, "", bagSize) && !spanAllows(provider, proofDays)).length

export const countMatching = (all: Provider[], filters: ProviderFilters, proofDays: number, bagSize = 0): number =>
  all.filter((provider) => matches(provider, filters, proofDays, "", bagSize)).length

const DECLINE_KEYS: [string, string][] = [
  ["context deadline exceeded", "declines.longResponse"],
  ["provider_pubkey", "declines.invalidPubkey"],
  ["failed to connect to provider", "declines.unreachable"],
  ["failed to do request", "declines.noRates"],
  ["invalid pubkey", "declines.invalidPubkey"],
  ["long response time", "declines.longResponse"],
  ["can't fetch rates", "declines.noRates"],
  ["not available", "declines.notAvailable"],
  ["not enough space", "declines.noSpace"],
]

export const declineKeyOf = (reason: string): string | null => {
  const text = reason.trim().toLowerCase()
  return DECLINE_KEYS.find(([needle]) => text.includes(needle))?.[1] ?? null
}

export const sortProviders = (list: Provider[], field: SortField, direction: SortDirection): Provider[] => {
  const sign = direction === "asc" ? 1 : -1
  const valueOf = (provider: Provider): string | number => {
    switch (field) {
      case "pubkey":
        return provider.pubkey
      case "location":
        return provider.location?.country ?? ""
      case "price":
        return provider.price || 0
      case "uptime":
        return provider.uptime || 0
      case "workingTime":
        return provider.working_time || 0
      case "freeSpace":
        return freeSpace(provider) ?? -1
      case "status": {
        const status = statusOf(provider)
        return status.rated ? status.ratio : -1
      }
      default:
        return provider.rating || 0
    }
  }

  return [...list].sort((a, b) => {
    const left = valueOf(a)
    const right = valueOf(b)
    return typeof left === "string" ? left.localeCompare(right as string) * sign : (left - (right as number)) * sign
  })
}

const providerScore = (provider: Provider, priceMax: number, ratingMax: number): number => {
  const rating = Math.max(0, Math.min(1, (provider.rating || 0) / (ratingMax || 1)))
  const uptime = Math.max(0, Math.min(100, provider.uptime || 0)) / 100
  const price = 1 - Math.min(1, priceInTon(provider) / (priceMax || 1))
  const space = Math.min(1, (freeSpace(provider) ?? 0) / SPACE_FULL_SCORE)

  return rating * 0.45 + uptime * 0.3 + price * 0.15 + space * 0.1
}

export const priceCeiling = (all: Provider[]): number =>
  Math.ceil(all.reduce((max, provider) => Math.max(max, priceInTon(provider)), 0) * 100) / 100 || 10

export const ratingCeiling = (all: Provider[]): number =>
  all.reduce((max, provider) => Math.max(max, provider.rating || 0), 0) || 1

export interface PinnedProvider {
  pubkey: string
  provider: Provider | null
}

export const pinnedOf = (ordered: Provider[], selected: string[]): PinnedProvider[] => {
  const known = new Set(ordered.map((provider) => provider.pubkey))
  return [
    ...ordered.map((provider) => ({ pubkey: provider.pubkey, provider })),
    ...selected.filter((key) => !known.has(key)).map((pubkey) => ({ pubkey, provider: null })),
  ]
}

export const eligibleFor = (list: Provider[]): Provider[] => {
  const healthy = list.filter((provider) => provider.status === 0)
  return healthy.length ? healthy : list
}

export type PickCriterion = "score" | "price"

interface PickOptions {
  count: number
  diversity: Diversity
  priceMax: number
  ratingMax: number
  criterion?: PickCriterion
  seed?: number
}

const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const tickets = (value: number, low: number, high: number): number =>
  Math.max(1, Math.min(10, Math.floor(((value - low) / (high - low || 1)) * 9) + 1))

const shuffledByWeight = (pool: Provider[], ticketsAt: (rank: number) => number, random: () => number): Provider[] => {
  const deck: Provider[] = []
  pool.forEach((provider, rank) => {
    const count = ticketsAt(rank)
    for (let at = 0; at < count; at++) deck.push(provider)
  })

  for (let at = deck.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1))
    ;[deck[at], deck[swap]] = [deck[swap], deck[at]]
  }

  const seen = new Set<string>()
  const drawn: Provider[] = []
  deck.forEach((provider) => {
    if (seen.has(provider.pubkey)) return
    seen.add(provider.pubkey)
    drawn.push(provider)
  })
  return drawn
}

const orderedFor = (pool: Provider[], options: PickOptions): Provider[] => {
  const { criterion = "score", priceMax, ratingMax, seed = 0 } = options

  const scoreOf = (provider: Provider) =>
    criterion === "price" ? -priceInTon(provider) : providerScore(provider, priceMax, ratingMax)

  const ranked = [...pool].sort((a, b) => scoreOf(b) - scoreOf(a))
  if (!seed) return ranked

  const top = ranked.length - 1
  return shuffledByWeight(ranked, (rank) => tickets(top - rank, 0, top), seeded(seed))
}

export const pickBest = (list: Provider[], options: PickOptions): string[] => {
  const eligible = eligibleFor(list)
  const steady = eligible.filter((provider) => (provider.uptime || 0) >= MIN_AUTOPICK_UPTIME)
  const pool = steady.length ? steady : eligible
  if (!pool.length) return []

  const ordered = orderedFor(pool, options)
  const want = Math.min(options.count, MAX_SELECTED, pool.length)
  const seen = new Set<string>()
  const picked: string[] = []

  ordered.forEach((provider) => {
    if (picked.length >= want) return
    const key = provider.location?.country ?? "?"
    if (options.diversity !== "any" && seen.has(key)) return
    seen.add(key)
    picked.push(provider.pubkey)
  })

  ordered.forEach((provider) => {
    if (picked.length >= want) return
    if (!picked.includes(provider.pubkey)) picked.push(provider.pubkey)
  })

  return picked
}

export const bounds = (values: number[], step: number): [number, number] => {
  const usable = values.filter((value) => Number.isFinite(value))
  if (!usable.length) return [0, 1]

  const low = Math.floor(Math.min(...usable) / step) * step
  const high = Math.ceil(Math.max(...usable) / step) * step
  return [low, high > low ? high : low + step]
}

export const mergeManual = (fetched: Provider[], manual: Provider[]): Provider[] => {
  const known = new Set(fetched.map((provider) => provider.pubkey.toLowerCase()))
  return [...fetched, ...manual.filter((provider) => !known.has(provider.pubkey.toLowerCase()))]
}

export const stubOf = (pubkey: string): Provider => ({
  pubkey,
  address: null,
  status: null,
  status_ratio: 0,
  location: null,
  uptime: 0,
  working_time: 0,
  rating: 0,
  price: 0,
  min_span: 0,
  max_span: 0,
  max_bag_size_bytes: 0,
  last_online_check_time: null,
  is_send_telemetry: false,
  telemetry: null,
})

export interface ProviderCatalog {
  providers: Provider[]
  loading: boolean
  failed: boolean
  status: number | null
  fetchedAt: number
  reload: () => void
  addManual: (provider: Provider) => void
}

export const useProviderCatalog = (): ProviderCatalog => {
  const [providers, setProviders] = useState<Provider[]>([])
  const [manual, setManual] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<{ status: number | null } | null>(null)
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    setLoading(true)
    setFailure(null)
    fetchProviders(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setProviders(list)
        setFetchedAt(Date.now())
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setFailure({ status: failureStatus(error) })
        setLoading(false)
      })

    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  const addManual = useCallback((provider: Provider) => {
    setManual((list) =>
      list.some((known) => known.pubkey.toLowerCase() === provider.pubkey.toLowerCase()) ? list : [...list, provider],
    )
  }, [])

  const merged = useMemo(() => mergeManual(providers, manual), [providers, manual])

  return {
    providers: merged,
    loading,
    failed: failure !== null,
    status: failure?.status ?? null,
    fetchedAt,
    reload,
    addManual,
  }
}
