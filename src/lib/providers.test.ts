import { describe, expect, it } from "vitest"
import type { Provider } from "@/types/provider"
import {
  MIN_AUTOPICK_UPTIME,
  MIN_UPTIME,
  NO_FILTERS,
  bounds,
  countMatching,
  countSpanMismatched,
  declineKeyOf,
  freeSpace,
  matches,
  matchesQuery,
  mergeManual,
  pickBest,
  pubkeyFrom,
  pinnedOf,
  sortProviders,
  spanAllows,
  statusOf,
} from "./providers"
import { base, cheapDutch, narrowSpan, offline, partial, providers, secondGerman, spaceless } from "./fixtures"

describe("freeSpace", () => {
  it("subtracts used space from the reported total, in bytes", () => {
    expect(freeSpace(base)).toBe(1500 * 1024 ** 3)
  })

  it("returns null when telemetry does not report space", () => {
    expect(freeSpace({ ...base, telemetry: null })).toBe(null)
  })
})

describe("spanAllows", () => {
  it("accepts only periods inside the range the provider commits to, bounds included", () => {
    expect(spanAllows(narrowSpan, 7)).toBe(false)
    expect(spanAllows(narrowSpan, 30)).toBe(true)
    expect(spanAllows(narrowSpan, 45)).toBe(true)
    expect(spanAllows(narrowSpan, 60)).toBe(true)
    expect(spanAllows(narrowSpan, 61)).toBe(false)
  })

  it("rejects a provider that declares no maximum span", () => {
    expect(spanAllows({ ...base, max_span: 0 }, 7)).toBe(false)
  })
})

describe("statusOf", () => {
  it("grades a working provider by the share of successful checks", () => {
    expect(statusOf(base).tone).toBe("green")
    expect(statusOf(partial).tone).toBe("yellow")
    expect(statusOf({ ...base, status_ratio: 0.5 }).tone).toBe("red")
  })

  it("maps transport failures to an unavailable provider rather than a bad one", () => {
    expect(statusOf(offline)).toMatchObject({ tone: "gray", key: "unavailable" })
    expect(statusOf({ ...base, status: 203 })).toMatchObject({ tone: "gray", key: "unavailable" })
  })

  it("leaves a failure of the checker itself unknown instead of blaming the provider", () => {
    expect(statusOf({ ...base, status: 104 }).key).toBe("unknown")
    expect(statusOf({ ...base, status: 105 }).key).toBe("unknown")
    expect(statusOf({ ...base, status: 202 }).key).toBe("unknown")
  })

  it("separates a provider that lost the file from one that cannot prove it", () => {
    expect(statusOf({ ...base, status: 301 }).key).toBe("notStored")
    expect(statusOf({ ...base, status: 401 }).key).toBe("noProofs")
  })

  it("reports no data when the provider has never been checked", () => {
    expect(statusOf({ ...base, status: null })).toMatchObject({ tone: "gray", key: "noData", rated: false })
  })
})

describe("matches", () => {
  it("drops a provider whose span excludes the proof period", () => {
    expect(matches(narrowSpan, NO_FILTERS, 7, "")).toBe(false)
  })

  it("filters by country, rating and price", () => {
    expect(matches(base, { ...NO_FILTERS, countries: ["Netherlands"] }, 7, "")).toBe(false)
    expect(matches(base, { ...NO_FILTERS, ratingMin: 4.7 }, 7, "")).toBe(false)
    expect(matches(base, { ...NO_FILTERS, priceMax: 1 }, 7, "")).toBe(false)
    expect(matches(cheapDutch, { ...NO_FILTERS, priceMax: 1 }, 7, "")).toBe(true)
  })

  it("searches the public key case-insensitively", () => {
    expect(matches(base, NO_FILTERS, 7, "AAAA")).toBe(true)
    expect(matches(base, NO_FILTERS, 7, "zzzz")).toBe(false)
  })
})

describe("the catalog floor", () => {
  const GIB = 1024 ** 3

  it("hides a provider whose uptime is at or below the floor", () => {
    expect(matches({ ...base, uptime: MIN_UPTIME }, NO_FILTERS, 7, "")).toBe(false)
    expect(matches({ ...base, uptime: MIN_UPTIME + 0.1 }, NO_FILTERS, 7, "")).toBe(true)
  })

  it("hides a provider with no room left", () => {
    expect(matches(spaceless, NO_FILTERS, 7, "")).toBe(false)
  })

  it("hides a provider that does not report free space", () => {
    expect(matches({ ...base, telemetry: null }, NO_FILTERS, 7, "")).toBe(false)
  })

  it("hides a provider only when its known free space cannot fit the bag", () => {
    const tight = { ...base, telemetry: { total_provider_space_bytes: 10 * GIB, used_provider_space_bytes: 9 * GIB } }
    expect(matches(tight, NO_FILTERS, 7, "", 2 * GIB)).toBe(false)
    expect(matches(tight, NO_FILTERS, 7, "", 1 * GIB)).toBe(true)
  })

  it("hides a provider whose declared bag limit is below the bag", () => {
    expect(matches(base, NO_FILTERS, 7, "", 9 * GIB)).toBe(false)
    expect(matches({ ...base, max_bag_size_bytes: 0 }, NO_FILTERS, 7, "", 9 * GIB)).toBe(true)
  })

  it("keeps a provider whose limits are met exactly", () => {
    expect(matches(base, NO_FILTERS, 7, "", base.max_bag_size_bytes)).toBe(true)
    const exact = { ...base, telemetry: { total_provider_space_bytes: 3 * GIB, used_provider_space_bytes: 1 * GIB } }
    expect(matches(exact, NO_FILTERS, 7, "", 2 * GIB)).toBe(true)
  })
})

