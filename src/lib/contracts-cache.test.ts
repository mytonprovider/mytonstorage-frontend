import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContractStatus } from "@/types/contract"
import type { ContractRow } from "./contracts"
import type { ContractEconomics } from "./contracts-cache"
import {
  clearWalletCaches,
  dropEconomics,
  getEconomics,
  getStatuses,
  peekEconomics,
  peekStatuses,
  readContractsCache,
  resetContractCachesForTests,
  writeContractsCache,
} from "./contracts-cache"
import { economics } from "./fixtures"
import { CONTRACTS_KEY_PREFIX, ECONOMICS_KEY, HIDE_CLOSED_KEY, LANGUAGE_KEY, PENDING_PAID_KEY, THEME_KEY } from "./local-storage"

const { fetchContractStatuses, runGetMethod } = vi.hoisted(() => ({
  fetchContractStatuses: vi.fn(),
  runGetMethod: vi.fn(),
}))

vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<object>()), fetchContractStatuses }))
vi.mock("./ton/toncenter", async (importOriginal) => ({ ...(await importOriginal<object>()), runGetMethod }))

const num = (value: number) => ({ type: "num", value: `0x${value.toString(16)}` })
const STORAGE_INFO = [num(1), num(1048576)]
const PROVIDER_STACK = [
  { type: "list", value: [{ type: "tuple", value: [num(11), num(300), num(86400), num(0)] }] },
  num(1_000_000_000),
]

const chainAnswers = (): void => {
  runGetMethod.mockImplementation((_address: string, method: string) =>
    Promise.resolve(method === "get_storage_info" ? STORAGE_INFO : PROVIDER_STACK),
  )
}

const methodsAsked = (): string[] => runGetMethod.mock.calls.map((call) => call[1] as string)

const checkOf = (address: string): ContractStatus => ({
  address,
  provider_pubkey: "aa",
  reason: 0,
  reason_timestamp: 1785540000,
})

const HOUR_MS = 3_600_001
const CARD_FRESH_MS = 60_000

