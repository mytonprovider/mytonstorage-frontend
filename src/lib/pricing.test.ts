import { describe, expect, it } from "vitest"
import { DAY, GIB, GRAM } from "@myton/ui/domain"
import { ceilShown, MIB, SHOWN_DIGITS, tonLabel } from "./format"
import {
  CONTRACT_RESERVE,
  FEE_GAS,
  FEE_TOPUP,
  MAX_BAG_BYTES,
  MAX_STORAGE_DAYS,
  MIN_BOUNTY,
  MIN_PROVIDER_BALANCE,
  MIN_STORAGE_DAYS,
  PERIOD_PRESETS,
  PROOF_STEPS,
  commonSpan,
  dailyCost,
  fullBounty,
  gridDays,
  gridFloor,
  gridTop,
  minTopupDays,
  nextPaidDaysLeft,
  offerRates,
  paidDaysLeft,
  paidRounds,
  payoutDays,
  proofPayments,
  providerFate,
  quotedBounties,
  recreateTotal,
  restartBalance,
  roundDays,
  roundQuote,
  storageCost,
  topupForDays,
  unquotedBounties,
  updateFee,
} from "./pricing"
import { base, cheapDutch, offerOf, partial, secondGerman } from "./fixtures"
import type { StorageProvider } from "./ton/storage-data"

// What one proof round of every attached provider costs: the daily rate for the shortest span.
const roundCost = (fileSize: number, providers: Omit<StorageProvider, "pubkey">[]): number =>
  dailyCost(fileSize, providers) * roundDays(providers)

const keysOf = (providers: StorageProvider[]): string[] => providers.map(({ pubkey }) => pubkey)

const attached = (rates: number[], spans: number[], lastProofs: number[] = [], pubkeys: string[] = []): StorageProvider[] =>
  rates.map((ratePerMbDay, at) => ({ pubkey: pubkeys[at] ?? `p${at}`, ratePerMbDay, maxSpan: spans[at] ?? 0, lastProofTime: lastProofs[at] ?? 0 }))

describe("proofPayments", () => {
  it("rounds a partial proof period up to a whole payment", () => {
    expect(proofPayments(28, 7)).toBe(4)
    expect(proofPayments(30, 7)).toBe(5)
  })
})

describe("storageCost", () => {
  it("funds every round the term needs, plus the reserve the chain keeps and the gas of the deploy", () => {
    const offers = [offerOf(3e8)]
    const cost = storageCost(offers, 28, 7)

    expect(cost).toBe(1_225_000_000)
    expect(cost - 3e8 * 4).toBe(CONTRACT_RESERVE + FEE_GAS)
  })

  it("pays every provider its quote once per proof period", () => {
    const quote = 1e8
    expect(storageCost([offerOf(quote), offerOf(quote)], 28, 7)).toBe(825_000_000)
  })

  it("ignores a provider that quoted nothing, in the rounds it funds and in the stagger it buys for the cheapest quote", () => {
    const quote = 1e9

    expect(storageCost([offerOf(quote), offerOf(0)], 28, 7)).toBe(4_025_000_000)
    expect(storageCost([offerOf(quote), offerOf(0)], 7, 7)).toBe(1_025_000_000)
    expect(storageCost([offerOf(quote), offerOf(0)], 7, 7)).toBe(storageCost([offerOf(quote)], 7, 7))
    expect(storageCost([offerOf(MIN_BOUNTY), offerOf(0)], 7, 7)).toBe(105_000_000)
    expect(storageCost([offerOf(2e8), offerOf(MIN_BOUNTY), offerOf(0)], 7, 7)).toBe(305_000_000)
  })

  it("lifts a term cheaper than the intake threshold to the balance the daemon still accepts", () => {
    expect(storageCost([offerOf(1)], 7, 7)).toBe(105_000_000)
    expect(storageCost([], 28, 7)).toBe(105_000_000)
  })

  it("still clears the intake threshold for the provider served last, sizing the surcharge by the cheapest quote", () => {
    const offers = [offerOf(MIN_BOUNTY), offerOf(MIN_BOUNTY), offerOf(MIN_BOUNTY)]
    const cost = storageCost(offers, 7, 7)

    expect(cost).toBe(205_000_000)
    expect(cost - CONTRACT_RESERVE - FEE_GAS - 2 * MIN_BOUNTY).toBeGreaterThanOrEqual(MIN_PROVIDER_BALANCE)
    expect(storageCost([offerOf(2e8), offerOf(MIN_BOUNTY)], 7, 7)).toBe(305_000_000)
  })

  it("adds nothing while every quote on a single round already clears the threshold by itself", () => {
    expect(storageCost([offerOf(1e8), offerOf(1e8)], 7, 7)).toBe(225_000_000)
  })

  it("stops paying for the stagger once the term buys a second round", () => {
    const offers = [offerOf(MIN_BOUNTY), offerOf(MIN_BOUNTY), offerOf(MIN_BOUNTY)]
    const cost = storageCost(offers, 14, 7)

    expect(cost).toBe(325_000_000)
    expect(cost - 2 * 3 * MIN_BOUNTY).toBe(CONTRACT_RESERVE + FEE_GAS)
    expect(cost - CONTRACT_RESERVE - FEE_GAS - 2 * MIN_BOUNTY).toBeGreaterThanOrEqual(MIN_PROVIDER_BALANCE)
  })
})

