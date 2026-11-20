import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DAY, freeBytes, GIB, NANO, type Provider } from "@myton/ui/domain"
import { failureStatus, fetchProviders } from "./api"
import { nowSeconds } from "./format"
import { MAX_SELECTED } from "./pricing"

export interface ProviderFilters {
  countries: string[]
  ratingMin: number | null
  ratingMax: number | null
  priceMin: number | null
  priceMax: number | null
}

export type Diversity = "differentCountries" | "any"

export const NO_FILTERS: ProviderFilters = {
  countries: [],
  ratingMin: null,
  ratingMax: null,
  priceMin: null,
  priceMax: null,
}

// The list starts where mytonprovider.org's catalogue filter starts, by the owner's choice; the automatic pick asks for more
export const MIN_UPTIME = 20

const MIN_AUTOPICK_UPTIME = 50

export const ONLINE_WINDOW_SECONDS = 300

const MIN_PROVEN_DAYS = 30

const CATALOG_MAX_AGE_SECONDS = 300

const CATALOG_TICK_MS = 60_000

const SHORTLIST_WIDTH = 2

const SPACE_FULL_SCORE = 2000 * GIB

export const hasFilters = (filters: ProviderFilters): boolean =>
  filters.countries.length > 0 ||
  filters.ratingMin != null ||
  filters.ratingMax != null ||
  filters.priceMin != null ||
  filters.priceMax != null

const priceInTon = (provider: Provider): number => (provider.price || 0) / NANO

const PRICE_DIGITS = 2

const shownPrice = (provider: Provider): number => Number(priceInTon(provider).toFixed(PRICE_DIGITS))

export const spanAllows = (provider: Provider, proofDays: number): boolean => {
  const span = Math.round(proofDays * DAY)
  if (!provider.maxSpan) return false
  const lowest = provider.minSpan ?? 0

  return span >= lowest && span <= provider.maxSpan
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

  const price = shownPrice(provider)
  if (filters.priceMin != null && price < filters.priceMin) return false
  if (filters.priceMax != null && price > filters.priceMax) return false

  return true
}

export const onlineSince = (list: Provider[]): number =>
  list.reduce((newest, provider) => Math.max(newest, provider.lastOnlineAt ?? 0), 0) - ONLINE_WINDOW_SECONDS

const canHostBag = (provider: Provider, bagSize: number, since: number): boolean => {
  if ((provider.uptime || 0) <= MIN_UPTIME) return false
  if ((provider.lastOnlineAt ?? 0) < since) return false

  const free = freeBytes(provider)
  if (free == null || free === 0) return false
  if (free < bagSize) return false
  const bagCap = provider.maxBagBytes ?? 0
  if (bagCap > 0 && bagSize > bagCap) return false

  return true
}

const matchesApartFromSpan = (
  provider: Provider,
  filters: ProviderFilters,
  query: string,
  bagSize: number,
  since: number,
): boolean => matchesQuery(provider, query) && withinFilters(provider, filters) && canHostBag(provider, bagSize, since)

export const matches = (
  provider: Provider,
  filters: ProviderFilters,
  proofDays: number,
  query: string,
  bagSize = 0,
  since = 0,
): boolean => matchesApartFromSpan(provider, filters, query, bagSize, since) && spanAllows(provider, proofDays)

export const countSpanMismatched = (
  all: Provider[],
  filters: ProviderFilters,
  proofDays: number,
  bagSize = 0,
): number => {
  const since = onlineSince(all)
  return all.filter((provider) => matchesApartFromSpan(provider, filters, "", bagSize, since) && !spanAllows(provider, proofDays)).length
}

export const hostingPool = (catalog: Provider[], proofDays: number | null, bagSize: number, filters = NO_FILTERS): Provider[] => {
  const since = onlineSince(catalog)
  return catalog.filter((provider) =>
    proofDays === null
      ? matchesApartFromSpan(provider, filters, "", bagSize, since)
      : matches(provider, filters, proofDays, "", bagSize, since),
  )
}

export const countMatching = (all: Provider[], filters: ProviderFilters, proofDays: number, bagSize = 0): number =>
  hostingPool(all, proofDays, bagSize, filters).length

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

const uptimeScore = (provider: Provider, ratingMax: number): number => {
  const uptime = Math.max(0, Math.min(100, provider.uptime || 0)) / 100
  const rating = Math.max(0, Math.min(1, (provider.rating || 0) / (ratingMax || 1)))

  return uptime * 0.7 + rating * 0.3
}

const provenEnough = (provider: Provider): boolean =>
  (provider.workingTime || 0) >= MIN_PROVEN_DAYS * DAY

