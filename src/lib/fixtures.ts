import { DAY, NANO, toProvider, type CatalogProviderDto, type Provider, type ProviderLocation } from "@myton/ui/domain"
import type { ProviderOffer } from "@/types/bag"
import type { ContractState } from "./contracts-cache"
import type { Translate } from "./format"
import { MIB } from "./format"

export const translate: Translate = (key, options) => {
  const name = Array.isArray(key) ? key[0] : key
  const count = options?.count
  return count === undefined ? name : `${String(count)}${name.slice(name.lastIndexOf("."))}`
}

const apiBase: CatalogProviderDto = {
  pubkey: "aaaa000000000000000000000000000000000000000000000000000000000001",
  address: "EQAaaa000000000000000000000000000000000000000001",
  status: 0,
  status_ratio: 1,
  location: { country: "Germany", city: "Frankfurt" },
  uptime: 99.5,
  working_time: 400 * DAY,
  rating: 4.6,
  price: 2 * NANO,
  min_span: 3600,
  max_span: 90 * DAY,
  max_bag_size_bytes: 8 * 1024 ** 3,
  last_online_check_time: 1785545000,
  is_send_telemetry: true,
  telemetry: { total_provider_space: 2000, used_provider_space: 500 },
  statuses_reason_stats: [{ reason: 0, cnt: 100 }],
}

const catalogProvider = (dto: CatalogProviderDto): Provider => {
  const provider = toProvider(dto)
  if (provider === null) throw new Error(`fixture ${dto.pubkey} is not a catalog provider`)
  return provider
}

const place = (country: string, city: string): ProviderLocation => ({ country, countryIso: null, city, timeZone: null })

export const base: Provider = catalogProvider(apiBase)

export const withSpace = (total: number, used: number): Provider => ({
  ...base,
  telemetry: base.telemetry && { ...base.telemetry, totalSpaceBytes: total, usedSpaceBytes: used },
})

export const cheapDutch: Provider = {
  ...base,
  pubkey: "bbbb000000000000000000000000000000000000000000000000000000000002",
  location: place("Netherlands", "Amsterdam"),
  rating: 4.1,
  price: 0.8 * NANO,
}

export const secondGerman: Provider = {
  ...base,
  pubkey: "cccc000000000000000000000000000000000000000000000000000000000003",
  location: place("Germany", "Berlin"),
  rating: 3.2,
  price: 3.4 * NANO,
}

export const partial: Provider = {
  ...base,
  pubkey: "dddd000000000000000000000000000000000000000000000000000000000004",
  statusRatio: 0.9,
  reasons: [
    { reason: 0, count: 90 },
    { reason: 401, count: 10 },
  ],
}

export const offline: Provider = {
  ...base,
  pubkey: "eeee000000000000000000000000000000000000000000000000000000000005",
  status: 101,
  statusRatio: 0,
}

export const narrowSpan: Provider = {
  ...base,
  pubkey: "ffff000000000000000000000000000000000000000000000000000000000006",
  minSpan: 30 * DAY,
  maxSpan: 60 * DAY,
}

export const spaceless: Provider = catalogProvider({
  ...apiBase,
  pubkey: "1111000000000000000000000000000000000000000000000000000000000007",
  telemetry: { total_provider_space: 1000, used_provider_space: 1000 },
})

export const providers: Provider[] = [base, cheapDutch, secondGerman, partial, offline, narrowSpan, spaceless]

export const state: ContractState = {
  torrentHash: "0000000000000000000000000000000000000000000000000000000000000001",
  fileSize: MIB,
  balance: 2 * NANO,
  providers: [{ pubkey: base.pubkey, ratePerMbDay: 300, maxSpan: 7 * DAY, lastProofTime: 1785540000 }],
}

export const offerOf = (pricePerProof: number, pricePerMb = 0, key = base.pubkey): ProviderOffer => ({
  price_per_proof: pricePerProof,
  price_per_mb: pricePerMb,
  provider: { key, price_per_mb_day: pricePerMb },
})