describe("gridDays", () => {
  const walk = (stepDays: number, floorDays?: number): number[] => {
    const stops = []
    for (let at = gridFloor(stepDays, floorDays); at <= gridTop(stepDays); at += stepDays) stops.push(at)

    return stops
  }

  it("buys exactly the term it shows, on every proof period the catalog offers", () => {
    for (const proofDays of PROOF_STEPS) {
      for (const term of walk(proofDays)) {
        expect(proofPayments(term, proofDays) * proofDays).toBe(term)
        expect(proofPayments(term, proofDays)).toBe(term / proofDays)
      }
    }
  })

  it("keeps every label inside the track, so no tick hangs off its end", () => {
    for (const proofDays of PROOF_STEPS) {
      const stops = walk(proofDays)
      const shown = PERIOD_PRESETS.filter(([preset]) => preset >= stops[0])

      for (const [preset] of shown) expect(preset).toBeLessThanOrEqual(gridTop(proofDays))
    }
  })

  it("snaps a loose day onto the nearest stop and stays between the ends", () => {
    expect(gridDays(30, 7)).toBe(28)
    expect(gridDays(30, 150)).toBe(150)
    expect(gridDays(9999, 7)).toBe(gridTop(7))
    expect(gridDays(1, 7)).toBe(MIN_STORAGE_DAYS)
  })

  it("starts a top-up above the minimum the contract needs, still on the grid", () => {
    const stepDays = 7
    const floorDays = 43

    expect(gridFloor(stepDays, floorDays)).toBe(49)
    expect(gridDays(30, stepDays, floorDays)).toBe(49)
    expect(gridDays(70, stepDays, floorDays)).toBe(70)
  })
})

describe("dailyCost", () => {
  it("charges every provider for the whole bag per day", () => {
    expect(dailyCost(MIB, attached([100, 200], []))).toBe(300)
  })

  it("scales with the size of the bag", () => {
    expect(dailyCost(10 * MIB, attached([100], []))).toBe(1000)
  })

  it("is free while no provider is attached", () => {
    expect(dailyCost(MIB, attached([], []))).toBe(0)
  })
})

