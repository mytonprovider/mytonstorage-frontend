import type { ProviderOffer } from "@/types/bag"
import { BYTES_IN_GIB, MIB, SECONDS_IN_DAY } from "./format"

export const CONTRACT_RESERVE = 5e6
export const FEE_GAS = 2e7
export const FEE_TOPUP = 2e7

export const MIN_PROVIDER_BALANCE = 8e7
export const MIN_BOUNTY = 5e7

const ROUND_EPSILON = 1e-6
const SEARCH_TOP = Number.MAX_SAFE_INTEGER / 2

export const MIN_STORAGE_DAYS = 7
export const MAX_STORAGE_DAYS = 730
export const DEFAULT_STORAGE_DAYS = 30
export const DEFAULT_PROOF_DAYS = 7

export const PROOF_PRESETS: Array<[number, string]> = [
  [7, "1w"],
  [14, "2w"],
  [30, "1m"],
  [60, "2m"],
  [90, "3m"],
  [120, "4m"],
  [150, "5m"],
]
export const PROOF_STEPS = PROOF_PRESETS.map(([days]) => days)
export const PERIOD_PRESETS: Array<[number, string]> = [
  [7, "1w"],
  [14, "2w"],
  [30, "1m"],
  [60, "2m"],
  [90, "3m"],
  [180, "6m"],
  [365, "1y"],
  [730, "2y"],
]

export const gridTop = (stepDays: number): number => Math.ceil(MAX_STORAGE_DAYS / stepDays) * stepDays

export const gridFloor = (stepDays: number, floorDays = stepDays): number =>
  Math.ceil(Math.max(floorDays, stepDays) / stepDays) * stepDays

export const gridDays = (days: number, stepDays: number, floorDays = stepDays): number =>
  Math.min(gridTop(stepDays), Math.max(gridFloor(stepDays, floorDays), Math.round(days / stepDays) * stepDays))

export const nearestProofDays = (days: number): number =>
  PROOF_STEPS.reduce((closest, step) => (Math.abs(step - days) < Math.abs(closest - days) ? step : closest))

export const MAX_SELECTED = 10
export const MAX_BAG_BYTES = 4 * BYTES_IN_GIB - 4 * MIB
export const MAX_BAG_FILES = 5000
export const MAX_DESCRIPTION = 100

export const proofPayments = (storageDays: number, proofDays: number): number =>
  Math.max(1, Math.ceil(storageDays / Math.max(1, proofDays)))

const namedQuotes = (offers: ProviderOffer[]): number[] =>
  offers.map((offer) => offer.price_per_proof || 0).filter((quote) => quote > 0)

export const roundQuote = (offers: ProviderOffer[]): number =>
  namedQuotes(offers).reduce((sum, quote) => sum + quote, 0)

const intakeGap = (offers: ProviderOffer[], rounds: number): number => {
  if (rounds > 1) return 0

  const cheapest = namedQuotes(offers).reduce((least, quote) => Math.min(least, quote), MIN_PROVIDER_BALANCE)

  return MIN_PROVIDER_BALANCE - cheapest
}

export const storageCost = (offers: ProviderOffer[], storageDays: number, proofDays: number): number => {
  const rounds = proofPayments(storageDays, proofDays)
  const checksCost = roundQuote(offers) * rounds

  return CONTRACT_RESERVE + Math.max(MIN_PROVIDER_BALANCE, checksCost + intakeGap(offers, rounds)) + FEE_GAS
}

export const paidRounds = (cost: number, roundBounties: number, unpriced: number): number =>
  roundBounties > 0 ? Math.floor((cost - CONTRACT_RESERVE - FEE_GAS) / roundBounties) : unpriced

export const dailyCost = (fileSize: number, ratesPerMibDay: number[]): number =>
  ratesPerMibDay.reduce((sum, rate) => sum + (fileSize * rate) / MIB, 0)

export const proofDelays = (spans: number[], lastProofs: number[], now: number): number[] =>
  spans.map((span, at) => (lastProofs[at] ? Math.max(0, lastProofs[at] + span - now) : 0))

