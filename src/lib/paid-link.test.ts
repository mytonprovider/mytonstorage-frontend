import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { PENDING_PAID_KEY } from "./local-storage"
import { contractDeployed, forgetPendingFound, markPendingLinked, readPendingPaid, retryPendingPaid, writePendingPaid } from "./paid-link"

const { markBagPaid, runGetMethod } = vi.hoisted(() => ({ markBagPaid: vi.fn(), runGetMethod: vi.fn() }))

vi.mock("./api", () => ({ markBagPaid }))
vi.mock("./ton/toncenter", async (importOriginal) => ({ ...(await importOriginal<object>()), runGetMethod }))

const BAG = "f".repeat(64)
const CONTRACT = "EQCONTRACT"

const store = new Map<string, string>()

let refused: Error

beforeAll(async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ exit_code: -13, stack: [] }))))
  const chain = await vi.importActual<typeof import("./ton/toncenter")>("./ton/toncenter")
  refused = (await chain.runGetMethod(CONTRACT, "get_storage_info").catch((error: unknown) => error)) as Error
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
})

afterEach(() => {
  store.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("contractDeployed", () => {
  it("takes a contract answering get_storage_info as deployed: relink is allowed, no second payment", async () => {
    runGetMethod.mockResolvedValue([])

    await expect(contractDeployed(CONTRACT)).resolves.toBe("deployed")
    expect(runGetMethod).toHaveBeenCalledWith(CONTRACT, "get_storage_info")
  })

  it("takes the refusal runGetMethod really throws as missing: the payment must happen, not be skipped", async () => {
    runGetMethod.mockRejectedValue(refused)

    await expect(contractDeployed(CONTRACT)).resolves.toBe("missing")
  })

  it("reads that refusal as a value, so a stranger wearing the same message proves nothing", async () => {
    runGetMethod.mockRejectedValue(new Error(refused.message))

    await expect(contractDeployed(CONTRACT)).resolves.toBe("unknown")
  })

  it("never calls a contract missing when the chain could not be asked", async () => {
    runGetMethod.mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(contractDeployed(CONTRACT)).resolves.toBe("unknown")

    runGetMethod.mockRejectedValue(new Error("toncenter runGetMethod failed with 502"))
    await expect(contractDeployed(CONTRACT)).resolves.toBe("unknown")
  })
})

describe("retryPendingPaid", () => {
  it("does nothing when no payment is pending", async () => {
    await expect(retryPendingPaid()).resolves.toBe("none")
    expect(runGetMethod).not.toHaveBeenCalled()
    expect(markBagPaid).not.toHaveBeenCalled()
  })

  it("links the bag once the contract is on chain and forgets the pending record", async () => {
    runGetMethod.mockResolvedValue([])
    markBagPaid.mockResolvedValue(undefined)
    writePendingPaid(BAG, CONTRACT)

    await expect(retryPendingPaid()).resolves.toBe("linked")
    expect(markBagPaid).toHaveBeenCalledWith(BAG, CONTRACT)
    expect(store.has(PENDING_PAID_KEY)).toBe(false)
  })

  it("never marks the bag paid while the contract is not deployed", async () => {
    runGetMethod.mockRejectedValue(refused)
    writePendingPaid(BAG, CONTRACT)

    await expect(retryPendingPaid()).resolves.toBe("kept")
    expect(markBagPaid).not.toHaveBeenCalled()
    expect(store.has(PENDING_PAID_KEY)).toBe(true)
  })

  it("gives up on a contract that has not appeared within a day", async () => {
    runGetMethod.mockRejectedValue(refused)
    const at = Date.now() - 25 * 60 * 60 * 1000
    store.set(PENDING_PAID_KEY, JSON.stringify({ bagId: BAG, contract: CONTRACT, at }))

    await expect(retryPendingPaid()).resolves.toBe("dropped")
    expect(markBagPaid).not.toHaveBeenCalled()
    expect(store.has(PENDING_PAID_KEY)).toBe(false)
  })

  it("keeps a day-old record while the chain cannot be asked, instead of losing the link to an outage", async () => {
    runGetMethod.mockRejectedValue(new TypeError("Failed to fetch"))
    const at = Date.now() - 25 * 60 * 60 * 1000
    store.set(PENDING_PAID_KEY, JSON.stringify({ bagId: BAG, contract: CONTRACT, at }))

    await expect(retryPendingPaid()).resolves.toBe("kept")
    expect(markBagPaid).not.toHaveBeenCalled()
    expect(store.has(PENDING_PAID_KEY)).toBe(true)
  })

  it("keeps the record when the link call itself fails, so a later visit retries it", async () => {
    runGetMethod.mockResolvedValue([])
    markBagPaid.mockRejectedValue(new Error("network down"))
    writePendingPaid(BAG, CONTRACT)

    await expect(retryPendingPaid()).resolves.toBe("kept")
    expect(store.has(PENDING_PAID_KEY)).toBe(true)
  })

  it("gives up on a link the server has refused for a day", async () => {
    runGetMethod.mockResolvedValue([])
    markBagPaid.mockRejectedValue(new Error("bag is gone"))
    const at = Date.now() - 25 * 60 * 60 * 1000
    store.set(PENDING_PAID_KEY, JSON.stringify({ bagId: BAG, contract: CONTRACT, at }))

    await expect(retryPendingPaid()).resolves.toBe("dropped")
    expect(store.has(PENDING_PAID_KEY)).toBe(false)
  })

  it("treats a malformed record as no pending payment instead of linking garbage", async () => {
    store.set(PENDING_PAID_KEY, "{broken")

    await expect(retryPendingPaid()).resolves.toBe("none")
    expect(markBagPaid).not.toHaveBeenCalled()
  })

  it("leaves a linked record for the contracts scan instead of linking twice", async () => {
    writePendingPaid(BAG, CONTRACT)
    markPendingLinked()

    await expect(retryPendingPaid()).resolves.toBe("kept")
    expect(runGetMethod).not.toHaveBeenCalled()
    expect(markBagPaid).not.toHaveBeenCalled()
    expect(store.has(PENDING_PAID_KEY)).toBe(true)
  })

  it("gives the same verdict on a browser that refuses to forget, instead of throwing the whole retry away", async () => {
    const at = Date.now() - 25 * 60 * 60 * 1000
    const record = JSON.stringify({ bagId: BAG, contract: CONTRACT, at, linked: true })
    vi.stubGlobal("localStorage", {
      getItem: () => record,
      setItem: () => undefined,
      removeItem: () => {
        throw new DOMException("SecurityError")
      },
    })

    await expect(retryPendingPaid()).resolves.toBe("dropped")
  })

  it("drops a linked record the scan has not met within a day", async () => {
    const at = Date.now() - 25 * 60 * 60 * 1000
    store.set(PENDING_PAID_KEY, JSON.stringify({ bagId: BAG, contract: CONTRACT, at, linked: true }))

    await expect(retryPendingPaid()).resolves.toBe("dropped")
    expect(store.has(PENDING_PAID_KEY)).toBe(false)
  })
})

describe("pending paid record", () => {
  it("keeps reading a record written before the row fields existed", () => {
    store.set(PENDING_PAID_KEY, JSON.stringify({ bagId: BAG, contract: CONTRACT, at: 5 }))

    expect(readPendingPaid()).toMatchObject({ bagId: BAG, contract: CONTRACT, at: 5, linked: false })
  })

  it("carries the row fields the wizard wrote", () => {
    writePendingPaid(BAG, CONTRACT, "EQOWNER", "backup", 42)

    expect(readPendingPaid()).toMatchObject({ owner: "EQOWNER", description: "backup", size: 42, linked: false })
  })

  it("holds a single payment: paying the next bag replaces the record of the first", () => {
    writePendingPaid(BAG, CONTRACT)
    const second = "e".repeat(64)
    writePendingPaid(second, "EQSECOND", "EQOWNER", "more", 7)

    expect(readPendingPaid()).toMatchObject({ bagId: second, contract: "EQSECOND", linked: false })
    forgetPendingFound([CONTRACT])
    expect(readPendingPaid()).toMatchObject({ bagId: second, contract: "EQSECOND" })
  })

  it("reports the write a locked-down browser refused, so the wizard can warn the link is unsaved", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new DOMException("QuotaExceededError")
      },
      getItem: () => null,
      removeItem: () => undefined,
    })

    expect(writePendingPaid(BAG, CONTRACT)).toBe(false)
    expect(readPendingPaid()).toBeNull()
  })

  it("reads a locked-down storage as no pending payment instead of crashing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("SecurityError")
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    })

    expect(readPendingPaid()).toBeNull()
  })

  it("marks the record linked without touching its payload", () => {
    writePendingPaid(BAG, CONTRACT, "EQOWNER", "backup", 42)
    markPendingLinked()

    expect(readPendingPaid()).toMatchObject({ bagId: BAG, contract: CONTRACT, owner: "EQOWNER", size: 42, linked: true })
  })
})

describe("forgetPendingFound", () => {
  it("forgets a linked record once the scan has met its contract", () => {
    writePendingPaid(BAG, CONTRACT)
    markPendingLinked()

    forgetPendingFound(["EQSOMETHING", CONTRACT])
    expect(store.has(PENDING_PAID_KEY)).toBe(false)
  })

  it("keeps a linked record the scan has not reached", () => {
    writePendingPaid(BAG, CONTRACT)
    markPendingLinked()

    forgetPendingFound(["EQSOMETHING"])
    expect(store.has(PENDING_PAID_KEY)).toBe(true)
  })

  it("never forgets an unlinked record: the backend link still owes a retry", () => {
    writePendingPaid(BAG, CONTRACT)

    forgetPendingFound([CONTRACT])
    expect(store.has(PENDING_PAID_KEY)).toBe(true)
  })
})