describe("paidDaysLeft", () => {
  const rate = 6976
  const week = 7 * DAY
  const perProof = 50_003_968

  it.each([
    ["one bounty", perProof, 7],
    ["two bounties", 2 * perProof, 14],
    ["three and a half bounties", 3.5 * perProof, 21],
    ["a nanoton short of the first bounty", perProof - 1, 0],
    ["a nanoton short of two bounties", 2 * perProof - 1, 7],
    ["a nanoton short of three bounties", 3 * perProof - 1, 14],
    ["four bounties, with no intake threshold held back mid-flight", 4 * perProof, 28],
    ["four bounties less the intake threshold", 4 * perProof - MIN_PROVIDER_BALANCE, 14],
    ["three bounties, the reserve already kept out of the balance by the chain", 3 * perProof, 21],
    ["three bounties less the reserve", 3 * perProof - CONTRACT_RESERVE, 14],
  ])("dates %s on a weekly provider by the check it can no longer pay", (_, balance, days) => {
    expect(paidDaysLeft(GIB, attached([rate], [week]), balance)).toBe(days)
  })

  it("dates a lapsed contract by the check its balance could not pay, not by today", () => {
    const now = 1_790_200_000
    const lateByThreeDays = attached([rate], [week], [now - 10 * DAY])

    expect(paidDaysLeft(GIB, lateByThreeDays, perProof - 1, now)).toBe(-3)
    expect(paidDaysLeft(GIB, lateByThreeDays, perProof, now)).toBe(7)
  })

  it("walks the overdue checks in due order until the balance runs out", () => {
    const now = 1_790_200_000
    const late = attached([rate, rate], [week, week], [now - 11 * DAY, now - 10 * DAY])

    expect(paidDaysLeft(GIB, late, 0, now)).toBe(-4)
    expect(paidDaysLeft(GIB, late, perProof, now)).toBe(-3)
  })

  it("pays a long-span provider its whole bounty inside the horizon, not its daily share of it", () => {
    const quarter = 90 * DAY
    const rates = [rate, 543]
    const spans = [week, quarter]
    const balance = 4 * roundCost(GIB, attached(rates, spans))

    expect(fullBounty(GIB, 543, quarter)).toBe(50_042_880)
    expect(balance).toBe(215_584_768)
    expect(paidDaysLeft(GIB, attached(rates, spans), balance)).toBe(21)
  })

  it("steps the horizon by the shortest span in the set, not by the longest", () => {
    expect(paidDaysLeft(GIB, attached([rate, rate], [week, 2 * week]), 400_031_744)).toBe(28)
  })

  it("still pays a provider whose bounty sits exactly on the minimum, and holds the intake threshold for its restart", () => {
    expect(fullBounty(MIB, MIN_BOUNTY, DAY)).toBe(MIN_BOUNTY)
    expect(paidDaysLeft(MIB, attached([MIN_BOUNTY], [DAY]), MIN_BOUNTY)).toBe(1)
    expect(restartBalance(MIB, attached([MIN_BOUNTY], [DAY]))).toBe(MIN_PROVIDER_BALANCE)
  })

  it("spends nothing on a provider the daemon drops before it ever proves", () => {
    expect(fullBounty(GIB, 1, week)).toBeLessThan(MIN_BOUNTY)
    expect(paidDaysLeft(GIB, attached([rate, 1], [week, week]), 3 * perProof)).toBe(21)
    expect(paidDaysLeft(GIB, attached([rate, 1], [week, DAY]), 3 * perProof)).toBe(21)
  })

  it("names no date at all where no provider is left to take money from the balance", () => {
    expect(paidDaysLeft(GIB, attached([rate], []), 1e9)).toBe(null)
    expect(paidDaysLeft(GIB, attached([0], [week]), 1e9)).toBe(null)
    expect(paidDaysLeft(GIB, attached([1], [week]), 1e9)).toBe(null)
  })

  it("counts from the proof already made, not from now", () => {
    const now = 1_790_000_000
    const halfway = attached([rate], [week], [now - Math.round(week / 2)])

    expect(paidDaysLeft(GIB, halfway, perProof, now)).toBe(10.5)
    expect(paidDaysLeft(GIB, halfway, 2 * perProof, now)).toBe(17.5)
    expect(paidDaysLeft(GIB, halfway, perProof - 1, now)).toBe(3.5)
  })

  it("answers on a balance too large for the search to walk step by step", () => {
    expect(paidDaysLeft(GIB, attached([rate], [week]), 1e18)).toBeGreaterThan(0)
    expect(paidDaysLeft(GIB, attached([rate], [4294967295]), 1e18)).toBeGreaterThan(0)
  })
})

