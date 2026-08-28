import type { ApiProvider, Provider } from "@/types/provider"
import type { ProviderOffer } from "@/types/bag"
import { toProvider } from "./api"
import type { ContractEconomics } from "./contracts-cache"
import type { Translate } from "./format"
import { MIB, NANO, SECONDS_IN_DAY } from "./format"

export const translate: Translate = (key, options) => {
  const name = Array.isArray(key) ? key[0] : key
  const count = options?.count
  return count === undefined ? name : `${String(count)}${name.slice(name.lastIndexOf("."))}`
}

const apiBase: ApiProvider = {
  pubkey: "aaaa000000000000000000000000000000000000000000000000000000000001",
  address: "EQAaaa000000000000000000000000000000000000000001",
  status: 0,
  status_ratio: 1,
  location: { country: "Germany", city: "Frankfurt" },
  uptime: 99.5,
  working_time: 400 * SECONDS_IN_DAY,
  rating: 4.6,
  price: 2 * NANO,
  min_span: 3600,
  max_span: 90 * SECONDS_IN_DAY,
  max_bag_size_bytes: 8 * 1024 ** 3,
  last_online_check_time: 1785545000,
  is_send_telemetry: true,
  telemetry: { total_provider_space: 2000, used_provider_space: 500 },
  statuses_reason_stats: [{ reason: 0, cnt: 100 }],
}

export const base: Provider = toProvider(apiBase)

export const cheapDutch: Provider = {
  ...base,
  pubkey: "bbbb000000000000000000000000000000000000000000000000000000000002",
  location: { country: "Netherlands", city: "Amsterdam" },
  rating: 4.1,
  price: 0.8 * NANO,
}

export const secondGerman: Provider = {
  ...base,
  pubkey: "cccc000000000000000000000000000000000000000000000000000000000003",
  location: { country: "Germany", city: "Berlin" },
  rating: 3.2,
  price: 3.4 * NANO,
}

export const partial: Provider = {
  ...base,
  pubkey: "dddd000000000000000000000000000000000000000000000000000000000004",
  status_ratio: 0.9,
  statuses_reason_stats: [
    { reason: 0, cnt: 90 },
    { reason: 401, cnt: 10 },
  ],
}

export const offline: Provider = {
  ...base,
  pubkey: "eeee000000000000000000000000000000000000000000000000000000000005",
  status: 101,
  status_ratio: 0,
}

export const narrowSpan: Provider = {
  ...base,
  pubkey: "ffff000000000000000000000000000000000000000000000000000000000006",
  min_span: 30 * SECONDS_IN_DAY,
  max_span: 60 * SECONDS_IN_DAY,
}

export const spaceless: Provider = toProvider({
  ...apiBase,
  pubkey: "1111000000000000000000000000000000000000000000000000000000000007",
  telemetry: { total_provider_space: 1000, used_provider_space: 1000 },
})

export const providers: Provider[] = [base, cheapDutch, secondGerman, partial, offline, narrowSpan, spaceless]

export const economics: ContractEconomics = {
  bagId: "0000000000000000000000000000000000000000000000000000000000000001",
  fileSize: MIB,
  balance: 2 * NANO,
  ratesPerMibDay: [300],
  pubkeys: [base.pubkey],
  spans: [7 * SECONDS_IN_DAY],
  lastProofs: [1785540000],
  span: 7 * SECONDS_IN_DAY,
}

export const offerOf = (pricePerProof: number, pricePerMb = 0, key = base.pubkey): ProviderOffer => ({
  price_per_proof: pricePerProof,
  price_per_mb: pricePerMb,
  provider: { key, price_per_mb_day: pricePerMb },
})
