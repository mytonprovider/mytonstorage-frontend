import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ApiError,
  errorDetailOf,
  failureStatus,
  fetchBagDetails,
  fetchContractStatuses,
  fetchOffers,
  fetchProviderByKey,
  fetchProviders,
  fetchTonProofPayload,
  initContract,
  sessionEnded,
  topupContract,
  updateContract,
  withdrawContract,
} from "./api"

const respondWith = (body: unknown, status = 200) =>
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ApiError", () => {
  it("names the call that failed and the status it failed with", async () => {
    vi.stubGlobal("fetch", respondWith({ error: "nope" }, 401))
    await expect(fetchTonProofPayload()).rejects.toBeInstanceOf(ApiError)
    await expect(fetchTonProofPayload()).rejects.toThrow("GET /api/v1/ton-proof failed with 401")
  })

  it("carries the status so a 410 can be told apart from a 500", async () => {
    vi.stubGlobal("fetch", respondWith({}, 410))
    await expect(fetchTonProofPayload()).rejects.toMatchObject({ status: 410 })
  })
})

describe("failureStatus", () => {
  it("hands the response code on as a value and reports none when nothing answered", () => {
    expect(failureStatus(new ApiError(503, "POST", "/api/v1/files/unpaid"))).toBe(503)
    expect(failureStatus(new TypeError("Failed to fetch"))).toBeNull()
  })
})

describe("sessionEnded", () => {
  it("reads the ended session off the response code alone", () => {
    expect(sessionEnded(new ApiError(401, "POST", "/api/v1/files/unpaid"))).toBe(true)
    expect(sessionEnded(new ApiError(403, "POST", "/api/v1/files/unpaid"))).toBe(false)
  })

  it("says nothing ended when the backend never answered", () => {
    expect(sessionEnded(new TypeError("Failed to fetch"))).toBe(false)
    expect(sessionEnded(null)).toBe(false)
  })
})

describe("errorDetailOf", () => {
  it("pulls the error field out of a JSON body and ignores any other shape", () => {
    expect(errorDetailOf('{"error":"bag not found"}')).toBe("bag not found")
    expect(errorDetailOf('{"error":42}')).toBe("")
  })

  it("trims a plain-text body and caps it at 300 characters", () => {
    expect(errorDetailOf("  gateway timeout  ")).toBe("gateway timeout")
    expect(errorDetailOf("x".repeat(400))).toBe("x".repeat(300))
  })
})

describe("fetchTonProofPayload", () => {
  it("unwraps the payload string", async () => {
    vi.stubGlobal("fetch", respondWith({ data: "auth:mytonstorage:example.org" }))
    await expect(fetchTonProofPayload()).resolves.toBe("auth:mytonstorage:example.org")
  })

  it("rejects a response that is missing the payload", async () => {
    vi.stubGlobal("fetch", respondWith({}))
    await expect(fetchTonProofPayload()).rejects.toThrow("unexpected ton-proof response shape")
  })
})

describe("fetchProviders", () => {
  it("drops entries the catalog sends without a public key", async () => {
    vi.stubGlobal("fetch", respondWith({ providers: [{ pubkey: "abc" }, { address: "EQ" }, null] }))
    await expect(fetchProviders()).resolves.toEqual([{ pubkey: "abc", telemetry: null }])
  })

  it("turns the catalog units into bytes: disk binary, memory decimal", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        providers: [
          {
            pubkey: "abc",
            telemetry: { total_provider_space: 3820, used_provider_space: 500, total_ram: 17.18, usage_ram: 8.59 },
          },
        ],
      }),
    )

    await expect(fetchProviders()).resolves.toEqual([
      {
        pubkey: "abc",
        telemetry: {
          total_provider_space_bytes: 3820 * 1024 ** 3,
          used_provider_space_bytes: 500 * 1024 ** 3,
          total_ram_bytes: 17.18e9,
          usage_ram_bytes: 8.59e9,
        },
      },
    ])
  })

  it("treats a missing providers array as an empty catalog", async () => {
    vi.stubGlobal("fetch", respondWith({}))
    await expect(fetchProviders()).resolves.toEqual([])
  })

  it("sends the search as a POST body", async () => {
    const fetchMock = respondWith({ providers: [] })
    vi.stubGlobal("fetch", fetchMock)
    await fetchProviders()

    const init = fetchMock.mock.calls[0][1]
    expect(init?.method).toBe("POST")
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toMatchObject({ limit: 1000, offset: 0 })
  })
})

describe("fetchProviderByKey", () => {
  const key = "ABCDEF0123456789".repeat(4)

  it("asks the catalog for exactly one lower-cased key", async () => {
    const fetchMock = respondWith({ providers: [] })
    vi.stubGlobal("fetch", fetchMock)
    await fetchProviderByKey(key)

    const init = fetchMock.mock.calls[0][1]
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toMatchObject({
      exact: [key.toLowerCase()],
      limit: 1,
    })
  })

  it("unwraps the provider the catalog found", async () => {
    vi.stubGlobal("fetch", respondWith({ providers: [{ pubkey: "abc" }] }))
    await expect(fetchProviderByKey(key)).resolves.toEqual({ pubkey: "abc", telemetry: null })
  })

  it("reports an answered miss as null rather than a failure", async () => {
    vi.stubGlobal("fetch", respondWith({ providers: [] }))
    await expect(fetchProviderByKey(key)).resolves.toBeNull()
  })
})