describe("topupForDays", () => {
  const rate = 6976
  const week = 7 * DAY
  const perProof = 50_003_968

  it("asks for every bounty the contract pays out by the day it names", () => {
    expect(topupForDays(GIB, attached([rate], [week]), 0, 7)).toBe(perProof)
    expect(topupForDays(GIB, attached([rate], [week]), 2 * perProof, 7)).toBe(perProof)
  })

  it("rounds the target up to the next check, since the date stands still between two proofs", () => {
    expect(topupForDays(GIB, attached([rate], [week]), 0, 1)).toBe(topupForDays(GIB, attached([rate], [week]), 0, 7))
    expect(topupForDays(GIB, attached([rate], [week]), 0, 8)).toBe(2 * perProof)
  })

  it("counts the extension from today once the contract has lapsed, so no day comes free", () => {
    const now = 1_790_200_000
    const lapsed = attached([rate], [week], [now - 10 * DAY])

    expect(topupForDays(GIB, lapsed, perProof / 2, 1, now)).toBe(perProof / 2)
  })

  it("carries the paid-until date at least as far as the slider asked", () => {
    for (const days of [1, 7, 8, 30, 100, 365]) {
      const cost = topupForDays(GIB, attached([rate], [week]), 3 * perProof, days)

      expect(paidDaysLeft(GIB, attached([rate], [week]), 3 * perProof + cost)).toBeGreaterThanOrEqual(21 + days)
    }
  })

  it("never asks less for a longer date", () => {
    const spans = [week, 90 * DAY]
    let asked = 0

    for (let days = 1; days <= MAX_STORAGE_DAYS; days += 1) {
      const cost = topupForDays(GIB, attached([rate, 543], spans), 3 * perProof, days)

      expect(cost).toBeGreaterThanOrEqual(asked)
      asked = cost
    }
  })

  it("treats a balance in debt as an empty one, asking no more than the bounties ahead", () => {
    expect(paidDaysLeft(GIB, attached([rate], [week]), -perProof)).toBe(0)
    expect(topupForDays(GIB, attached([rate], [week]), -perProof, 7)).toBe(perProof)
  })

  it("asks nothing where no provider takes money at all", () => {
    expect(topupForDays(GIB, attached([1], [week]), 0, 30)).toBe(0)
  })

  it("buys exactly the rounds asked for on a span the chain rounds to a fraction of a day", () => {
    const odd = 90_000
    const rate = 60_000
    const bounty = fullBounty(GIB, rate, odd)
    const asked = (10 * odd) / DAY
    const cost = topupForDays(GIB, attached([rate], [odd]), 0, asked)

    expect(cost).toBe(10 * bounty)
    expect(paidDaysLeft(GIB, attached([rate], [odd]), cost)).toBe(asked)
  })
})

describe("payoutDays", () => {
  const week = 7 * DAY
  const quarter = 90 * DAY
  const rate = 6976

  it("counts the round the contract actually pays, skipping a provider dropped for a low bounty", () => {
    expect(payoutDays(GIB, attached([rate, rate], [week, quarter]))).toBe(7)
    expect(payoutDays(GIB, attached([1, rate], [week, quarter]))).toBe(90)
  })

  it("moves the paid-until date by exactly the step the slider stands on", () => {
    const rates = [1, rate]
    const spans = [week, quarter]
    const step = payoutDays(GIB, attached(rates, spans))
    const balance = 3 * fullBounty(GIB, rate, quarter)
    const paid = paidDaysLeft(GIB, attached(rates, spans), balance) ?? 0

    for (const stops of [1, 2, 4]) {
      const days = gridDays(stops * step, step)
      const cost = topupForDays(GIB, attached(rates, spans), balance, days)

      expect(paidDaysLeft(GIB, attached(rates, spans), balance + cost)).toBe(paid + days)
    }
  })
})

describe("roundDays", () => {
  const day = 86400

  it("takes the shortest span so the promise holds for every provider", () => {
    expect(roundDays(attached([14 * day, 7 * day].map(() => 0), [14 * day, 7 * day]))).toBe(7)
  })

  it("reports zero for a contract with no providers", () => {
    expect(roundDays(attached([].map(() => 0), []))).toBe(0)
  })
})