describe("declineKeyOf", () => {
  it("maps the known agent refusals to translation keys, whatever the casing and spacing", () => {
    expect(declineKeyOf("not enough space")).toBe("declines.noSpace")
    expect(declineKeyOf("long response time")).toBe("declines.longResponse")
    expect(declineKeyOf("can't fetch rates")).toBe("declines.noRates")
    expect(declineKeyOf("not available")).toBe("declines.notAvailable")
    expect(declineKeyOf("invalid pubkey")).toBe("declines.invalidPubkey")
    expect(declineKeyOf(" NOT ENOUGH SPACE ")).toBe("declines.noSpace")
  })

  it("reads the wrapped agent errors that arrive as raw details", () => {
    expect(declineKeyOf("failed to do request: response deadline exceeded, err: context deadline exceeded")).toBe(
      "declines.longResponse",
    )
    expect(
      declineKeyOf("failed to connect to provider: failed to find storage-provider in dht of ab12: value is not found"),
    ).toBe("declines.unreachable")
    expect(declineKeyOf("failed to do request: failed to parse query response: unexpected tl id")).toBe(
      "declines.noRates",
    )
    expect(declineKeyOf("invalid provider_pubkey length: got 10 want 64 hex chars")).toBe("declines.invalidPubkey")
    expect(declineKeyOf("invalid hex in provider_pubkey: encoding/hex: invalid byte")).toBe("declines.invalidPubkey")
  })

  it("returns null for an unknown reason so the row does not claim a refusal", () => {
    expect(declineKeyOf("connection reset by peer")).toBe(null)
  })
})

describe("countMatching", () => {
  it("counts only providers that could actually take the bag", () => {
    expect(countMatching(providers, NO_FILTERS, 7)).toBe(5)
    expect(countMatching(providers, NO_FILTERS, 45)).toBe(6)
  })

  it("counts an unreachable provider, because availability is shown rather than filtered", () => {
    expect(countMatching([offline], NO_FILTERS, 7)).toBe(1)
  })
})

describe("sortProviders", () => {
  it("orders by the requested field and direction", () => {
    const byPrice = sortProviders([base, cheapDutch, secondGerman], "price", "asc")
    expect(byPrice.map((provider) => provider.pubkey)).toEqual([cheapDutch.pubkey, base.pubkey, secondGerman.pubkey])
  })

  it("compares text fields with localeCompare", () => {
    const byCountry = sortProviders([base, cheapDutch], "location", "asc")
    expect(byCountry[0].pubkey).toBe(base.pubkey)
  })

  it("does not mutate the list it was given", () => {
    const input = [secondGerman, base]
    sortProviders(input, "rating", "desc")
    expect(input[0].pubkey).toBe(secondGerman.pubkey)
  })
})

describe("pickBest", () => {

  it("returns the requested number of providers", () => {
    expect(pickBest([base, cheapDutch, secondGerman], { count: 2, diversity: "any", priceMax: 4, ratingMax: 5 })).toHaveLength(2)
  })

  it("never repeats a country while diversity is on", () => {
    const picked = pickBest([base, secondGerman, cheapDutch], { count: 2, diversity: "differentCountries", priceMax: 4, ratingMax: 5 })
    expect(new Set(picked).size).toBe(2)
    expect(picked).toContain(cheapDutch.pubkey)
  })

  it("tops up beyond distinct countries when asked for more", () => {
    expect(pickBest([base, secondGerman], { count: 5, diversity: "differentCountries", priceMax: 4, ratingMax: 5 })).toHaveLength(2)
  })

  it("gives the same set for the same seed", () => {
    const first = pickBest(providers, { count: 3, diversity: "any", priceMax: 4, ratingMax: 5, seed: 7 })
    const again = pickBest(providers, { count: 3, diversity: "any", priceMax: 4, ratingMax: 5, seed: 7 })
    expect(again).toEqual(first)
  })

  it("reshuffles when the seed changes", () => {
    const sets = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        pickBest(providers, { count: 2, diversity: "any", priceMax: 4, ratingMax: 5, seed }).join(),
      ),
    )
    expect(sets.size).toBeGreaterThan(1)
  })

  it("returns nothing when there is no pool", () => {
    expect(pickBest([], { count: 3, diversity: "any", priceMax: 4, ratingMax: 5 })).toEqual([])
  })
})

