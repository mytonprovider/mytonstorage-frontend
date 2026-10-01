import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContractStatus } from "@/types/contract"
import type { ContractRow } from "./contracts"
import {
  clearWalletCaches,
  getStatuses,
  knownStateHash,
  peekState,
  peekStatuses,
  putState,
  readContractsCache,
  resetContractCachesForTests,
  stateOf,
  watchState,
  writeContractsCache,
} from "./contracts-cache"
import { state } from "./fixtures"
import {
  CONTRACTS_KEY,
  LANGUAGE_KEY,
  LIST_KEY,
  PENDING_KEY,
  STATES_KEY,
  THEME_KEY,
  migrateStored,
  readListView,
  writeListView,
} from "./local-storage"

const { fetchContractStatuses } = vi.hoisted(() => ({ fetchContractStatuses: vi.fn() }))

vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<object>()), fetchContractStatuses }))

const checkOf = (address: string): ContractStatus => ({
  address,
  provider_pubkey: "aa",
  reason: 0,
  reason_timestamp: 1785540000,
})

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
    writeContractsCache(OWNER, { headLt: "500", closedLt: "100", rows: [row] })
    expect(readContractsCache(OWNER)).toEqual({ headLt: "500", closedLt: "100", rows: [row] })
  })

  it("strips the state before persisting", () => {
    writeContractsCache(OWNER, { headLt: "500", closedLt: null, rows: [{ ...row, state }] })
    expect(readContractsCache(OWNER)?.rows[0]).not.toHaveProperty("state")
  })

  it("hands nothing to another wallet, since the record names its owner", () => {
    writeContractsCache(OWNER, { headLt: "500", closedLt: null, rows: [row] })
    expect(readContractsCache("EQOther")).toBeNull()
  })

  it("moves the cursors forward on the next write", () => {
    writeContractsCache(OWNER, { headLt: "500", closedLt: "100", rows: [row] })
    writeContractsCache(OWNER, { headLt: "700", closedLt: "100", rows: [row] })
    expect(readContractsCache(OWNER)).toMatchObject({ headLt: "700", closedLt: "100" })
  })
})

describe("readContractsCache", () => {
  it("starts clean on corrupted JSON", () => {
    localStorage.setItem(CONTRACTS_KEY, "{oops")
    expect(readContractsCache(OWNER)).toBeNull()
  })

  it("reads a cache written before there were cursors as one with none", () => {
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify({ owner: OWNER, rows: [row] }))
    expect(readContractsCache(OWNER)).toEqual({ headLt: null, closedLt: null, rows: [row] })
  })
})