describe("fullBounty", () => {
  it("pays each recreated demo provider its whole period bounty at once", () => {
    expect(fullBounty(812 * MIB, 200, 7 * DAY)).toBe(1_136_800)
    expect(fullBounty(812 * MIB, 210, 7 * DAY)).toBe(1_193_640)
    expect(fullBounty(812 * MIB, 150, 14 * DAY)).toBe(1_705_200)
  })

  it("floors like the contract muldiv instead of rounding up", () => {
    expect(fullBounty(GIB, 6976, 7 * DAY)).toBe(50_003_968)
    expect(fullBounty(MIB + 1, 100, DAY)).toBe(100)
  })

  it("divides once at the end, so a span the chain holds outside whole days keeps every nanoton", () => {
    expect(fullBounty(16 * MIB, 200, 94_932)).toBe(3516)
    expect(fullBounty(1560 * MIB, 240, 14_277)).toBe(61_867)
    expect(fullBounty(3312 * MIB, 216, 45_400)).toBe(375_912)
    expect(fullBounty(812 * MIB, 200, 600)).toBe(1127)
  })

  it("measures a bag by its bytes, never by whole MiB", () => {
    expect(fullBounty(3_322_896_384, 180, 3_829_760)).toBe(25_284_083)
    expect(fullBounty(3_174_373_023, 248, 6_836_463)).toBe(59_405_608)
    expect(fullBounty(851_443_713, 200, 7 * DAY)).toBe(1_136_800)
  })

  it("stays exact where the bag times the rate times the span outgrows a safe integer", () => {
    expect(fullBounty(2_348_328_819, 183, 12_091_347)).toBe(57_354_965)
    expect(fullBounty(4 * GIB - 4 * MIB, 200, 150 * DAY)).toBe(122_760_000)
    expect(fullBounty(4 * GIB - 4 * MIB, 100_000, 150 * DAY)).toBe(61_380_000_000)
  })
})

describe("paidRounds", () => {
  const rate = 20_000

  it("names only the rounds the balance really covers, the first bounty leaving at once", () => {
    for (const count of [1, 3, 10]) {
      for (const proofDays of PROOF_STEPS) {
        const span = proofDays * DAY
        const bounty = fullBounty(GIB, rate, span)
        const offers = Array.from({ length: count }, () => offerOf(bounty, rate))
        const cost = storageCost(offers, gridDays(30, proofDays), proofDays)
        const shown = paidRounds(cost, roundQuote(offers), 0) * proofDays
        const real = paidDaysLeft(
          GIB,
          attached(
            Array.from({ length: count }, () => rate),
            Array.from({ length: count }, () => span),
          ),
          cost - CONTRACT_RESERVE - FEE_GAS,
        )

        expect(shown).toBe(real)
      }
    }
  })

  it("keeps the reserve and the deploy gas out of the cost and counts only the rounds it pays in full", () => {
    expect(paidRounds(310_000_000, 100_000_000, 9)).toBe(2)
  })

  it("falls back to the counted rounds where the checks came back unpriced", () => {
    expect(paidRounds(1e9, 0, 4)).toBe(4)
  })
})

