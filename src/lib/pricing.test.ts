import { describe, expect, it } from "vitest"
import { ceilShown, GRAM, MIB, SECONDS_IN_DAY, SHOWN_DIGITS, tonLabel } from "./format"
import {
  CONTRACT_RESERVE,
  DEFAULT_PROOF_DAYS,
  DEFAULT_STORAGE_DAYS,
  FEE_GAS,
  FEE_TOPUP,
  MAX_BAG_BYTES,
  MAX_STORAGE_DAYS,
  MIN_BOUNTY,
  MIN_PROVIDER_BALANCE,
  MIN_STORAGE_DAYS,
  PERIOD_PRESETS,
  PROOF_STEPS,
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
  roundCost,
  roundDays,
  roundQuote,
  storageCost,
  topupForDays,
  unquotedBounties,
  updateFee,
} from "./pricing"
import { base, cheapDutch, offerOf, partial, secondGerman } from "./fixtures"

const GIB = 1024 ** 3

describe("proofPayments", () => {
  it("rounds a partial proof period up to a whole payment", () => {
    expect(proofPayments(28, 7)).toBe(4)
    expect(proofPayments(30, 7)).toBe(5)
  })

  it("never drops below a single payment", () => {
    expect(proofPayments(1, 7)).toBe(1)
  })
})

