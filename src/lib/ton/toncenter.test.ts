import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const MIN_GAP_MS = 1250

const load = async () => {
  vi.resetModules()
  return import("./toncenter")
}

const okStack = () => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ exit_code: 0, stack: [] }),
})

const exited = (code: number) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ exit_code: code, stack: [] }),
})

const tooMany = () => ({
  ok: false,
  status: 429,
  json: () => Promise.resolve({}),
})

const addressOf = (body: string): string => (JSON.parse(body) as { address: string }).address

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("toncenter queue", () => {
  it("keeps the rate-limit gap between two calls asked for at the same moment", async () => {
    const startedAt: number[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        startedAt.push(Date.now())
        return Promise.resolve(okStack())
      }),
    )

    const { runGetMethod } = await load()
    const both = Promise.all([runGetMethod("EQFIRST", "get_storage_info"), runGetMethod("EQSECOND", "get_storage_info")])
    await vi.advanceTimersByTimeAsync(5 * MIN_GAP_MS)
    await both

    expect(startedAt).toHaveLength(2)
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(MIN_GAP_MS)
  })

  it("puts a retry after 429 behind the calls already waiting, instead of holding them", async () => {
    const asked: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { body: string }) => {
        const address = addressOf(init.body)
        asked.push(address)
        return Promise.resolve(address === "EQLIMITED" && asked.length === 1 ? tooMany() : okStack())
      }),
    )

    const { runGetMethod } = await load()
    const both = Promise.all([
      runGetMethod("EQLIMITED", "get_storage_info"),
      runGetMethod("EQWAITING", "get_storage_info"),
    ])
    await vi.advanceTimersByTimeAsync(10 * MIN_GAP_MS)
    await both

    expect(asked).toEqual(["EQLIMITED", "EQWAITING", "EQLIMITED"])
  })

  it("waits out the whole gap after a 429, counting from the refusal, not from the request", async () => {
    const SLOW_MS = 3 * MIN_GAP_MS
    const startedAt: number[] = []
    let refusedAt = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        startedAt.push(Date.now())
        if (startedAt.length > 1) return Promise.resolve(okStack())
        return new Promise((resolve) =>
          setTimeout(() => {
            refusedAt = Date.now()
            resolve(tooMany())
          }, SLOW_MS),
        )
      }),
    )

    const { runGetMethod } = await load()
    const call = runGetMethod("EQLIMITED", "get_storage_info")
    await vi.advanceTimersByTimeAsync(SLOW_MS + 5 * MIN_GAP_MS)
    await call

    expect(startedAt).toHaveLength(2)
    expect(startedAt[1] - refusedAt).toBeGreaterThanOrEqual(MIN_GAP_MS)
  })

  it("stops retrying after three repeats and reports the refusal", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(tooMany()))
    vi.stubGlobal("fetch", fetchMock)

    const { runGetMethod } = await load()
    const call = runGetMethod("EQLIMITED", "get_storage_info")
    const refused = expect(call).rejects.toThrow("429")
    await vi.advanceTimersByTimeAsync(20 * MIN_GAP_MS)
    await refused

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe("fetchTransactions", () => {
  it("carries the response code as a value, so the contracts list shows it without reading the message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })))

    const { fetchTransactions, ChainRequestError } = await load()
    const failed = await fetchTransactions("EQOWNER", 100, null).catch((error: unknown) => error)

    expect(failed).toBeInstanceOf(ChainRequestError)
    expect((failed as InstanceType<typeof ChainRequestError>).status).toBe(500)
  })
})

describe("runGetMethod", () => {
  it("hands the exit code to the caller as a value, so a silent contract is told apart from a broken call", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(exited(-13))))

    const { runGetMethod, GetMethodError } = await load()
    const failed = await runGetMethod("EQSILENT", "get_storage_info").catch((error: unknown) => error)

    expect(failed).toBeInstanceOf(GetMethodError)
    expect((failed as InstanceType<typeof GetMethodError>).exitCode).toBe(-13)
    expect((failed as Error).message).toBe("get_storage_info exited with -13")
  })

  it("leaves the exit code empty when the chain answered without one", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ stack: [] }) })))

    const { runGetMethod } = await load()
    const failed = (await runGetMethod("EQSILENT", "get_storage_info").catch((error: unknown) => error)) as Error & {
      exitCode: number | null
    }

    expect(failed.exitCode).toBeNull()
    expect(failed.message).toBe("get_storage_info exited with undefined")
  })
})