describe("nextPaidDaysLeft", () => {
  const week = 7 * DAY
  const rate = 20_000
  const contract = attached([rate, rate], [week, 2 * week], [], [base.pubkey, cheapDutch.pubkey])
  const offers = [offerOf(0, rate, base.pubkey), offerOf(0, rate, cheapDutch.pubkey)]
  const balance = 10 * fullBounty(GIB, rate, 2 * week)

  it("puts the whole set on the span being sent, since a survivor is one that already matched it", () => {
    expect(nextPaidDaysLeft(contract, keysOf(contract), 2 * week, offers, GIB, balance, 0)).toBe(
      paidDaysLeft(GIB, attached([rate, rate], [2 * week, 2 * week]), balance),
    )
  })

  it("shortens the date once another provider joins the same balance", () => {
    const grown = [...keysOf(contract), partial.pubkey]
    const withNew = [...offers, offerOf(0, rate, partial.pubkey)]
    const before = nextPaidDaysLeft(contract, keysOf(contract), 2 * week, offers, GIB, balance, 0) ?? 0

    expect(nextPaidDaysLeft(contract, grown, 2 * week, withNew, GIB, balance, 0) ?? 0).toBeLessThan(before)
  })

  it("prices the set by the fresh quote ahead of the rate already on chain", () => {
    const raised = [offerOf(0, 2 * rate, base.pubkey), offerOf(0, 2 * rate, cheapDutch.pubkey)]

    expect(nextPaidDaysLeft(contract, keysOf(contract), 2 * week, raised, GIB, balance, 0)).toBe(
      paidDaysLeft(GIB, attached([2 * rate, 2 * rate], [2 * week, 2 * week]), balance),
    )
  })

  it("falls back to the rate already on chain where the quote says nothing", () => {
    expect(nextPaidDaysLeft(contract, keysOf(contract), 2 * week, null, GIB, balance, 0)).toBe(
      paidDaysLeft(GIB, attached([rate, rate], [2 * week, 2 * week]), balance),
    )
  })

  it("keeps the phase of an untouched provider and resets it for a recreated one", () => {
    const now = 1_800_000_000
    const only = [cheapDutch.pubkey]
    const kept = [offerOf(0, rate, cheapDutch.pubkey)]
    const raised = [offerOf(0, rate * 2, cheapDutch.pubkey)]
    const phased = contract.map((provider, at) => ({ ...provider, lastProofTime: [0, now - week][at] }))

    const untouched = nextPaidDaysLeft(phased, only, 2 * week, kept, GIB, balance, now)
    const unproven = nextPaidDaysLeft(contract, only, 2 * week, kept, GIB, balance, now)

    expect(untouched).toBe((unproven ?? 0) + 7)
    expect(nextPaidDaysLeft(phased, only, 2 * week, raised, GIB, balance, now)).toBeLessThan(untouched ?? 0)
  })

  it("refuses a date while one of the set is still unpriced, rather than counting it as free", () => {
    const grown = [...keysOf(contract), partial.pubkey]

    expect(nextPaidDaysLeft(contract, grown, 2 * week, offers, GIB, balance, 0)).toBeNull()
  })
})

describe("providerFate", () => {
  const week = 7 * DAY
  const contract = attached([200, 210, 150], [week, week, 2 * week], [], [base.pubkey, cheapDutch.pubkey, secondGerman.pubkey])

  it("tells new and removed rows apart before any quote", () => {
    const fates = providerFate(contract, [base.pubkey, partial.pubkey], week, null)

    expect(fates.get(partial.pubkey)).toBe("new")
    expect(fates.get(cheapDutch.pubkey)).toBe("removed")
    expect(fates.get(secondGerman.pubkey)).toBe("removed")
    expect(fates.get(base.pubkey)).toBe("unknown")
  })

  it("keeps only the provider whose offered rate and sent span both match the chain", () => {
    const offers = [offerOf(0, 200, base.pubkey), offerOf(0, 210, cheapDutch.pubkey), offerOf(0, 150, secondGerman.pubkey)]
    const fates = providerFate(contract, keysOf(contract), 2 * week, offers)

    expect(fates.get(secondGerman.pubkey)).toBe("kept")
    expect(fates.get(base.pubkey)).toBe("recreated")
    expect(fates.get(cheapDutch.pubkey)).toBe("recreated")
  })

  it("recreates on a rate change even when the span is untouched", () => {
    expect(providerFate(contract, [base.pubkey], week, [offerOf(0, 201, base.pubkey)]).get(base.pubkey)).toBe("recreated")
    expect(providerFate(contract, [base.pubkey], week, [offerOf(0, 200, base.pubkey)]).get(base.pubkey)).toBe("kept")
  })

  it("matches offer keys the backend upper-cases against lower-case chain keys", () => {
    const fates = providerFate(contract, [base.pubkey.toUpperCase()], week, [offerOf(0, 200, base.pubkey.toUpperCase())])

    expect(fates.get(base.pubkey)).toBe("kept")
  })
})