describe("storageCost", () => {
  it("funds every round the term needs, plus the reserve the chain keeps and the gas of the deploy", () => {
    const offers = [offerOf(3e8)]
    const cost = storageCost(offers, 28, 7)

    expect(cost).toBe(1_225_000_000)
    expect(cost - 3e8 * 4).toBe(CONTRACT_RESERVE + FEE_GAS)
  })

  it("weighs the intake threshold against the rounds instead of adding it on top", () => {
    const offers = [offerOf(3e8)]

    expect(storageCost(offers, 28, 7) - 3e8 * 4).toBeLessThan(MIN_PROVIDER_BALANCE)
  })

  it("pays every provider its quote once per proof period", () => {
    const quote = 1e8
    expect(storageCost([offerOf(quote), offerOf(quote)], 28, 7)).toBe(825_000_000)
  })

  it("bills only what the contract spends, without a fee providers cover themselves", () => {
    const quote = 1e9
    expect(storageCost([offerOf(quote)], 28, 7)).toBe(4_025_000_000)
  })

  it("ignores a provider that quoted nothing, on a term of four rounds and on one of a single round", () => {
    const quote = 1e9

    expect(storageCost([offerOf(quote), offerOf(0)], 28, 7)).toBe(4_025_000_000)
    expect(storageCost([offerOf(quote), offerOf(0)], 7, 7)).toBe(1_025_000_000)
    expect(storageCost([offerOf(quote), offerOf(0)], 7, 7)).toBe(storageCost([offerOf(quote)], 7, 7))
  })

  it("buys the stagger for the cheapest quote that named a price, never for the one that named none", () => {
    expect(storageCost([offerOf(MIN_BOUNTY), offerOf(0)], 7, 7)).toBe(105_000_000)
    expect(storageCost([offerOf(2e8), offerOf(MIN_BOUNTY), offerOf(0)], 7, 7)).toBe(305_000_000)
  })

  it("lifts a term cheaper than the intake threshold to the balance the daemon still accepts", () => {
    expect(storageCost([offerOf(1)], 7, 7)).toBe(105_000_000)
    expect(storageCost([], 28, 7)).toBe(105_000_000)
  })

  it("asks a week of one raised quote for the 0.105 the pool actually needs", () => {
    expect(storageCost([offerOf(MIN_BOUNTY)], 7, 7)).toBe(105_000_000)
  })

  it("still clears the intake threshold for the provider served after every other took its bounty", () => {
    const offers = [offerOf(MIN_BOUNTY), offerOf(MIN_BOUNTY), offerOf(MIN_BOUNTY)]
    const cost = storageCost(offers, 7, 7)

    expect(cost).toBe(205_000_000)
    expect(cost - CONTRACT_RESERVE - FEE_GAS - 2 * MIN_BOUNTY).toBeGreaterThanOrEqual(MIN_PROVIDER_BALANCE)
  })

  it("sizes that surcharge by the cheapest quote, the one the pool can afford to serve last", () => {
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

  it("reaches past two years rather than stopping short of the last label", () => {
    expect(gridTop(7)).toBeGreaterThanOrEqual(MAX_STORAGE_DAYS)
    expect(gridTop(150)).toBeGreaterThanOrEqual(MAX_STORAGE_DAYS)
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
    expect(dailyCost(MIB, [100, 200])).toBe(300)
  })

  it("scales with the size of the bag", () => {
    expect(dailyCost(10 * MIB, [100])).toBe(1000)
  })

  it("is free while no provider is attached", () => {
    expect(dailyCost(MIB, [])).toBe(0)
  })
})

describe("paidDaysLeft", () => {
  const rate = 6976
  const week = 7 * SECONDS_IN_DAY
  const perProof = 50_003_968

  it("names the check the balance can no longer pay, not the last one it paid", () => {
    expect(paidDaysLeft(GIB, [rate], [week], perProof)).toBe(7)
    expect(paidDaysLeft(GIB, [rate], [week], 2 * perProof)).toBe(14)
    expect(paidDaysLeft(GIB, [rate], [week], 3.5 * perProof)).toBe(21)
  })

  it("keeps the date on a whole check, a part of a bounty buying nothing", () => {
    expect(paidDaysLeft(GIB, [rate], [week], 3 * perProof - 1)).toBe(14)
    expect(paidDaysLeft(GIB, [rate], [week], 2 * perProof - 1)).toBe(7)
  })

  it("spends the whole balance, without the intake threshold the daemon never checks mid-flight", () => {
    expect(paidDaysLeft(GIB, [rate], [week], 4 * perProof)).toBe(28)
    expect(paidDaysLeft(GIB, [rate], [week], 4 * perProof - MIN_PROVIDER_BALANCE)).toBe(14)
  })

  it("counts the boundary round in full, since the chain already kept its reserve out of the balance", () => {
    expect(paidDaysLeft(GIB, [rate], [week], 3 * perProof)).toBe(21)
    expect(paidDaysLeft(GIB, [rate], [week], 3 * perProof - CONTRACT_RESERVE)).toBe(14)
  })

  it("pays a long-span provider its whole bounty inside the horizon, not its daily share of it", () => {
    const quarter = 90 * SECONDS_IN_DAY
    const rates = [rate, 543]
    const spans = [week, quarter]
    const balance = 4 * roundCost(GIB, rates, spans)

    expect(fullBounty(GIB, 543, quarter)).toBe(50_042_880)
    expect(balance).toBe(215_584_768)
    expect(paidDaysLeft(GIB, rates, spans, balance)).toBe(21)
  })

  it("steps the horizon by the shortest span in the set, not by the longest", () => {
    expect(paidDaysLeft(GIB, [rate, rate], [week, 2 * week], 400_031_744)).toBe(28)
  })

  it("spends nothing on a provider the daemon drops before it ever proves", () => {
    expect(fullBounty(GIB, 1, week)).toBeLessThan(MIN_BOUNTY)
    expect(paidDaysLeft(GIB, [rate, 1], [week, week], 3 * perProof)).toBe(21)
    expect(paidDaysLeft(GIB, [rate, 1], [week, SECONDS_IN_DAY], 3 * perProof)).toBe(21)
  })

  it("names no date at all where no provider is left to take money from the balance", () => {
    expect(paidDaysLeft(GIB, [rate], [], 1e9)).toBe(null)
    expect(paidDaysLeft(GIB, [0], [week], 1e9)).toBe(null)
    expect(paidDaysLeft(GIB, [1], [week], 1e9)).toBe(null)
  })

  it("names today where the balance falls short of the very first proof", () => {
    expect(paidDaysLeft(GIB, [rate], [week], perProof - 1)).toBe(0)
  })

  it("counts from the proof already made, not from now", () => {
    const halfway = [Math.round(week / 2)]

    expect(paidDaysLeft(GIB, [rate], [week], perProof, halfway)).toBe(10.5)
    expect(paidDaysLeft(GIB, [rate], [week], 2 * perProof, halfway)).toBe(17.5)
    expect(paidDaysLeft(GIB, [rate], [week], perProof - 1, halfway)).toBe(3.5)
  })

  it("answers on a balance too large for the search to walk step by step", () => {
    expect(paidDaysLeft(GIB, [rate], [week], 1e18)).toBeGreaterThan(0)
    expect(paidDaysLeft(GIB, [rate], [4294967295], 1e18)).toBeGreaterThan(0)
  })
})

describe("topupForDays", () => {
  const rate = 6976
  const week = 7 * SECONDS_IN_DAY
  const perProof = 50_003_968

  it("asks for every bounty the contract pays out by the day it names", () => {
    expect(topupForDays(GIB, [rate], [week], 0, 7)).toBe(perProof)
    expect(topupForDays(GIB, [rate], [week], 2 * perProof, 7)).toBe(perProof)
  })

  it("rounds the target up to the next check, since the date stands still between two proofs", () => {
    expect(topupForDays(GIB, [rate], [week], 0, 1)).toBe(topupForDays(GIB, [rate], [week], 0, 7))
    expect(topupForDays(GIB, [rate], [week], 0, 8)).toBe(2 * perProof)
  })

  it("carries the paid-until date at least as far as the slider asked", () => {
    for (const days of [1, 7, 8, 30, 100, 365]) {
      const cost = topupForDays(GIB, [rate], [week], 3 * perProof, days)

      expect(paidDaysLeft(GIB, [rate], [week], 3 * perProof + cost)).toBeGreaterThanOrEqual(21 + days)
    }
  })

  it("never asks less for a longer date", () => {
    const spans = [week, 90 * SECONDS_IN_DAY]
    let asked = 0

    for (let days = 1; days <= MAX_STORAGE_DAYS; days += 1) {
      const cost = topupForDays(GIB, [rate, 543], spans, 3 * perProof, days)

      expect(cost).toBeGreaterThanOrEqual(asked)
      asked = cost
    }
  })

  it("asks nothing where no provider takes money at all", () => {
    expect(topupForDays(GIB, [1], [week], 0, 30)).toBe(0)
  })

  it("buys exactly the rounds asked for on a span the chain rounds to a fraction of a day", () => {
    const odd = 90_000
    const rate = 60_000
    const bounty = fullBounty(GIB, rate, odd)
    const asked = (10 * odd) / SECONDS_IN_DAY
    const cost = topupForDays(GIB, [rate], [odd], 0, asked)

    expect(cost).toBe(10 * bounty)
    expect(paidDaysLeft(GIB, [rate], [odd], cost)).toBe(asked)
  })
})

describe("payoutDays", () => {
  const week = 7 * SECONDS_IN_DAY
  const quarter = 90 * SECONDS_IN_DAY
  const rate = 6976

  it("counts the round the contract actually pays, skipping a provider dropped for a low bounty", () => {
    expect(payoutDays(GIB, [rate, rate], [week, quarter])).toBe(7)
    expect(payoutDays(GIB, [1, rate], [week, quarter])).toBe(90)
  })

  it("moves the paid-until date by exactly the step the slider stands on", () => {
    const rates = [1, rate]
    const spans = [week, quarter]
    const step = payoutDays(GIB, rates, spans)
    const balance = 3 * fullBounty(GIB, rate, quarter)
    const paid = paidDaysLeft(GIB, rates, spans, balance) ?? 0

    for (const stops of [1, 2, 4]) {
      const days = gridDays(stops * step, step)
      const cost = topupForDays(GIB, rates, spans, balance, days)

      expect(paidDaysLeft(GIB, rates, spans, balance + cost)).toBe(paid + days)
    }
  })

  it("leaves nothing to pay out where every bounty sits under the floor", () => {
    expect(payoutDays(GIB, [1], [week])).toBe(0)
  })
})

describe("roundCost", () => {
  const day = 86400

  it("prices one proof round of every attached provider", () => {
    expect(roundCost(MIB, [100, 200], [7 * day, 7 * day])).toBe(2100)
  })

  it("bills the daily rate of every provider for the shortest span the round lasts", () => {
    expect(roundCost(MIB, [100, 100], [7 * day, 14 * day])).toBe(1400)
  })

  it("prices the demo round by the chain's real burn rate, not each provider's own span", () => {
    expect(roundCost(812 * MIB, [200, 210, 150], [7 * day, 7 * day, 14 * day])).toBe(3_183_040)
  })
})

describe("roundDays", () => {
  const day = 86400

  it("takes the shortest span so the promise holds for every provider", () => {
    expect(roundDays([14 * day, 7 * day])).toBe(7)
  })

  it("reports zero for a contract with no providers", () => {
    expect(roundDays([])).toBe(0)
  })
})

describe("the bounty the storage contract pays per proof", () => {
  const rate = 6976
  const span = 7 * SECONDS_IN_DAY
  const perProof = 50003968

  it("matches muldiv(file_size * rate_per_mb_day, span, 86400 * 1024 * 1024)", () => {
    expect(fullBounty(GIB, rate, span)).toBe(perProof)
    expect(roundCost(GIB, [rate], [span])).toBe(perProof)
  })

  it("accrues that same bounty spread over the days of the span", () => {
    expect(dailyCost(GIB, [rate])).toBe(perProof / 7)
    expect(dailyCost(GIB, [rate]) * roundDays([span])).toBe(roundCost(GIB, [rate], [span]))
  })

  it("divides by a binary MiB, never by a decimal MB", () => {
    expect(dailyCost(MIB, [rate])).toBe(rate)
    expect(dailyCost(1e6, [rate])).toBeLessThan(rate)
  })

  it("clears the 0.05 TON minimum bounty a provider quotes for", () => {
    expect(perProof).toBeGreaterThanOrEqual(5e7)
    expect(fullBounty(GIB, rate - 1, span)).toBeLessThan(5e7)
  })

  it("funds whole rounds plus the reserve the contract never releases", () => {
    const offers = [offerOf(perProof), offerOf(perProof), offerOf(perProof)]
    const cost = storageCost(offers, 28, 7)

    expect(cost).toBe(625_047_616)
    expect(cost - 3 * perProof * proofPayments(28, 7)).toBeGreaterThanOrEqual(CONTRACT_RESERVE)
  })

  it("covers a period the proof rounds do not divide by paying a whole extra round", () => {
    const offers = [offerOf(perProof), offerOf(perProof), offerOf(perProof)]

    expect(storageCost(offers, 30, 7)).toBe(775_059_520)
    expect(proofPayments(30, 7) * 7).toBe(35)
  })

  it("charges a single provider its own five rounds once they outgrow the intake threshold", () => {
    expect(storageCost([offerOf(perProof)], 30, 7)).toBe(275_019_840)
    expect(perProof * 5).toBeGreaterThan(MIN_PROVIDER_BALANCE)
  })
})

describe("fullBounty", () => {
  it("pays each recreated demo provider its whole period bounty at once", () => {
    expect(fullBounty(812 * MIB, 200, 7 * SECONDS_IN_DAY)).toBe(1_136_800)
    expect(fullBounty(812 * MIB, 210, 7 * SECONDS_IN_DAY)).toBe(1_193_640)
    expect(fullBounty(812 * MIB, 150, 14 * SECONDS_IN_DAY)).toBe(1_705_200)
  })

  it("sums to the 0.0040356 TON the demo contract gifts when all three are recreated", () => {
    const gifted =
      fullBounty(812 * MIB, 200, 7 * SECONDS_IN_DAY) +
      fullBounty(812 * MIB, 210, 7 * SECONDS_IN_DAY) +
      fullBounty(812 * MIB, 150, 14 * SECONDS_IN_DAY)

    expect(gifted).toBe(4_035_640)
  })

  it("reaches 2.8644 TON per provider on a full bag at the daemon default rate", () => {
    expect(fullBounty(4 * GIB - 4 * MIB, 100_000, 7 * SECONDS_IN_DAY)).toBe(2_864_400_000)
  })

  it("floors like the contract muldiv instead of rounding up", () => {
    expect(fullBounty(GIB, 6976, 7 * SECONDS_IN_DAY)).toBe(50_003_968)
    expect(fullBounty(MIB + 1, 100, SECONDS_IN_DAY)).toBe(100)
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
    expect(fullBounty(851_443_713, 200, 7 * SECONDS_IN_DAY)).toBe(1_136_800)
  })

  it("charges the rate a quote raised to the 0.05 TON minimum bounty", () => {
    expect(fullBounty(357_150_720, 13_056, 971_520)).toBe(50_003_426)
    expect(fullBounty(812 * MIB, 4399, 14 * SECONDS_IN_DAY)).toBe(50_007_832)
    expect(fullBounty(357_150_720, 13_056, 971_520)).toBeGreaterThanOrEqual(5e7)
  })

  it("stays exact where the bag times the rate times the span outgrows a safe integer", () => {
    expect(fullBounty(2_348_328_819, 183, 12_091_347)).toBe(57_354_965)
    expect(fullBounty(4 * GIB - 4 * MIB, 200, 150 * SECONDS_IN_DAY)).toBe(122_760_000)
    expect(fullBounty(4 * GIB - 4 * MIB, 100_000, 150 * SECONDS_IN_DAY)).toBe(61_380_000_000)
  })
})

describe("paidRounds", () => {
  const week = 7 * SECONDS_IN_DAY
  const rate = 20_000

  it("names only the rounds the balance really covers, the first bounty leaving at once", () => {
    for (const count of [1, 3, 10]) {
      for (const proofDays of PROOF_STEPS) {
        const span = proofDays * SECONDS_IN_DAY
        const bounty = fullBounty(GIB, rate, span)
        const offers = Array.from({ length: count }, () => offerOf(bounty, rate))
        const cost = storageCost(offers, gridDays(30, proofDays), proofDays)
        const shown = paidRounds(cost, roundQuote(offers), 0) * proofDays
        const real = paidDaysLeft(
          GIB,
          Array.from({ length: count }, () => rate),
          Array.from({ length: count }, () => span),
          cost - CONTRACT_RESERVE - FEE_GAS,
        )

        expect(shown).toBe(real)
      }
    }
  })

  it("falls back to the counted rounds where the checks came back unpriced", () => {
    expect(paidRounds(1e9, 0, 4)).toBe(4)
  })

  it("counts a payment that covers a single bounty as one paid period", () => {
    const bounty = fullBounty(GIB, rate, week)

    expect(paidRounds(CONTRACT_RESERVE + FEE_GAS + bounty, bounty, 9)).toBe(1)
  })
})

describe("nextPaidDaysLeft", () => {
  const week = 7 * SECONDS_IN_DAY
  const rate = 20_000
  const contract = {
    pubkeys: [base.pubkey, cheapDutch.pubkey],
    ratesPerMibDay: [rate, rate],
    spans: [week, 2 * week],
  }
  const offers = [offerOf(0, rate, base.pubkey), offerOf(0, rate, cheapDutch.pubkey)]
  const balance = 10 * fullBounty(GIB, rate, 2 * week)

  it("puts the whole set on the span being sent, since a survivor is one that already matched it", () => {
    expect(nextPaidDaysLeft(contract, contract.pubkeys, 2 * week, offers, GIB, balance, 0)).toBe(
      paidDaysLeft(GIB, [rate, rate], [2 * week, 2 * week], balance),
    )
  })

  it("shortens the date once another provider joins the same balance", () => {
    const grown = [...contract.pubkeys, partial.pubkey]
    const withNew = [...offers, offerOf(0, rate, partial.pubkey)]
    const before = nextPaidDaysLeft(contract, contract.pubkeys, 2 * week, offers, GIB, balance, 0) ?? 0

    expect(nextPaidDaysLeft(contract, grown, 2 * week, withNew, GIB, balance, 0) ?? 0).toBeLessThan(before)
  })

  it("falls back to the rate already on chain where the quote says nothing", () => {
    expect(nextPaidDaysLeft(contract, contract.pubkeys, 2 * week, null, GIB, balance, 0)).toBe(
      paidDaysLeft(GIB, [rate, rate], [2 * week, 2 * week], balance),
    )
  })

  it("says nothing where neither the quote nor the chain names a rate", () => {
    expect(nextPaidDaysLeft(contract, [partial.pubkey], 2 * week, null, GIB, balance, 0)).toBeNull()
  })

  it("keeps the phase of an untouched provider and resets it for a recreated one", () => {
    const now = 1_800_000_000
    const only = [cheapDutch.pubkey]
    const kept = [offerOf(0, rate, cheapDutch.pubkey)]
    const raised = [offerOf(0, rate * 2, cheapDutch.pubkey)]
    const phased = { ...contract, lastProofs: [0, now - week] }

    const untouched = nextPaidDaysLeft(phased, only, 2 * week, kept, GIB, balance, now)
    const unproven = nextPaidDaysLeft(contract, only, 2 * week, kept, GIB, balance, now)

    expect(untouched).toBe((unproven ?? 0) + 7)
    expect(nextPaidDaysLeft(phased, only, 2 * week, raised, GIB, balance, now)).toBeLessThan(untouched ?? 0)
  })

  it("refuses a date while one of the set is still unpriced, rather than counting it as free", () => {
    const grown = [...contract.pubkeys, partial.pubkey]

    expect(nextPaidDaysLeft(contract, grown, 2 * week, offers, GIB, balance, 0)).toBeNull()
  })
})

describe("providerFate", () => {
  const week = 7 * SECONDS_IN_DAY
  const contract = {
    pubkeys: [base.pubkey, cheapDutch.pubkey, secondGerman.pubkey],
    ratesPerMibDay: [200, 210, 150],
    spans: [week, week, 2 * week],
  }

  it("tells new and removed rows apart before any quote", () => {
    const fates = providerFate(contract, [base.pubkey, partial.pubkey], week, null)

    expect(fates.get(partial.pubkey)).toBe("new")
    expect(fates.get(cheapDutch.pubkey)).toBe("removed")
    expect(fates.get(secondGerman.pubkey)).toBe("removed")
    expect(fates.get(base.pubkey)).toBe("unknown")
  })

  it("keeps only the provider whose offered rate and sent span both match the chain", () => {
    const offers = [offerOf(0, 200, base.pubkey), offerOf(0, 210, cheapDutch.pubkey), offerOf(0, 150, secondGerman.pubkey)]
    const fates = providerFate(contract, contract.pubkeys, 2 * week, offers)

    expect(fates.get(secondGerman.pubkey)).toBe("kept")
    expect(fates.get(base.pubkey)).toBe("recreated")
    expect(fates.get(cheapDutch.pubkey)).toBe("recreated")
  })

  it("recreates every shorter-span provider when an untouched save sends max(spans) to all", () => {
    const untouched = Math.max(...contract.spans)
    const offers = [offerOf(0, 200, base.pubkey), offerOf(0, 210, cheapDutch.pubkey), offerOf(0, 150, secondGerman.pubkey)]
    const fates = providerFate(contract, contract.pubkeys, untouched, offers)

    expect(untouched).toBe(2 * week)
    expect(fates.get(base.pubkey)).toBe("recreated")
    expect(fates.get(cheapDutch.pubkey)).toBe("recreated")
    expect(fates.get(secondGerman.pubkey)).toBe("kept")
  })

  it("recreates on a rate change even when the span is untouched", () => {
    expect(providerFate(contract, [base.pubkey], week, [offerOf(0, 201, base.pubkey)]).get(base.pubkey)).toBe("recreated")
    expect(providerFate(contract, [base.pubkey], week, [offerOf(0, 200, base.pubkey)]).get(base.pubkey)).toBe("kept")
  })

  it("leaves a silent provider unknown instead of promising a recreation", () => {
    const fates = providerFate(contract, [base.pubkey, cheapDutch.pubkey], week, [offerOf(0, 200, base.pubkey)])

    expect(fates.get(cheapDutch.pubkey)).toBe("unknown")
  })

  it("matches offer keys the backend upper-cases against lower-case chain keys", () => {
    const fates = providerFate(contract, [base.pubkey.toUpperCase()], week, [offerOf(0, 200, base.pubkey.toUpperCase())])

    expect(fates.get(base.pubkey)).toBe("kept")
  })
})

describe("recreateTotal", () => {
  const week = 7 * SECONDS_IN_DAY
  const contract = {
    pubkeys: [base.pubkey, cheapDutch.pubkey, secondGerman.pubkey],
    ratesPerMibDay: [200, 210, 150],
    spans: [week, week, 2 * week],
  }
  const offers = [offerOf(0, 200, base.pubkey), offerOf(0, 210, cheapDutch.pubkey), offerOf(0, 150, secondGerman.pubkey)]

  it("tops up the full new-period bounty of every recreated provider and none of a kept one", () => {
    const fates = providerFate(contract, contract.pubkeys, 2 * week, offers)

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
  const week = 7 * SECONDS_IN_DAY
  const offers = [offerOf(0, 200, base.pubkey), offerOf(0, 210, cheapDutch.pubkey), offerOf(0, 150, secondGerman.pubkey)]

  it("funds the next round of every provider in the set, not only the recreated ones", () => {
    expect(quotedBounties(812 * MIB, 2 * week, offerRates(offers))).toBe(2_273_600 + 2_387_280 + 1_705_200)
  })

  it("outgrows the bounties of the recreated rows alone by the round of the untouched one", () => {
    const contract = {
      pubkeys: [base.pubkey, cheapDutch.pubkey, secondGerman.pubkey],
      ratesPerMibDay: [200, 210, 150],
      spans: [week, week, 2 * week],
    }
    const fates = providerFate(contract, contract.pubkeys, 2 * week, offers)

    expect(quotedBounties(812 * MIB, 2 * week, offerRates(offers))).toBe(
      recreateTotal(812 * MIB, 2 * week, fates, offerRates(offers)) + 1_705_200,
    )
  })

  it("counts nothing while no quote has come back", () => {
    expect(quotedBounties(812 * MIB, week, offerRates(null))).toBe(0)
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

  it("never asks for less than the gas of the edit, however rich the contract", () => {
    expect(updateFee(150_000_000, true, 1_000_000_000)).toBe(FEE_GAS)
  })
})

describe("unquotedBounties", () => {
  const week = 7 * SECONDS_IN_DAY
  const contract = {
    pubkeys: [base.pubkey, cheapDutch.pubkey, secondGerman.pubkey],
    ratesPerMibDay: [200, 210, 150],
    spans: [week, week, 2 * week],
  }

  it("prices a set with no quote at the minimum bounty a provider signs up for", () => {
    expect(unquotedBounties(812 * MIB, 2 * week, contract.pubkeys, contract)).toBe(3 * MIN_BOUNTY)
    expect(fullBounty(812 * MIB, 210, 2 * week)).toBeLessThan(MIN_BOUNTY)
  })

  it("charges a bag whose chain rate outgrows that minimum what the contract will really pay", () => {
    expect(unquotedBounties(MAX_BAG_BYTES, 150 * SECONDS_IN_DAY, [base.pubkey], contract)).toBe(122_760_000)
  })

  it("still counts a provider the chain never saw, since it will be created with a full bounty", () => {
    expect(unquotedBounties(812 * MIB, week, [partial.pubkey], contract)).toBe(MIN_BOUNTY)
  })

  it("counts nothing for an empty set", () => {
    expect(unquotedBounties(812 * MIB, week, [], contract)).toBe(0)
  })
})

describe("restartBalance", () => {
  const week = 7 * SECONDS_IN_DAY

  it("asks nothing of the three demo providers, none of them coming back at any balance", () => {
    expect(restartBalance(812 * MIB, [200, 210, 150], [week, week, 2 * week])).toBe(0)
  })

  it("counts only the providers the daemon takes back, never lifting a cheap one to the minimum", () => {
    expect(restartBalance(GIB, [20_000, 1], [week, week])).toBe(fullBounty(GIB, 20_000, week))
  })

  it("charges the bounty itself once the chain rate outgrows the minimum", () => {
    expect(restartBalance(MAX_BAG_BYTES, [200, 200, 200], [150 * SECONDS_IN_DAY, 150 * SECONDS_IN_DAY, 150 * SECONDS_IN_DAY])).toBe(368_280_000)
  })

  it("holds the intake threshold for a single provider whose bounty stays under it", () => {
    expect(fullBounty(GIB, 6976, week)).toBeLessThan(MIN_PROVIDER_BALANCE)
    expect(restartBalance(GIB, [6976], [week])).toBe(MIN_PROVIDER_BALANCE)
  })

  it("asks nothing for a contract the chain shows with no provider left", () => {
    expect(restartBalance(812 * MIB, [], [])).toBe(0)
  })

  it("bills each provider for its own span, unlike the round the shortest span measures", () => {
    expect(restartBalance(812 * MIB, [20_000, 20_000], [week, 2 * week])).toBe(341_040_000)
    expect(roundCost(812 * MIB, [20_000, 20_000], [week, 2 * week])).toBe(227_360_000)
  })
})

describe("minTopupDays", () => {
  const rate = 6976
  const week = 7 * SECONDS_IN_DAY

  it("starts the slider one check period ahead — the shortest move the date can make", () => {
    expect(minTopupDays(GIB, [rate], [week], 0)).toBe(7)
    expect(minTopupDays(GIB, [rate, rate], [week, 2 * week], 0)).toBe(7)
    expect(minTopupDays(GIB, [rate, 543], [2 * week, 90 * SECONDS_IN_DAY], 0)).toBe(14)
  })

  it("names the shortest move that carries the date past the restart threshold", () => {
    for (const balance of [0, MIN_BOUNTY, 3 * MIN_PROVIDER_BALANCE]) {
      const restart = restartBalance(GIB, [rate], [week])
      const days = minTopupDays(GIB, [rate], [week], balance)
      const covered = paidDaysLeft(GIB, [rate], [week], restart) ?? 0
      const paid = paidDaysLeft(GIB, [rate], [week], balance) ?? 0

      expect(paid + days).toBeGreaterThanOrEqual(covered)
    }
  })

  it("has no minimum where no provider comes back at any balance", () => {
    expect(minTopupDays(GIB, [1], [week], 0)).toBe(0)
  })
})

describe("the top-up a contract is extended with", () => {
  const printed = (nanotons: number): number => Number(tonLabel(nanotons, SHOWN_DIGITS).slice(0, -GRAM.length))
  const week = 7 * SECONDS_IN_DAY
  const demoRound = roundCost(812 * MIB, [200, 210, 150], [week, week, 2 * week])

  it("fills the printed total with the printed top-up and the printed fee, on every day the slider offers", () => {
    for (let days = 7; days <= MAX_STORAGE_DAYS; days += 1) {
      const topup = ceilShown(topupForDays(GIB, [20_000, 200], [week, week], 10_000_000, days))

      expect(printed(topup) + printed(FEE_TOPUP)).toBeCloseTo(printed(topup + FEE_TOPUP), 6)
    }
  })

  it("sends the wallet no less than the rounds it printed", () => {
    expect(ceilShown(4 * demoRound)).toBe(13_000_000)
    expect(4 * demoRound).toBeLessThanOrEqual(ceilShown(4 * demoRound))
  })

  it("asks the emptied demo contract for no restart round at all, its bounties being below the minimum", () => {
    const missing = restartBalance(812 * MIB, [200, 210, 150], [week, week, 2 * week]) - 90_000_000

    expect(missing).toBeLessThan(0)
  })

  it("still funds the restart of a set the daemon does take back", () => {
    const rates = [20_000, 200]
    const spans = [week, week]
    const restart = restartBalance(GIB, rates, spans)
    const round = roundCost(GIB, rates, spans)
    const missing = restart - 10_000_000
    const rounds = Math.ceil(missing / round)

    expect(restart).toBe(143_360_000)
    expect(rounds).toBe(1)
    expect(ceilShown(rounds * round)).toBeGreaterThanOrEqual(missing)
  })
})

describe("DEFAULT_STORAGE_DAYS", () => {
  it("opens the period slider on a stop the wallet pays for exactly, next to the month label", () => {
    const term = gridDays(DEFAULT_STORAGE_DAYS, DEFAULT_PROOF_DAYS)

    expect(proofPayments(term, DEFAULT_PROOF_DAYS) * DEFAULT_PROOF_DAYS).toBe(term)
    expect(Math.abs(term - DEFAULT_STORAGE_DAYS)).toBeLessThan(DEFAULT_PROOF_DAYS)
  })
})