describe("the strategy reshuffle", () => {
  const wide = Array.from({ length: 24 }, (_, at) => ({
    ...base,
    pubkey: at.toString(16).padStart(4, "0") + "0".repeat(60),
    rating: 4.8 - at * 0.2,
  }))
  const tail = new Set(wide.slice(12).map((provider) => provider.pubkey))

  it("lets the bottom half of the ranking reach the top picks across seeds", () => {
    const reached = [...Array(20).keys()].some((at) =>
      pickBest(wide, { count: 3, diversity: "any", priceMax: 4, ratingMax: 5, seed: at + 1 }).some((key) =>
        tail.has(key),
      ),
    )
    expect(reached).toBe(true)
  })
})

describe("the autopick uptime floor", () => {
  const pickCheapest = (pool: Provider[]): string[] =>
    pickBest(pool, { count: 1, diversity: "any", criterion: "price", priceMax: 4, ratingMax: 5 })

  it("passes over the cheapest provider when its uptime is below the floor", () => {
    expect(pickCheapest([base, { ...cheapDutch, uptime: 48 }])).toEqual([base.pubkey])
  })

  it("keeps a provider standing exactly on the floor", () => {
    expect(pickCheapest([base, { ...cheapDutch, uptime: MIN_AUTOPICK_UPTIME }])).toEqual([cheapDutch.pubkey])
  })

  it("falls back to the whole pool when nobody clears the floor", () => {
    expect(pickCheapest([{ ...base, uptime: 48 }, { ...cheapDutch, uptime: 30 }])).toEqual([cheapDutch.pubkey])
  })
})

describe("pinnedOf", () => {
  it("keeps the order it was given", () => {
    const rows = pinnedOf([cheapDutch, base], [base.pubkey, cheapDutch.pubkey])
    expect(rows.map((row) => row.pubkey)).toEqual([cheapDutch.pubkey, base.pubkey])
    expect(rows.every((row) => row.provider != null)).toBe(true)
  })

  it("keeps a selected provider the catalog does not know, so it can still be removed", () => {
    const rows = pinnedOf([base], [base.pubkey, "deadbeef"])
    expect(rows.map((row) => row.pubkey)).toEqual([base.pubkey, "deadbeef"])
    expect(rows[1].provider).toBe(null)
  })
})

describe("countSpanMismatched", () => {
  it("counts the providers hidden by the proof period alone", () => {
    expect(countSpanMismatched(providers, NO_FILTERS, 7)).toBe(1)
    expect(countSpanMismatched(providers, NO_FILTERS, 45)).toBe(0)
  })
})

describe("bounds", () => {
  it("snaps the range outwards to the rounding step", () => {
    expect(bounds([1.2, 4.7], 1)).toEqual([1, 5])
  })

  it("widens a degenerate range so the slider stays usable", () => {
    expect(bounds([2, 2], 1)).toEqual([2, 3])
  })

  it("falls back to a unit range when there are no values", () => {
    expect(bounds([], 1)).toEqual([0, 1])
  })
})

describe("pubkeyFrom", () => {
  const key = "ABCDEF0123456789".repeat(4)

  it("accepts a 64-hex key and hands it back lower-cased", () => {
    expect(pubkeyFrom(key)).toBe(key.toLowerCase())
    expect(pubkeyFrom(key.toLowerCase())).toBe(key.toLowerCase())
  })

  it("trims surrounding whitespace before validating", () => {
    expect(pubkeyFrom(`  ${key}\n`)).toBe(key.toLowerCase())
  })

  it("rejects anything that is not exactly 64 hex characters", () => {
    expect(pubkeyFrom("")).toBe(null)
    expect(pubkeyFrom(key.slice(1))).toBe(null)
    expect(pubkeyFrom(`${key}0`)).toBe(null)
    expect(pubkeyFrom(`g${key.slice(1)}`)).toBe(null)
  })
})

describe("mergeManual", () => {
  const manualRaw = { ...cheapDutch, pubkey: cheapDutch.pubkey.toUpperCase(), rating: 0, uptime: 0 }

  it("prefers the fresh catalog entry when both know the key", () => {
    expect(mergeManual([cheapDutch], [manualRaw])).toEqual([cheapDutch])
  })

  it("appends a manual provider the catalog does not list", () => {
    expect(mergeManual([base], [manualRaw])).toEqual([base, manualRaw])
  })

  it("keeps the manual provider through a catalog reload", () => {
    expect(mergeManual([], [manualRaw])).toEqual([manualRaw])
  })
})

describe("matchesQuery", () => {
  it("finds a provider by its full public key whatever the case", () => {
    expect(matchesQuery(base, base.pubkey.toUpperCase())).toBe(true)
  })

  it("matches a key fragment and rejects a foreign key", () => {
    expect(matchesQuery(base, "aaaa")).toBe(true)
    expect(matchesQuery(base, cheapDutch.pubkey)).toBe(false)
  })
})