describe("recreateTotal", () => {
  const week = 7 * DAY
  const contract = attached([200, 210, 150], [week, week, 2 * week], [], [base.pubkey, cheapDutch.pubkey, secondGerman.pubkey])
  const offers = [offerOf(0, 200, base.pubkey), offerOf(0, 210, cheapDutch.pubkey), offerOf(0, 150, secondGerman.pubkey)]

  it("tops up the full new-period bounty of every recreated provider and none of a kept one", () => {
    const fates = providerFate(contract, keysOf(contract), 2 * week, offers)

    expect(recreateTotal(812 * MIB, 2 * week, fates, offerRates(offers))).toBe(2_273_600 + 2_387_280)
  })

  it("charges a freshly added provider its offered rate like the contract will", () => {
    const quoted = [offerOf(0, 175, partial.pubkey)]
    const fates = providerFate(contract, [partial.pubkey], week, quoted)

    expect(recreateTotal(812 * MIB, week, fates, offerRates(quoted))).toBe(994_700)
  })

  it("promises nothing for silent, kept or removed providers", () => {
    const quoted = [offerOf(0, 200, base.pubkey)]
    const fates = providerFate(contract, [base.pubkey, cheapDutch.pubkey], week, quoted)

    expect(fates.get(cheapDutch.pubkey)).toBe("unknown")
    expect(fates.get(secondGerman.pubkey)).toBe("removed")
    expect(recreateTotal(812 * MIB, week, fates, offerRates(quoted))).toBe(0)
  })
})

describe("quotedBounties", () => {
  const week = 7 * DAY
  const offers = [offerOf(0, 200, base.pubkey), offerOf(0, 210, cheapDutch.pubkey), offerOf(0, 150, secondGerman.pubkey)]

  it("funds the next round of every provider in the set, not only the recreated ones", () => {
    expect(quotedBounties(812 * MIB, 2 * week, offerRates(offers))).toBe(2_273_600 + 2_387_280 + 1_705_200)
  })

  it("counts nothing while no quote has come back", () => {
    expect(quotedBounties(812 * MIB, week, offerRates(null))).toBe(0)
  })
})

describe("commonSpan", () => {
  it("takes the period most of the contract already lives on", () => {
    expect(commonSpan(attached([604800, 604800, 1209600].map(() => 0), [604800, 604800, 1209600]))).toBe(604800)
    expect(commonSpan(attached([1209600, 604800, 604800].map(() => 0), [1209600, 604800, 604800]))).toBe(604800)
  })

  it("keeps the first one where nothing prevails, and survives an empty contract", () => {
    expect(commonSpan(attached([604800, 1209600].map(() => 0), [604800, 1209600]))).toBe(604800)
    expect(commonSpan(attached([1209600, 604800].map(() => 0), [1209600, 604800]))).toBe(1209600)
    expect(commonSpan(attached([].map(() => 0), []))).toBe(0)
  })
})

describe("updateFee", () => {
  it("charges the gas alone while the balance on the contract already covers the bounties", () => {
    expect(updateFee(4_035_640, false, 1_200_000_000)).toBe(FEE_GAS)
  })

  it("tops up only what the balance is short of the bounties", () => {
    expect(updateFee(150_000_000, false, 90_000_000)).toBe(80_000_000)
  })

  it("buys the intake threshold only when the set gains a provider", () => {
    expect(updateFee(0, true, 0)).toBe(100_000_000)
    expect(updateFee(0, false, 0)).toBe(FEE_GAS)
  })

  it("weighs the intake threshold against the bounties instead of adding it on top", () => {
    expect(updateFee(150_000_000, true, 0)).toBe(170_000_000)
  })
})