describe("contract state cache", () => {
  it("keeps the value and its hash under the address, in memory and for the next session", () => {
    putState("EQA", "hash-1", state)
    expect(peekState("EQA")).toEqual(state)
    expect(knownStateHash("EQA")).toBe("hash-1")

    resetContractCachesForTests()
    expect(peekState("EQA")).toEqual(state)
    expect(JSON.parse(localStorage.getItem(STATES_KEY) ?? "{}")).toEqual({ EQA: { stateHash: "hash-1", value: state } })
  })

  it("knows nothing about an address it never saw and about a broken record", () => {
    expect(peekState("EQnone")).toBeUndefined()
    expect(knownStateHash("EQnone")).toBeUndefined()
    localStorage.setItem(STATES_KEY, "{oops")
    resetContractCachesForTests()
    expect(peekState("EQbad")).toBeUndefined()
  })

  it("wakes every open card of the address when a sweep writes a fresh state", () => {
    const first = vi.fn()
    const second = vi.fn()
    watchState("EQA", first)
    watchState("EQA", second)

    putState("EQA", "hash-1", state)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe("stateOf", () => {
  it("turns an account state with a data cell into the shape the pricing reads", () => {
    const read = stateOf({
      address: "0:129e",
      balance: 224577526,
      codeHash: "x",
      stateHash: "h",
      lastLt: "1",
      dataBoc: "te6ccgEBAwEAtAAB3fqTpD6+sri6w1C2mrZ/+vRPD50sLs1Fa5u1jVXQu9TmwAg64BmiOoFivqpcsOvcVmaLLqxsa6UYCIEpFbIGoVLcUAAAABAAAAPQAIAAAa7Se4nSjFbVJ2Ot3oRRnVF/A3172ZWTie0UmdNHDwKQ6AEBa6AHUR+2vthbLvj2E+XNNqNDw70ZrL39DXFPB/mnvcMr/gAAAAAZjOcmgAAAAAXkKtIuXlfjkAIADQAnjQAgZcg=",
    })

    expect(read).not.toBeNull()
    expect(read).toMatchObject({
      balance: 224577526,
      fileSize: 4294967357,
      providers: [{ pubkey: "3a88fdb5f6c2d977c7b09f2e69b51a1e1de8cd65efe86b8a783fcd3dee195ff0", ratePerMbDay: 1628, maxSpan: 2592000, lastProofTime: 0 }],
    })
  })

  it("reads nothing from an account without a data cell", () => {
    expect(stateOf({ address: "0:1", balance: 0, codeHash: null, stateHash: null, lastLt: null, dataBoc: null })).toBeNull()
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

describe("clearWalletCaches", () => {
  it("wipes every mts key except the theme, language and pending payment", () => {
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify({ owner: "EQowner", headLt: "1", rows: [] }))
    localStorage.setItem("mts_contracts_list", "{\"shown\":20,\"hideClosed\":true}")
    localStorage.setItem("mts_theme", "dark")
    localStorage.setItem("mts_lang", "ru")
    localStorage.setItem("mts_contracts_pending", "{}")
    putState("EQfresh", "h", state)
    clearWalletCaches()
    expect(localStorage.getItem(CONTRACTS_KEY)).toBeNull()
    expect(localStorage.getItem(STATES_KEY)).toBeNull()
    expect(localStorage.getItem("mts_contracts_list")).toBeNull()
    expect(localStorage.getItem("mts_theme")).toBe("dark")
    expect(localStorage.getItem("mts_lang")).toBe("ru")
    expect(localStorage.getItem("mts_contracts_pending")).toBe("{}")
    expect(peekState("EQfresh")).toBeUndefined()
  })

  it("finishes the sign-out on a browser that refuses the sweep, so no wallet data survives in memory", () => {
    putState("EQfresh", "h", state)
    const bag = new Map([
      [CONTRACTS_KEY, "{}"],
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

    expect(peekState("EQfresh")).toBeUndefined()
  })

  it("leaves foreign keys like the ton connect session untouched", () => {
    localStorage.setItem("ton-connect-storage_bridge-connection", "{\"type\":\"http\"}")
    localStorage.setItem("mts_contracts_owned", "{}")
    clearWalletCaches()
    expect(localStorage.getItem("ton-connect-storage_bridge-connection")).toBe("{\"type\":\"http\"}")
    expect(localStorage.getItem("mts_contracts_owned")).toBeNull()
  })
})

describe("storage keys", () => {
  it("names the six keys exactly, with no version suffixes", () => {
    expect(THEME_KEY).toBe("mts_theme")
    expect(LANGUAGE_KEY).toBe("mts_lang")
    expect(LIST_KEY).toBe("mts_contracts_list")
    expect(PENDING_KEY).toBe("mts_contracts_pending")
    expect(CONTRACTS_KEY).toBe("mts_contracts_owned")
    expect(STATES_KEY).toBe("mts_contracts_states")
  })
})

describe("list view in storage", () => {
  it("reads a record written before sorting existed and leaves the order unset", () => {
    localStorage.setItem(LIST_KEY, JSON.stringify({ shown: 20, hideClosed: true }))
    expect(readListView()).toEqual({ shown: 20, hideClosed: true, sort: "", dir: "" })
  })

  it("falls back to defaults on anything the key is not supposed to hold", () => {
    const fallback = { shown: 0, hideClosed: false, sort: "", dir: "" }
    for (const junk of ["not json", "null", "5", "[]", '{"shown":null,"hideClosed":"yes"}']) {
      localStorage.setItem(LIST_KEY, junk)
      expect(readListView()).toEqual(fallback)
    }
  })

  it("keeps the fields it does not write and survives a numeric string", () => {
    localStorage.setItem(LIST_KEY, JSON.stringify({ shown: "20", hideClosed: true, sort: "checks", dir: "asc" }))
    writeListView({ shown: 30 })
    expect(readListView()).toEqual({ shown: 30, hideClosed: true, sort: "checks", dir: "asc" })
  })
})

describe("migrateStored", () => {
  const pending = JSON.stringify({ bagId: "f".repeat(64), contract: "EQA", at: 1_790_000_000_000, owner: "UQA" })

  it("carries an unfinished payment over to the key that holds it now", () => {
    localStorage.setItem("mts_pending_paid", pending)
    migrateStored()
    expect(localStorage.getItem(PENDING_KEY)).toBe(pending)
    expect(localStorage.getItem("mts_pending_paid")).toBeNull()
  })

  it("never overwrites a payment already written under the new key", () => {
    const fresh = JSON.stringify({ bagId: "a".repeat(64), contract: "EQB", at: 1_790_000_000_001 })
    localStorage.setItem("mts_pending_paid", pending)
    localStorage.setItem(PENDING_KEY, fresh)
    migrateStored()
    expect(localStorage.getItem(PENDING_KEY)).toBe(fresh)
  })

  it("keeps the hide-closed choice and sweeps every cache the old version left, whatever it was named", () => {
    localStorage.setItem("mts_hide_closed", "1")
    localStorage.setItem("mts_contract_rows", "[]")
    localStorage.setItem("mts_economics", "{}")
    localStorage.setItem("mts_contracts_UQowner", "{}")
    localStorage.setItem(THEME_KEY, '"dark"')
    migrateStored()
    expect(readListView().hideClosed).toBe(true)
    expect(localStorage.getItem(THEME_KEY)).toBe('"dark"')
    for (const gone of ["mts_hide_closed", "mts_contract_rows", "mts_economics", "mts_contracts_UQowner"]) {
      expect(localStorage.getItem(gone)).toBeNull()
    }
  })

  it("sweeps a storage full of old keys without skipping any, however they are ordered", () => {
    const old = ["mts_pending_paid", "mts_hide_closed", "mts_contract_rows", "mts_economics", "mts_contracts_UQo", "mts_contracts_EQb"]
    old.forEach((key) => localStorage.setItem(key, "{}"))
    localStorage.setItem(THEME_KEY, '"dark"')
    localStorage.setItem(LANGUAGE_KEY, '"en"')

    migrateStored()

    const left = Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at)).filter(Boolean)
    expect(left.filter((key) => old.includes(key as string))).toEqual([])
    expect(left).toContain(THEME_KEY)
    expect(left).toContain(LANGUAGE_KEY)
  })

  it("runs once: a second call leaves a working cache alone", () => {
    localStorage.setItem("mts_hide_closed", "1")
    migrateStored()
    localStorage.setItem(CONTRACTS_KEY, '{"owner":"UQo","rows":[]}')
    migrateStored()
    expect(localStorage.getItem(CONTRACTS_KEY)).toBe('{"owner":"UQo","rows":[]}')
    expect(readListView().hideClosed).toBe(true)
  })

  it("marks a fresh browser as migrated without inventing anything", () => {
    migrateStored()
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(localStorage.getItem(LIST_KEY)).toBeNull()
    const kept = Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at)).filter(Boolean)
    expect(kept).toEqual(["mts_schema"])
  })

  it("leaves keys that are not ours alone", () => {
    localStorage.setItem("ton-connect-ui_wallet-info", '{"name":"Tonkeeper"}')
    localStorage.setItem("ton-connect-storage_bridge-connection", "{}")
    localStorage.setItem("mts_hide_closed", "1")
    migrateStored()
    expect(localStorage.getItem("ton-connect-ui_wallet-info")).toBe('{"name":"Tonkeeper"}')
    expect(localStorage.getItem("ton-connect-storage_bridge-connection")).toBe("{}")
  })
})

describe("state cache guards its shape", () => {
  const good = { torrentHash: "f".repeat(64), fileSize: 1024, balance: 500, providers: [{ pubkey: "a", ratePerMbDay: 1, maxSpan: 2, lastProofTime: 3 }] }

  it("keeps a record it can read back whole", () => {
    localStorage.setItem(STATES_KEY, JSON.stringify({ EQA: { stateHash: "h", value: good } }))
    expect(peekState("EQA")).toEqual(good)
  })

  it("drops a record whose providers are not providers, so money is never counted on junk", () => {
    const junk = [
      { ...good, providers: [{ pubkey: "a", ratePerMbDay: "1", maxSpan: 2, lastProofTime: 3 }] },
      { ...good, providers: [{ pubkey: "a", ratePerMbDay: Number.NaN, maxSpan: 2, lastProofTime: 3 }] },
      { ...good, providers: [{ ratePerMbDay: 1, maxSpan: 2, lastProofTime: 3 }] },
      { ...good, balance: "500" },
      { ...good, providers: {} },
    ]
    junk.forEach((value, at) => {
      resetContractCachesForTests()
      localStorage.setItem(STATES_KEY, JSON.stringify({ [`EQ${at}`]: { stateHash: "h", value } }))
      expect(peekState(`EQ${at}`)).toBeUndefined()
    })
  })
})