describe("fetchBagDetails", () => {
  it("does not call the backend for an empty address list", async () => {
    const fetchMock = respondWith([])
    vi.stubGlobal("fetch", fetchMock)
    await expect(fetchBagDetails([])).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps only entries carrying a bag id", async () => {
    vi.stubGlobal("fetch", respondWith([{ bag_id: "a" }, { description: "no id" }]))
    await expect(fetchBagDetails(["EQA"])).resolves.toEqual([{ bag_id: "a" }])
  })
})

describe("fetchContractStatuses", () => {
  it("unwraps the contracts envelope", async () => {
    vi.stubGlobal("fetch", respondWith({ contracts: [{ address: "EQA" }, {}] }))
    await expect(fetchContractStatuses(["EQA"])).resolves.toEqual([{ address: "EQA" }])
  })
})

describe("initContract", () => {
  const payload = { bag_id: "a".repeat(64), providers: ["k"], amount: 5e8, owner_address: "0:1", span: 604800 }

  it("defaults the optional BOC fields to empty strings", async () => {
    vi.stubGlobal("fetch", respondWith({ address: "EQA", amount: 5e8 }))
    await expect(initContract(payload)).resolves.toEqual({ address: "EQA", amount: 5e8, body: "", state_init: "" })
  })

  it("rejects a transaction with no address to send to", async () => {
    vi.stubGlobal("fetch", respondWith({ amount: 5e8 }))
    await expect(initContract(payload)).rejects.toThrow("unexpected transaction response shape from init-contract")
  })

  it("sends every contract call to its own endpoint", async () => {
    const fetchMock = respondWith({ address: "EQA", amount: 1 })
    vi.stubGlobal("fetch", fetchMock)

    await initContract(payload)
    await updateContract({ address: "EQA", providers: ["k"], bag_size: 1, amount: 1, span: 604800 })
    await topupContract("EQA", 1)
    await withdrawContract("EQA")

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining("/api/v1/contracts/init-contract"),
      expect.stringContaining("/api/v1/contracts/update"),
      expect.stringContaining("/api/v1/contracts/topup"),
      expect.stringContaining("/api/v1/contracts/withdraw"),
    ])
  })
})

describe("fetchOffers", () => {
  it("hands back empty lists when the backend answers with nulls", async () => {
    vi.stubGlobal("fetch", respondWith({ offers: null, declines: null }))
    await expect(fetchOffers("bag", 604800, ["k"])).resolves.toEqual({ offers: [], declines: [] })
  })

  it("keeps the effective rate the fate check compares against the chain", async () => {
    const offer = { price_per_proof: 1e8, price_per_mb: 210, provider: { key: "ABC", price_per_mb_day: 210 } }
    vi.stubGlobal("fetch", respondWith({ offers: [offer], declines: [] }))
    await expect(fetchOffers("bag", 604800, ["abc"])).resolves.toEqual({ offers: [offer], declines: [] })
  })

  it("drops a quote whose price is not a whole nanoton amount, leaving it short of the keys asked for", async () => {
    const sound = { price_per_proof: 1e8, price_per_mb: 210, provider: { key: "ABC", price_per_mb_day: 210 } }
    const asked = ["abc", "fraction", "text", "negative", "uncountable", "absent", "noproof", "nokey"]
    const broken = [
      { ...sound, price_per_mb: 210.5, provider: { key: "FRACTION", price_per_mb_day: 210 } },
      { ...sound, price_per_mb: "210", provider: { key: "TEXT", price_per_mb_day: 210 } },
      { ...sound, price_per_mb: -210, provider: { key: "NEGATIVE", price_per_mb_day: 210 } },
      { ...sound, price_per_mb: 2 ** 53, provider: { key: "UNCOUNTABLE", price_per_mb_day: 210 } },
      { ...sound, price_per_mb: null, provider: { key: "ABSENT", price_per_mb_day: 210 } },
      { ...sound, price_per_proof: Number.NaN, provider: { key: "NOPROOF", price_per_mb_day: 210 } },
      { ...sound, provider: null },
    ]
    vi.stubGlobal("fetch", respondWith({ offers: [sound, ...broken], declines: [] }))

    const quote = await fetchOffers("bag", 604800, asked)

    expect(quote).toEqual({ offers: [sound], declines: [] })
    expect(quote.offers.length).toBeLessThan(asked.length)
  })

  it("drops a refusal that carries no readable key or reason, so the picker cannot be rendered off it", async () => {
    const stated = { provider_key: "ABC", reason: "provider is not available" }
    const declines = [
      stated,
      { provider_key: null, reason: "provider is not available" },
      { provider_key: 210, reason: "provider is not available" },
      { provider_key: "DEF" },
      { provider_key: "GHI", reason: { text: "provider is not available" } },
      {},
    ]
    vi.stubGlobal("fetch", respondWith({ offers: [], declines }))

    const quote = await fetchOffers("bag", 604800, ["abc", "def", "ghi"])

    expect(quote.declines).toEqual([stated])
    quote.declines.forEach((decline) => {
      expect(() => decline.provider_key.toLowerCase() + decline.reason.trim()).not.toThrow()
    })
  })
})