const spending = (fileSize: number, ratesPerMibDay: number[], spans: number[], delays: number[] = []) => {
  const paying = spans
    .map((span, at) => ({ span, delay: delays[at] ?? 0, bounty: fullBounty(fileSize, ratesPerMibDay[at] ?? 0, span) }))
    .filter(({ bounty }) => bounty >= MIN_BOUNTY)

  const dueAfter = (seconds: number): number =>
    Math.min(
      ...paying.map(({ span, delay }) =>
        seconds < delay ? delay : delay + (Math.floor((seconds - delay) / span) + 1) * span,
      ),
    )

  return {
    first: paying.length ? Math.min(...paying.map(({ delay }) => delay)) : 0,
    last: paying.length ? Math.max(...paying.map(({ delay }) => delay)) : 0,
    round: paying.length ? Math.min(...paying.map(({ span }) => span)) : 0,
    fastest: paying.reduce((burn, { span, bounty }) => Math.max(burn, bounty / span), 0),
    spent: (seconds: number): number =>
      paying.reduce(
        (sum, { span, delay, bounty }) =>
          sum + (seconds >= delay ? (Math.floor((seconds - delay) / span) + 1) * bounty : 0),
        0,
      ),
    dueAfter,
  }
}

export const paidDaysLeft = (
  fileSize: number,
  ratesPerMibDay: number[],
  spans: number[],
  balance: number,
  delays: number[] = [],
): number | null => {
  const { first, last, round, fastest, spent, dueAfter } = spending(fileSize, ratesPerMibDay, spans, delays)
  if (round <= 0) return null

  const left = Math.max(0, balance)
  if (spent(first) > left) return first / SECONDS_IN_DAY

  let lo = first
  let over = Math.min(SEARCH_TOP, last + Math.floor(left / fastest) + round)
  while (over - lo > 1) {
    const mid = Math.floor((lo + over) / 2)
    if (spent(mid) <= left) lo = mid
    else over = mid
  }

  return dueAfter(lo) / SECONDS_IN_DAY
}

export const topupForDays = (
  fileSize: number,
  ratesPerMibDay: number[],
  spans: number[],
  balance: number,
  days: number,
  delays: number[] = [],
): number => {
  const { round, spent } = spending(fileSize, ratesPerMibDay, spans, delays)
  if (round <= 0) return 0

  const paid = paidDaysLeft(fileSize, ratesPerMibDay, spans, balance, delays) ?? 0
  return Math.max(0, spent((paid + days) * SECONDS_IN_DAY - ROUND_EPSILON) - Math.max(0, balance))
}

export const payoutDays = (fileSize: number, ratesPerMibDay: number[], spans: number[]): number =>
  spending(fileSize, ratesPerMibDay, spans).round / SECONDS_IN_DAY

export const roundCost = (fileSize: number, ratesPerMibDay: number[], spans: number[]): number =>
  dailyCost(fileSize, ratesPerMibDay) * roundDays(spans)

export const roundDays = (spans: number[]): number =>
  spans.length ? Math.min(...spans) / SECONDS_IN_DAY : 0

export const fullBounty = (fileSize: number, ratePerMibDay: number, spanSeconds: number): number =>
  Number((BigInt(fileSize) * BigInt(ratePerMibDay) * BigInt(spanSeconds)) / BigInt(SECONDS_IN_DAY * MIB))

export const restartBalance = (fileSize: number, ratesPerMibDay: number[], spans: number[]): number => {
  const returning = ratesPerMibDay
    .map((rate, at) => fullBounty(fileSize, rate, spans[at] ?? 0))
    .filter((bounty) => bounty >= MIN_BOUNTY)

  return returning.length
    ? Math.max(MIN_PROVIDER_BALANCE, returning.reduce((sum, bounty) => sum + bounty, 0))
    : 0
}

export const minTopupDays = (fileSize: number, ratesPerMibDay: number[], spans: number[], balance: number): number => {
  const { round } = spending(fileSize, ratesPerMibDay, spans)
  if (round <= 0) return 0

  const paid = paidDaysLeft(fileSize, ratesPerMibDay, spans, balance) ?? 0
  const covered = paidDaysLeft(fileSize, ratesPerMibDay, spans, restartBalance(fileSize, ratesPerMibDay, spans)) ?? 0

  return Math.max(round / SECONDS_IN_DAY, covered - paid)
}