const fakeStorage = () => {
  const bag = new Map<string, string>()
  return {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => void bag.set(key, value),
    removeItem: (key: string) => void bag.delete(key),
    key: (at: number) => [...bag.keys()][at] ?? null,
    get length() {
      return bag.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage())
  resetContractCachesForTests()
  vi.mocked(runGetMethod).mockReset()
  vi.mocked(fetchContractStatuses).mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const OWNER = "EQOwner"

const row: ContractRow = {
  address: "EQA",
  createdAt: 100,
  closed: false,
  bagId: "b",
  description: "d",
  size: 1,
  valid: 1,
  total: 1,
}

describe("writeContractsCache", () => {
  it("round-trips the rows and both cursors", () => {
    writeContractsCache(OWNER, "500", "100", [row])
    expect(readContractsCache(OWNER)).toMatchObject({ headLt: "500", deepLt: "100", rows: [row] })
  })

  it("strips the economics before persisting", () => {
    writeContractsCache(OWNER, "500", null, [{ ...row, economics }])
    expect(readContractsCache(OWNER)?.rows[0]).not.toHaveProperty("economics")
  })

  it("keeps every wallet under its own key", () => {
    writeContractsCache(OWNER, "500", null, [row])
    expect(readContractsCache("EQOther")).toBeNull()
  })

  it("moves the cursors forward on the next write", () => {
    writeContractsCache(OWNER, "500", "100", [row])
    writeContractsCache(OWNER, "700", null, [row])
    expect(readContractsCache(OWNER)).toMatchObject({ headLt: "700", deepLt: null })
  })
})

describe("readContractsCache", () => {
  it("starts clean on corrupted JSON", () => {
    localStorage.setItem(CONTRACTS_KEY_PREFIX + OWNER, "{oops")
    expect(readContractsCache(OWNER)).toBeNull()
  })

  it("rejects a cache without a head cursor", () => {
    localStorage.setItem(CONTRACTS_KEY_PREFIX + OWNER, JSON.stringify({ rows: [row] }))
    expect(readContractsCache(OWNER)).toBeNull()
  })
})

describe("getEconomics", () => {
  it("fetches once and serves the repeat from the cache", async () => {
    const fetcher = vi.fn().mockResolvedValue(economics)
    await getEconomics("EQA", { fetcher })
    await getEconomics("EQA", { fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("shares one in-flight request between callers", async () => {
    let release: (value: ContractEconomics) => void = () => undefined
    const fetcher = vi.fn().mockReturnValue(
      new Promise<ContractEconomics>((resolve) => {
        release = resolve
      }),
    )

    const first = getEconomics("EQA", { fetcher })
    const second = getEconomics("EQA", { fetcher })
    release(economics)

    await expect(first).resolves.toEqual(economics)
    await expect(second).resolves.toEqual(economics)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("expires the hour-old value", async () => {
    const fetcher = vi.fn().mockResolvedValue(economics)
    await getEconomics("EQA", { fetcher })
    await getEconomics("EQA", { fetcher, now: Date.now() + 3_600_001 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("does not cache an empty contract", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ...economics, fileSize: 0 })
    await getEconomics("EQA", { fetcher })
    await getEconomics("EQA", { fetcher })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("retries after a failure instead of caching it", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(economics)
    await expect(getEconomics("EQA", { fetcher })).rejects.toThrow("down")
    await expect(getEconomics("EQA", { fetcher })).resolves.toEqual(economics)
  })

  it("keeps serving the known value after a failed refresh", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(economics).mockRejectedValueOnce(new Error("down"))
    await getEconomics("EQA", { fetcher })
    const later = Date.now() + 2 * CARD_FRESH_MS
    await expect(getEconomics("EQA", { fetcher, now: later, maxAge: CARD_FRESH_MS })).rejects.toThrow("down")
    expect(peekEconomics("EQA", later)).toEqual(economics)
  })

  it("mirrors the value for the next session", async () => {
    await getEconomics("EQA", { fetcher: vi.fn().mockResolvedValue(economics) })
    resetContractCachesForTests()
    expect(peekEconomics("EQA")).toEqual(economics)
  })

  it("forgets the address after a confirmed transaction changed it", async () => {
    const fetcher = vi.fn().mockResolvedValue(economics)
    await getEconomics("EQA", { fetcher })
    dropEconomics("EQA")
    expect(peekEconomics("EQA")).toBeUndefined()
    await getEconomics("EQA", { fetcher })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("serves the list from the hour-long cache and refetches for the card past the fresh window", async () => {
    const fetcher = vi.fn().mockResolvedValue(economics)
    const opened = Date.now() + 300_000
    await getEconomics("EQA", { fetcher })
    await getEconomics("EQA", { fetcher, now: opened })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await getEconomics("EQA", { fetcher, now: opened, maxAge: CARD_FRESH_MS })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("holds the card back inside the fresh window", async () => {
    const fetcher = vi.fn().mockResolvedValue(economics)
    await getEconomics("EQA", { fetcher })
    await getEconomics("EQA", { fetcher, now: Date.now() + 10_000, maxAge: CARD_FRESH_MS })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe("fetchEconomics", () => {
  it("asks the chain for the storage info once and refreshes only the providers", async () => {
    chainAnswers()
    await getEconomics("EQA")
    await getEconomics("EQA", { now: Date.now() + HOUR_MS })
    expect(methodsAsked()).toEqual(["get_storage_info", "get_providers", "get_providers"])
  })

  it("keeps the storage info a failed refresh could not confirm", async () => {
    chainAnswers()
    await getEconomics("EQA")
    runGetMethod.mockRejectedValueOnce(new Error("down"))
    await expect(getEconomics("EQA", { now: Date.now() + HOUR_MS })).rejects.toThrow("down")
    await getEconomics("EQA", { now: Date.now() + HOUR_MS })
    expect(methodsAsked()).toEqual(["get_storage_info", "get_providers", "get_providers", "get_providers"])
  })

  it("survives the whole session on a fresh read", async () => {
    chainAnswers()
    await getEconomics("EQA")
    resetContractCachesForTests()
    await getEconomics("EQA", { now: Date.now() + HOUR_MS })
    expect(methodsAsked()).toEqual(["get_storage_info", "get_providers", "get_providers"])
  })
})

describe("getStatuses", () => {
  it("remembers for every address the list asked about", async () => {
    fetchContractStatuses.mockResolvedValue([checkOf("EQA"), checkOf("EQB")])
    await getStatuses(["EQA", "EQB"])
    expect(peekStatuses("EQA")).toEqual([checkOf("EQA")])
    expect(peekStatuses("EQC")).toEqual([])
  })

  it("joins the batch the list still has in flight", async () => {
    let release: (checks: ContractStatus[]) => void = () => undefined
    fetchContractStatuses.mockReturnValue(
      new Promise<ContractStatus[]>((resolve) => {
        release = resolve
      }),
    )

    const batch = getStatuses(["EQA", "EQB"])
    const card = getStatuses(["EQA"])
    release([checkOf("EQA"), checkOf("EQB")])

    await Promise.all([batch, card])
    expect(fetchContractStatuses).toHaveBeenCalledTimes(1)
    expect(peekStatuses("EQA")).toEqual([checkOf("EQA")])
  })

  it("asks again once the batch has settled", async () => {
    fetchContractStatuses.mockResolvedValue([checkOf("EQA")])
    await getStatuses(["EQA", "EQB"])
    await getStatuses(["EQA"])
    expect(fetchContractStatuses).toHaveBeenCalledTimes(2)
  })
})

describe("persistEconomics", () => {
  it("drops entries older than the ttl when persisting fresh ones", async () => {
    localStorage.setItem(
      ECONOMICS_KEY,
      JSON.stringify({ EQstale: { at: Date.now() - HOUR_MS, value: { ...economics, fileSize: 1048576 } } }),
    )
    chainAnswers()
    await getEconomics("EQfresh")
    const stored = JSON.parse(localStorage.getItem(ECONOMICS_KEY) ?? "{}") as Record<string, unknown>
    expect(stored.EQstale).toBeUndefined()
    expect(stored.EQfresh).toBeDefined()
  })
})

describe("clearWalletCaches", () => {
  it("wipes every mts key except the theme, language and pending payment", async () => {
    localStorage.setItem(CONTRACTS_KEY_PREFIX + "EQowner", JSON.stringify({ headLt: "1", rows: [] }))
    localStorage.setItem(CONTRACTS_KEY_PREFIX + "EQformer", JSON.stringify({ headLt: "2", rows: [] }))
    localStorage.setItem("mts_hide_closed", "1")
    localStorage.setItem("mts_theme", "dark")
    localStorage.setItem("mts_lang", "ru")
    localStorage.setItem("mts_pending_paid", "{}")
    chainAnswers()
    await getEconomics("EQfresh")
    clearWalletCaches()
    expect(localStorage.getItem(CONTRACTS_KEY_PREFIX + "EQowner")).toBeNull()
    expect(localStorage.getItem(CONTRACTS_KEY_PREFIX + "EQformer")).toBeNull()
    expect(localStorage.getItem(ECONOMICS_KEY)).toBeNull()
    expect(localStorage.getItem("mts_hide_closed")).toBeNull()
    expect(localStorage.getItem("mts_theme")).toBe("dark")
    expect(localStorage.getItem("mts_lang")).toBe("ru")
    expect(localStorage.getItem("mts_pending_paid")).toBe("{}")
    expect(peekEconomics("EQfresh")).toBeUndefined()
  })

  it("finishes the sign-out on a browser that refuses the sweep, so no wallet data survives in memory", async () => {
    chainAnswers()
    await getEconomics("EQfresh")
    const bag = new Map([
      [CONTRACTS_KEY_PREFIX + "EQowner", "{}"],
      [THEME_KEY, "dark"],
    ])
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: () => undefined,
      key: (at: number) => [...bag.keys()][at] ?? null,
      get length() {
        return bag.size
      },
      removeItem: () => {
        throw new DOMException("SecurityError")
      },
    })

    clearWalletCaches()

    expect(peekEconomics("EQfresh")).toBeUndefined()
  })

  it("leaves foreign keys like the ton connect session untouched", () => {
    localStorage.setItem("ton-connect-storage_bridge-connection", "{\"type\":\"http\"}")
    localStorage.setItem("mts_contracts_EQowner", "{}")
    clearWalletCaches()
    expect(localStorage.getItem("ton-connect-storage_bridge-connection")).toBe("{\"type\":\"http\"}")
    expect(localStorage.getItem("mts_contracts_EQowner")).toBeNull()
  })
})

describe("storage keys", () => {
  it("names the six keys exactly, with no version suffixes", () => {
    expect(THEME_KEY).toBe("mts_theme")
    expect(LANGUAGE_KEY).toBe("mts_lang")
    expect(HIDE_CLOSED_KEY).toBe("mts_hide_closed")
    expect(PENDING_PAID_KEY).toBe("mts_pending_paid")
    expect(CONTRACTS_KEY_PREFIX).toBe("mts_contracts_")
    expect(ECONOMICS_KEY).toBe("mts_economics")
  })
})