describe("unquotedBounties", () => {
  const week = 7 * DAY
  const contract = attached([200, 210, 150], [week, week, 2 * week], [], [base.pubkey, cheapDutch.pubkey, secondGerman.pubkey])

  it("prices a set with no quote at the minimum bounty a provider signs up for", () => {
    expect(unquotedBounties(812 * MIB, 2 * week, keysOf(contract), contract)).toBe(3 * MIN_BOUNTY)
    expect(fullBounty(812 * MIB, 210, 2 * week)).toBeLessThan(MIN_BOUNTY)
  })

  it("charges a bag whose chain rate outgrows that minimum what the contract will really pay", () => {
    expect(unquotedBounties(MAX_BAG_BYTES, 150 * DAY, [base.pubkey], contract)).toBe(122_880_000)
  })

  it("still counts a provider the chain never saw, since it will be created with a full bounty", () => {
    expect(unquotedBounties(812 * MIB, week, [partial.pubkey], contract)).toBe(MIN_BOUNTY)
  })

  it("counts nothing for an empty set", () => {
    expect(unquotedBounties(812 * MIB, week, [], contract)).toBe(0)
  })
})

describe("restartBalance", () => {
  const week = 7 * DAY

  it("asks nothing of the three demo providers, none of them coming back at any balance", () => {
    expect(restartBalance(812 * MIB, attached([200, 210, 150], [week, week, 2 * week]))).toBe(0)
  })

  it("counts only the providers the daemon takes back, never lifting a cheap one to the minimum", () => {
    expect(restartBalance(GIB, attached([20_000, 1], [week, week]))).toBe(fullBounty(GIB, 20_000, week))
  })

  it("holds the intake threshold for a single provider whose bounty stays under it", () => {
    expect(fullBounty(GIB, 6976, week)).toBeLessThan(MIN_PROVIDER_BALANCE)
    expect(restartBalance(GIB, attached([6976], [week]))).toBe(MIN_PROVIDER_BALANCE)
  })

  it("bills each provider for its own span, unlike the round the shortest span measures", () => {
    expect(restartBalance(812 * MIB, attached([20_000, 20_000], [week, 2 * week]))).toBe(341_040_000)
    expect(roundCost(812 * MIB, attached([20_000, 20_000], [week, 2 * week]))).toBe(227_360_000)
  })
})

describe("minTopupDays", () => {
  const rate = 6976
  const week = 7 * DAY

  it("starts the slider one check period ahead — the shortest move the date can make", () => {
    expect(minTopupDays(GIB, attached([rate], [week]), 0)).toBe(7)
    expect(minTopupDays(GIB, attached([rate, rate], [week, 2 * week]), 0)).toBe(7)
    expect(minTopupDays(GIB, attached([rate, 543], [2 * week, 90 * DAY]), 0)).toBe(14)
  })

  it("names the shortest move that carries the date past the restart threshold", () => {
    for (const balance of [0, MIN_BOUNTY, 3 * MIN_PROVIDER_BALANCE]) {
      const restart = restartBalance(GIB, attached([rate], [week]))
      const days = minTopupDays(GIB, attached([rate], [week]), balance)
      const covered = paidDaysLeft(GIB, attached([rate], [week]), restart) ?? 0
      const paid = paidDaysLeft(GIB, attached([rate], [week]), balance) ?? 0

      expect(paid + days).toBeGreaterThanOrEqual(covered)
    }
  })

  it("has no minimum where no provider comes back at any balance", () => {
    expect(minTopupDays(GIB, attached([1], [week]), 0)).toBe(0)
  })
})

describe("the top-up a contract is extended with", () => {
  const printed = (nanotons: number): number => Number(tonLabel(nanotons, SHOWN_DIGITS).slice(0, -GRAM.length))
  const week = 7 * DAY

  it("fills the printed total with the printed top-up and the printed fee, on every day the slider offers", () => {
    for (let days = 7; days <= MAX_STORAGE_DAYS; days += 1) {
      const topup = ceilShown(topupForDays(GIB, attached([20_000, 200], [week, week]), 10_000_000, days))

      expect(printed(topup) + printed(FEE_TOPUP)).toBeCloseTo(printed(topup + FEE_TOPUP), 6)
    }
  })
})