export const offerRates = (offers: ProviderOffer[] | null): Map<string, number> =>
  new Map((offers ?? []).map((offer) => [offer.provider.key.toLowerCase(), offer.price_per_mb]))

export type ProviderFate = "new" | "removed" | "kept" | "recreated" | "unknown"

export const recreateTotal = (
  fileSize: number,
  spanSeconds: number,
  fates: Map<string, ProviderFate>,
  offeredRates: Map<string, number>,
): number =>
  [...fates.entries()]
    .filter(([, fate]) => fate === "new" || fate === "recreated")
    .reduce((sum, [key]) => sum + fullBounty(fileSize, offeredRates.get(key) ?? 0, spanSeconds), 0)

export const quotedBounties = (fileSize: number, spanSeconds: number, offeredRates: Map<string, number>): number =>
  [...offeredRates.values()].reduce((sum, rate) => sum + fullBounty(fileSize, rate, spanSeconds), 0)

export const updateFee = (bounties: number, added: boolean, balance: number): number =>
  FEE_GAS + Math.max(0, Math.max(added ? MIN_PROVIDER_BALANCE : 0, bounties) - balance)

export interface OnchainProviders {
  pubkeys: string[]
  ratesPerMibDay: number[]
  spans: number[]
  lastProofs?: number[]
}

export const providerFate = (
  onchain: OnchainProviders,
  selected: string[],
  spanSeconds: number,
  offers: ProviderOffer[] | null,
): Map<string, ProviderFate> => {
  const attachedAt = new Map(onchain.pubkeys.map((key, at) => [key.toLowerCase(), at]))
  const offeredRates = offerRates(offers)
  const fates = new Map<string, ProviderFate>()

  selected.forEach((key) => {
    const lower = key.toLowerCase()
    const at = attachedAt.get(lower)
    if (at === undefined) {
      fates.set(lower, "new")
      return
    }
    const rate = offeredRates.get(lower)
    if (typeof rate !== "number") {
      fates.set(lower, "unknown")
      return
    }
    fates.set(lower, rate === onchain.ratesPerMibDay[at] && spanSeconds === onchain.spans[at] ? "kept" : "recreated")
  })

  onchain.pubkeys.forEach((key) => {
    const lower = key.toLowerCase()
    if (!fates.has(lower)) fates.set(lower, "removed")
  })

  return fates
}

export const nextPaidDaysLeft = (
  onchain: OnchainProviders,
  selected: string[],
  spanSeconds: number,
  offers: ProviderOffer[] | null,
  fileSize: number,
  balance: number,
  now: number,
): number | null => {
  const offeredRates = offerRates(offers)
  const attachedAt = new Map(onchain.pubkeys.map((key, at) => [key.toLowerCase(), at]))
  const chainRates = new Map(onchain.pubkeys.map((key, at) => [key.toLowerCase(), onchain.ratesPerMibDay[at]]))
  const fates = providerFate(onchain, selected, spanSeconds, offers)
  const rates = selected.map((key) => offeredRates.get(key.toLowerCase()) ?? chainRates.get(key.toLowerCase()) ?? 0)
  if (rates.some((rate) => rate <= 0)) return null

  const delays = selected.map((key) => {
    const lower = key.toLowerCase()
    const at = attachedAt.get(lower)
    const lastProof = at === undefined ? 0 : (onchain.lastProofs?.[at] ?? 0)
    if (fates.get(lower) !== "kept" || !lastProof) return 0

    return Math.max(0, lastProof + spanSeconds - now)
  })

  return paidDaysLeft(fileSize, rates, selected.map(() => spanSeconds), balance, delays)
}

export const unquotedBounties = (
  fileSize: number,
  spanSeconds: number,
  selected: string[],
  onchain: OnchainProviders,
): number => {
  const rates = new Map(onchain.pubkeys.map((key, at) => [key.toLowerCase(), onchain.ratesPerMibDay[at]]))

  return selected.reduce(
    (sum, key) => sum + Math.max(MIN_BOUNTY, fullBounty(fileSize, rates.get(key.toLowerCase()) ?? 0, spanSeconds)),
    0,
  )
}
