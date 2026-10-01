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

const OWNER = "0:83AE019A23A8162BEAA5CB0EBDC56668B2EAC6C6BA51808812915B206A152DC5"
const CONTRACT = "0:129EDAF43C14BD0EBF6682A44D5E994839242923CE4460B241CBB11C231E7FF8"
const CONTRACT_FRIENDLY = "EQASntr0PBS9Dr9mgqRNXplIOSQpI85EYLJBy7EcIx5_-Bxx"
const CODE_HASH = "OFpfDduEHBfdUYoyfDItfQmOkceV65oVL+m+XNIOQMk="

const messagesBody = (messages: unknown[]) => ({
  messages,
  address_book: { [CONTRACT]: { user_friendly: CONTRACT_FRIENDLY, domain: null, interfaces: null } },
})

const deployMessage = {
  source: OWNER,
  destination: CONTRACT,
  created_lt: "105173247000002",
  created_at: "1790087011",
  opcode: "0x3dc680ae",
  init_state: { hash: "…", body: "…" },
}

const modifyMessage = { ...deployMessage, created_lt: "105353167000002", created_at: "1790158954", init_state: null }

const json = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })

describe("fetchMessages", () => {
  it("reads a deploy and a later modify of the same contract, keeping the address book", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(messagesBody([deployMessage, modifyMessage])))))

    const { fetchMessages } = await load()
    const page = await fetchMessages({ source: OWNER, opcode: "0x3dc680ae" })

    expect(page.messages).toEqual([
      { source: OWNER, destination: CONTRACT, createdLt: "105173247000002", createdAt: 1790087011 },
      { source: OWNER, destination: CONTRACT, createdLt: "105353167000002", createdAt: 1790158954 },
    ])
    expect(page.friendly[CONTRACT]).toBe(CONTRACT_FRIENDLY)
    expect(page.hasMore).toBe(false)
  })

  it("asks for a full page ascending from the cursor and reports when the page came back full", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve(json(messagesBody(Array.from({ length: 500 }, () => modifyMessage)))))
    vi.stubGlobal("fetch", fetchMock)

    const { fetchMessages, MESSAGES_PAGE } = await load()
    const page = await fetchMessages({ destination: OWNER, opcode: "0xb6236d63", startLt: "105353167000003" })

    const url = new URL(fetchMock.mock.calls[0][0], "http://localhost")
    expect(url.pathname.endsWith("/api/v3/messages")).toBe(true)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      opcode: "0xb6236d63",
      limit: String(MESSAGES_PAGE),
      sort: "asc",
      destination: OWNER,
      start_lt: "105353167000003",
    })
    expect(page.messages).toHaveLength(500)
    expect(page.hasMore).toBe(true)
  })

  it("takes the cursor from the last message on the page, even one it could not read", async () => {
    const unreadable = { ...modifyMessage, source: null, created_lt: "105353167000009" }
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(messagesBody([deployMessage, unreadable])))))

    const { fetchMessages } = await load()
    const page = await fetchMessages({ source: OWNER, opcode: "0x3dc680ae" })

    expect(page.messages).toHaveLength(1)
    expect(page.lastLt).toBe("105353167000009")
  })

  it("has no cursor to offer when the page came back empty", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(messagesBody([])))))

    const { fetchMessages } = await load()
    const page = await fetchMessages({ source: OWNER, opcode: "0x3dc680ae" })

    expect(page.lastLt).toBeNull()
    expect(page.hasMore).toBe(false)
  })

  it("carries the response code as a value", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) })))

    const { fetchMessages, ChainRequestError } = await load()
    const failed = await fetchMessages({ source: OWNER, opcode: "0x3dc680ae" }).catch((error: unknown) => error)

    expect(failed).toBeInstanceOf(ChainRequestError)
    expect((failed as InstanceType<typeof ChainRequestError>).status).toBe(502)
  })
})

const accountBody = (address: string, extra: Record<string, unknown> = {}) => ({
  address,
  balance: "224577526",
  code_hash: CODE_HASH,
  account_state_hash: "U/4oPxnpplE=",
  last_transaction_lt: "105353167000003",
  ...extra,
})

describe("fetchAccountStates", () => {
  it("reads balance, hashes and the data cell as values, leaving what the chain did not send empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          json({
            accounts: [accountBody(CONTRACT, { data_boc: "te6…" }), { address: "0:0001", balance: "50496254", status: "uninit" }],
            address_book: { [CONTRACT]: { user_friendly: CONTRACT_FRIENDLY } },
          }),
        ),
      ),
    )

    const { fetchAccountStates } = await load()
    const { accounts, friendly } = await fetchAccountStates([CONTRACT, "0:0001"], true)

    expect(accounts).toEqual([
      { address: CONTRACT, balance: 224577526, codeHash: CODE_HASH, stateHash: "U/4oPxnpplE=", lastLt: "105353167000003", dataBoc: "te6…" },
      { address: "0:0001", balance: 50496254, codeHash: null, stateHash: null, lastLt: null, dataBoc: null },
    ])
    expect(friendly[CONTRACT]).toBe(CONTRACT_FRIENDLY)
  })

  it("splits a long list into batches the endpoint accepts and merges the answers", async () => {
    const fetchMock = vi.fn((url: string) => {
      const asked = new URL(url, "http://localhost").searchParams.get("address")?.split(",") ?? []
      return Promise.resolve(json({ accounts: asked.map((address) => accountBody(address)), address_book: {} }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const { fetchAccountStates, ADDRESS_BATCH } = await load()
    const addresses = Array.from({ length: ADDRESS_BATCH + 1 }, (_, at) => `0:${String(at).padStart(64, "0")}`)
    const pending = fetchAccountStates(addresses, false)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    const { accounts } = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(fetchMock.mock.calls[0][0], "http://localhost").searchParams.get("include_boc")).toBe("false")
    expect(accounts).toHaveLength(ADDRESS_BATCH + 1)
    expect(accounts[ADDRESS_BATCH].address).toBe(addresses[ADDRESS_BATCH])
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

describe("chain answers that cannot be trusted", () => {
  const answer = (body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })))

  it("drops a transaction whose logical time is not a number instead of throwing out of BigInt", async () => {
    answer({
      transactions: [
        { lt: "40", now: 1, out_msgs: [], in_msg: {} },
        { lt: "not a number", now: 2, out_msgs: [], in_msg: {} },
        { lt: null, now: 3, out_msgs: [], in_msg: {} },
      ],
    })

    const { fetchTransactions } = await load()
    const page = await fetchTransactions("EQA", 3, null)

    expect(page.transactions.map((transaction) => transaction.lt)).toEqual(["40"])
    expect(page.nextLt).toBeNull()
  })

  it("keeps the page boundary only when it is a real logical time", async () => {
    answer(messagesBody([{ source: OWNER, destination: CONTRACT, created_lt: "oops", created_at: "5" }]))

    const { fetchMessages } = await load()
    const page = await fetchMessages({ opcode: "0x3dc680ae", source: OWNER })

    expect(page.messages).toHaveLength(0)
    expect(page.lastLt).toBeNull()
  })
})
