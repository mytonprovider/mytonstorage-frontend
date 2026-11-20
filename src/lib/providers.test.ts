import { describe, expect, it } from "vitest"
import { GIB } from "@myton/ui/domain"
import {
  MIN_UPTIME,
  NO_FILTERS,
  ONLINE_WINDOW_SECONDS,
  countMatching,
  countSpanMismatched,
  declineKeyOf,
  matches,
  matchesQuery,
  mergeManual,
  onlineSince,
  pickBest,
  pickReplacements,
  pinnedOf,
  spanAllows,
} from "./providers"
import { base, cheapDutch, narrowSpan, offline, providers, secondGerman, spaceless, withSpace } from "./fixtures"

describe("spanAllows", () => {
  it("accepts only periods inside the range the provider commits to, bounds included", () => {
    expect(spanAllows(narrowSpan, 7)).toBe(false)
    expect(spanAllows(narrowSpan, 30)).toBe(true)
    expect(spanAllows(narrowSpan, 45)).toBe(true)
    expect(spanAllows(narrowSpan, 60)).toBe(true)
    expect(spanAllows(narrowSpan, 61)).toBe(false)
  })

  it("rejects a provider that declares no maximum span", () => {
    expect(spanAllows({ ...base, maxSpan: 0 }, 7)).toBe(false)
  })
})

describe("matches", () => {

  it("filters by country, rating and price", () => {
    expect(matches(base, { ...NO_FILTERS, countries: ["Netherlands"] }, 7, "")).toBe(false)
    expect(matches(base, { ...NO_FILTERS, ratingMin: 4.7 }, 7, "")).toBe(false)
    expect(matches(base, { ...NO_FILTERS, priceMax: 1 }, 7, "")).toBe(false)
    expect(matches(cheapDutch, { ...NO_FILTERS, priceMax: 1 }, 7, "")).toBe(true)
  })
})

describe("the catalog floor", () => {

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
    const tight = withSpace(10 * GIB, 9 * GIB)
    expect(matches(tight, NO_FILTERS, 7, "", 2 * GIB)).toBe(false)
    expect(matches(tight, NO_FILTERS, 7, "", 1 * GIB)).toBe(true)
  })

  it("hides a provider whose declared bag limit is below the bag", () => {
    expect(matches(base, NO_FILTERS, 7, "", 9 * GIB)).toBe(false)
    expect(matches({ ...base, maxBagBytes: 0 }, NO_FILTERS, 7, "", 9 * GIB)).toBe(true)
  })

  it("keeps a provider whose limits are met exactly", () => {
    expect(matches(base, NO_FILTERS, 7, "", base.maxBagBytes ?? 0)).toBe(true)
    const exact = withSpace(3 * GIB, 1 * GIB)
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

  it("leaves out a provider at exactly half uptime", () => {
    const halfway = { ...cheapDutch, uptime: 50 }
    expect(pickBest([base, halfway], { count: 2, diversity: "any", priceMax: 4, ratingMax: 5 })).toEqual([base.pubkey])
  })

  it("picks nothing when no provider is above half uptime", () => {
    const weak = [{ ...base, uptime: 50 }, { ...cheapDutch, uptime: 35 }]
    expect(pickBest(weak, { count: 2, diversity: "any", priceMax: 4, ratingMax: 5 })).toEqual([])
  })

  it("takes failing providers above half uptime when the only healthy ones sit below it", () => {
    const healthyLow = { ...cheapDutch, status: 0, uptime: 35 }
    const failingHigh = { ...base, status: 2, uptime: 90 }
    expect(pickBest([healthyLow, failingHigh], { count: 2, diversity: "any", priceMax: 4, ratingMax: 5 })).toEqual([failingHigh.pubkey])
  })
})

describe("the strategy reshuffle", () => {
  const wide = Array.from({ length: 24 }, (_, at) => ({
    ...base,
    pubkey: at.toString(16).padStart(4, "0") + "0".repeat(60),
    rating: 4.8 - at * 0.2,
  }))
  const shortlist = new Set(wide.slice(0, 6).map((provider) => provider.pubkey))
  const drawn = [...Array(20).keys()].map((at) =>
    pickBest(wide, { count: 3, diversity: "any", priceMax: 4, ratingMax: 5, seed: at + 1 }),
  )

  it("draws only from the shortlist of the ranking", () => {
    expect(drawn.every((picked) => picked.every((key) => shortlist.has(key)))).toBe(true)
  })

  it("varies the picks inside the shortlist across seeds", () => {
    expect(new Set(drawn.map((picked) => picked.join())).size).toBeGreaterThan(1)
  })
})

describe("the online window", () => {
  const checked = base.lastOnlineAt ?? 0
  const stale = { ...cheapDutch, lastOnlineAt: checked - ONLINE_WINDOW_SECONDS - 1 }

  it("hides a provider whose last check is older than the window behind the freshest one", () => {
    const since = onlineSince([base, stale])
    expect(matches({ ...cheapDutch, lastOnlineAt: checked - ONLINE_WINDOW_SECONDS }, NO_FILTERS, 7, "", 0, since)).toBe(true)
    expect(matches(stale, NO_FILTERS, 7, "", 0, since)).toBe(false)
    expect(countMatching([base, stale], NO_FILTERS, 7)).toBe(1)
  })

  it("keeps the last round when the checker stalls, because the window follows the catalog, not the clock", () => {
    expect(countMatching([stale], NO_FILTERS, 7)).toBe(1)
  })

  it("keeps everyone when the catalog carries no checks at all", () => {
    expect(countMatching([{ ...base, lastOnlineAt: null }], NO_FILTERS, 7)).toBe(1)
  })

  it("offers no stale provider as a replacement", () => {
    expect(pickReplacements([base, stale], { skip: [], count: 2, proofDays: 7, bagSize: 1024 })).toEqual([base.pubkey])
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

describe("mergeManual", () => {
  const manualRaw = { ...cheapDutch, pubkey: cheapDutch.pubkey.toUpperCase(), rating: 0, uptime: 0 }

  it("prefers the fresh catalog entry when both know the key", () => {
    expect(mergeManual([cheapDutch], [manualRaw])).toEqual([cheapDutch])
  })

  it("appends a manual provider the catalog does not list, and keeps it through a reload that left the catalog empty", () => {
    expect(mergeManual([base], [manualRaw])).toEqual([base, manualRaw])
    expect(mergeManual([], [manualRaw])).toEqual([manualRaw])
  })
})

describe("matchesQuery", () => {
  it.each([
    [base.pubkey.toUpperCase(), true],
    ["aaaa", true],
    ["AAAA", true],
    ["zzzz", false],
    [cheapDutch.pubkey, false],
  ])("searches the public key case-insensitively, in the list filter as well: %s → %s", (query, found) => {
    expect(matchesQuery(base, query)).toBe(found)
    expect(matches(base, NO_FILTERS, 7, query)).toBe(found)
  })
})

describe("pickReplacements", () => {
  it("skips the providers already hired or refused in any case and those whose period does not fit", () => {
    const picked = pickReplacements([base, cheapDutch, secondGerman, narrowSpan], {
      skip: [base.pubkey.toUpperCase()],
      count: 3,
      proofDays: 7,
      bagSize: 1024,
    })
    expect(picked.sort()).toEqual([cheapDutch.pubkey, secondGerman.pubkey].sort())
  })

  it("ignores the period when none is given", () => {
    const picked = pickReplacements([base, narrowSpan], { skip: [base.pubkey], count: 1, proofDays: null, bagSize: 1024 })
    expect(picked).toEqual([narrowSpan.pubkey])
  })
})