const providerScore = (provider: Provider, priceMax: number, ratingMax: number): number => {
  const rating = Math.max(0, Math.min(1, (provider.rating || 0) / (ratingMax || 1)))
  const uptime = Math.max(0, Math.min(100, provider.uptime || 0)) / 100
  const price = 1 - Math.min(1, priceInTon(provider) / (priceMax || 1))
  const space = Math.min(1, (freeBytes(provider) ?? 0) / SPACE_FULL_SCORE)

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

// The uptime floor comes first, so the healthy-or-all fallback weighs only the providers the pick may take
export const autopickPool = (list: Provider[]): Provider[] =>
  eligibleFor(list.filter((provider) => (provider.uptime || 0) > MIN_AUTOPICK_UPTIME))

export type PickCriterion = "score" | "price" | "uptime"

interface PickOptions {
  count: number
  diversity: Diversity
  priceMax: number
  ratingMax: number
  criterion?: PickCriterion
  proven?: boolean
  seed?: number
}

export const freshSeed = (): number => Math.floor(Math.random() * 0xffffffff) + 1

const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const shuffled = (list: Provider[], random: () => number): Provider[] => {
  const deck = [...list]
  for (let at = deck.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1))
    ;[deck[at], deck[swap]] = [deck[swap], deck[at]]
  }
  return deck
}

const orderedFor = (pool: Provider[], options: PickOptions): Provider[] => {
  const { criterion = "score", priceMax, ratingMax, count, seed = 0 } = options

  const scoreOf = (provider: Provider) => {
    if (criterion === "price") return -priceInTon(provider)
    if (criterion === "uptime") return uptimeScore(provider, ratingMax)

    return providerScore(provider, priceMax, ratingMax)
  }

  const ranked = [...pool].sort((a, b) => scoreOf(b) - scoreOf(a))
  if (!seed) return ranked

  const shortlist = Math.min(ranked.length, count * SHORTLIST_WIDTH)
  return [...shuffled(ranked.slice(0, shortlist), seeded(seed)), ...ranked.slice(shortlist)]
}

export const pickBest = (list: Provider[], options: PickOptions): string[] => {
  const base = autopickPool(list)
  if (!base.length) return []

  const want = Math.min(options.count, MAX_SELECTED, base.length)
  const seasoned = options.proven ? base.filter(provenEnough) : base
  const pool = seasoned.length >= want ? seasoned : base
  const ordered = orderedFor(pool, options)
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

export const pickReplacements = (
  catalog: Provider[],
  { skip, count, proofDays, bagSize, seed }: { skip: string[]; count: number; proofDays: number | null; bagSize: number; seed?: number },
): string[] => {
  const skipped = new Set(skip.map((key) => key.toLowerCase()))
  const pool = hostingPool(catalog, proofDays, bagSize).filter((provider) => !skipped.has(provider.pubkey.toLowerCase()))
  return pickBest(pool, {
    count,
    criterion: "uptime",
    diversity: "any",
    proven: true,
    priceMax: priceCeiling(catalog),
    ratingMax: ratingCeiling(catalog),
    seed,
  })
}

export const mergeManual = (fetched: Provider[], manual: Provider[]): Provider[] => {
  const known = new Set(fetched.map((provider) => provider.pubkey.toLowerCase()))
  return [...fetched, ...manual.filter((provider) => !known.has(provider.pubkey.toLowerCase()))]
}

export const stubOf = (pubkey: string): Provider => ({
  pubkey,
  address: null,
  status: null,
  statusRatio: 0,
  reasons: [],
  location: null,
  uptime: 0,
  workingTime: 0,
  rating: 0,
  price: 0,
  minSpan: 0,
  maxSpan: 0,
  maxBagBytes: 0,
  regTime: null,
  lastOnlineAt: null,
  sendsTelemetry: false,
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
  const [fetchedAt, setFetchedAt] = useState(nowSeconds)
  const [attempt, setAttempt] = useState(0)
  const triedAt = useRef(0)

  const load = useCallback((signal: AbortSignal, quiet: boolean) => {
    triedAt.current = nowSeconds()
    if (!quiet) {
      setLoading(true)
      setFailure(null)
    }
    fetchProviders(signal)
      .then((list) => {
        if (signal.aborted) return
        setProviders(list)
        setFetchedAt(nowSeconds())
        setFailure(null)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (signal.aborted || quiet) return
        setFailure({ status: failureStatus(error) })
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal, false)
    return () => controller.abort()
  }, [attempt, load])

  useEffect(() => {
    const controller = new AbortController()
    const tick = (): void => {
      if (document.visibilityState === "visible" && nowSeconds() - triedAt.current >= CATALOG_MAX_AGE_SECONDS) load(controller.signal, true)
    }
    const timer = window.setInterval(tick, CATALOG_TICK_MS)
    document.addEventListener("visibilitychange", tick)

    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [load])

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
