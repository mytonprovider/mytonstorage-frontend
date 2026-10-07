import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { UserRejectsError } from "@tonconnect/ui-react"
import { Ratio } from "@/components/table"
import en from "@/i18n/en.json"
import ru from "@/i18n/ru.json"
import type { ContractStatus, WalletTransaction } from "@/types/contract"
import { ApiError } from "./api"
import { CONTRACT_RESERVE, MIN_BOUNTY, fullBounty } from "./pricing"
import { BYTES_IN_GIB } from "./format"
import { checkKindOf, checkLabelOf } from "./check-label"
import {
  INDEX_LAG_SECONDS,
  PROOF_GRACE_SECONDS,
  STORAGE_CODE_HASH,
  actionFailure,
  contractStatus,
  paymentTone,
  LOW_BALANCE_DAYS,
  countChecks,
  shownChecks,
  discover,
  findClosed,
  loadFailure,
  mergeRows,
  refreshStates,
  runContractAction,
  runPass,
  withPending,
  type ContractRow,
} from "./contracts"
import { knownStateHash, peekState, putState, resetContractCachesForTests } from "./contracts-cache"
import { state, translate } from "./fixtures"
import type { Translate } from "./format"
import { PENDING_KEY } from "./local-storage"
import { forgetPendingFound, markPendingLinked, writePendingPaid } from "./paid-link"
import type { AccountState, AccountStates, ChainMessage, MessagesPage, MessagesQuery } from "./ton/toncenter"
import { ChainRequestError } from "./ton/toncenter"
import type { WalletSender } from "./ton/transactions"
import { loadFailure as unpaidLoadFailure, removeFailure } from "./unpaid-bags"

const { sendAndConfirm } = vi.hoisted(() => ({ sendAndConfirm: vi.fn() }))

vi.mock("./ton/transactions", async (importOriginal) => ({ ...(await importOriginal<object>()), sendAndConfirm }))

const RAW = "0:1111111111111111111111111111111111111111111111111111111111111111"
const FRIENDLY = "EQARERERERERERERERERERERERERERERERERERERERERERGX"
const OWNER = "EQCDrgGaI6gWK-qlyw69xWZosurGxrpRgIgSkVsgahUtxcmx"
const NOW = 1_790_200_000

const message = (extra: Partial<ChainMessage>): ChainMessage => ({
  source: OWNER,
  destination: RAW,
  createdLt: "100",
  createdAt: NOW - 3600,
  ...extra,
})

const pageOf = (messages: ChainMessage[], hasMore = false): MessagesPage => ({
  messages,
  friendly: { [RAW]: FRIENDLY },
  hasMore,
  lastLt: messages[messages.length - 1]?.createdLt ?? null,
})

const feed = (pages: MessagesPage[]) => {
  const asked: MessagesQuery[] = []
  const fetchPage = vi.fn((query: MessagesQuery) => {
    asked.push(query)
    return Promise.resolve(pages[asked.length - 1] ?? pageOf([]))
  })
  return { fetchPage, asked }
}

describe("sweep cursor", () => {
  it("walks past a full page even when nothing on it could be parsed", async () => {
    const seen = message({ createdLt: "100" })
    const blind: MessagesPage = { messages: [], friendly: {}, hasMore: true, lastLt: "200" }
    const { fetchPage, asked } = feed([blind, pageOf([seen])])
    const found = await discover(FRIENDLY, null, { signal: new AbortController().signal, fetchPage, now: NOW })

    expect(asked).toHaveLength(2)
    expect(asked[1].endLt).toBe("199")
    expect(found.found).toHaveLength(1)
  })
})

describe("discover", () => {
  it("dates a contract by its deploy and by the last change of its provider set, resolved through the address book", async () => {
    const { fetchPage } = feed([
      pageOf([
        message({ createdLt: "102", createdAt: NOW - 600 }),
        message({ createdLt: "101", createdAt: NOW - 1800 }),
        message({ createdLt: "100" }),
      ]),
    ])

    const swept = await discover(OWNER, null, { fetchPage, now: NOW })

    expect(swept.found).toEqual([{ address: FRIENDLY, createdAt: NOW - 3600, closed: false, lastEventAt: NOW - 600 }])
    expect(fetchPage).toHaveBeenCalledWith({ source: OWNER, opcode: "0x3dc680ae", startLt: null, endLt: null }, undefined)
  })

  it("walks a full page onto the next one from the last logical time seen, handing each page over as it lands", async () => {
    const { fetchPage, asked } = feed([pageOf([message({ createdLt: "100" })], true), pageOf([message({ createdLt: "200", destination: "0:22" })])])
    const onPage = vi.fn()

    const swept = await discover(OWNER, null, { fetchPage, now: NOW, onPage })

    expect(swept.found.map((contract) => contract.address)).toEqual([FRIENDLY, "0:22"])
    expect(asked.map((query) => [query.startLt, query.endLt])).toEqual([
      [null, null],
      [null, "99"],
    ])
    expect(onPage.mock.calls.map(([page]) => (page as { address: string }[]).map((contract) => contract.address))).toEqual([[FRIENDLY], ["0:22"]])
  })

  it("resumes one past the cursor and moves the cursor only over messages the index has settled", async () => {
    const { fetchPage, asked } = feed([pageOf([message({ createdLt: "300", createdAt: NOW - INDEX_LAG_SECONDS - 1 }), message({ createdLt: "400", createdAt: NOW - 10, destination: "0:22" })])])

    const swept = await discover(OWNER, "250", { fetchPage, now: NOW })

    expect(asked[0].startLt).toBe("251")
    expect(swept.cursor).toBe("300")
    expect(swept.found).toHaveLength(2)
  })

  it("keeps the old cursor when nothing settled came back", async () => {
    const { fetchPage } = feed([pageOf([])])
    expect((await discover(OWNER, "250", { fetchPage, now: NOW })).cursor).toBe("250")
  })

  it("stops once the caller has aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetchPage } = feed([pageOf([message({})], true)])

    const swept = await discover(OWNER, null, { fetchPage, now: NOW, signal: controller.signal })

    expect(fetchPage).not.toHaveBeenCalled()
    expect(swept.found).toEqual([])
  })
})

describe("findClosed", () => {
  it("collects every terminated message the owner received, dated by the message", async () => {
    const { fetchPage } = feed([pageOf([message({ source: RAW, destination: OWNER, createdAt: NOW - 500 }), message({ source: "0:99", destination: OWNER })])])

    const swept = await findClosed(OWNER, null, { fetchPage, now: NOW })

    expect(swept.found.map((event) => [event.address, event.closed])).toEqual([
      [FRIENDLY, true],
      ["0:99", true],
    ])
    expect(fetchPage).toHaveBeenCalledWith({ destination: OWNER, opcode: "0xb6236d63", startLt: null, endLt: null }, undefined)
  })
})

const account = (address: string, extra: Partial<AccountState> = {}): AccountState => ({
  address,
  balance: 224577526,
  codeHash: STORAGE_CODE_HASH,
  stateHash: "hash-1",
  lastLt: "1",
  dataBoc: null,
  ...extra,
})
const row = (address: string, extra: Partial<ContractRow> = {}): ContractRow => ({ address, createdAt: 1, closed: false, bagId: "", description: "", size: 0, valid: 0, total: 0, ...extra })
const BOC = "te6ccgEBAwEAtAAB3fqTpD6+sri6w1C2mrZ/+vRPD50sLs1Fa5u1jVXQu9TmwAg64BmiOoFivqpcsOvcVmaLLqxsa6UYCIEpFbIGoVLcUAAAABAAAAPQAIAAAa7Se4nSjFbVJ2Ot3oRRnVF/A3172ZWTie0UmdNHDwKQ6AEBa6AHUR+2vthbLvj2E+XNNqNDw70ZrL39DXFPB/mnvcMr/gAAAAAZjOcmgAAAAAXkKtIuXlfjkAIADQAnjQAgZcg="
const statesOf = (withBoc = true) =>
  vi.fn((addresses: string[], withData: boolean): Promise<AccountStates> =>
    Promise.resolve({ accounts: addresses.map((address) => account(address, { dataBoc: withData && withBoc ? BOC : null })), friendly: {} }),
  )

describe("refreshStates", () => {
  beforeEach(() => resetContractCachesForTests())

  it("reads every data cell in one go on the first visit, when nothing is cached yet", async () => {
    const fetchStates = statesOf()

    await refreshStates([row("EQA"), row("EQB")], { fetchStates })

    expect(fetchStates).toHaveBeenCalledTimes(1)
    expect(fetchStates.mock.calls[0]).toEqual([["EQA", "EQB"], true, undefined])
  })

  it("reads the data cell only for contracts whose state hash moved and keeps the rest from the cache", async () => {
    putState("EQA", "hash-1", state)
    const fetchStates = vi.fn((addresses: string[], withData: boolean): Promise<AccountStates> =>
      Promise.resolve({
        accounts: addresses.map((address) => account(address, { stateHash: address === "EQB" ? "hash-2" : "hash-1", dataBoc: withData ? BOC : null })),
        friendly: {},
      }),
    )

    await refreshStates([row("EQA"), row("EQB")], { fetchStates })

    expect(fetchStates).toHaveBeenCalledTimes(2)
    expect(fetchStates.mock.calls[0]).toEqual([["EQA", "EQB"], false, undefined])
    expect(fetchStates.mock.calls[1]).toEqual([["EQB"], true, undefined])
  })

  it("drops an open contract whose code is not the storage contract, but keeps a closed one whose account is gone", async () => {
    const fetchStates = vi.fn((): Promise<AccountStates> => Promise.resolve({ accounts: [account("EQA", { codeHash: "other" }), account("EQC", { codeHash: null })], friendly: {} }))

    const rows = await refreshStates([row("EQA"), row("EQC", { closed: true })], { fetchStates })

    expect(rows.map((contract) => contract.address)).toEqual(["EQC"])
  })

  it("reopens a closed row once its account holds more than the reserve, and keeps one left at the reserve closed", async () => {
    const fetchStates = vi.fn((): Promise<AccountStates> =>
      Promise.resolve({ accounts: [account("EQA", { balance: CONTRACT_RESERVE + 1, dataBoc: BOC }), account("EQB", { balance: CONTRACT_RESERVE, dataBoc: BOC })], friendly: {} }),
    )

    const rows = await refreshStates([row("EQA", { closed: true }), row("EQB", { closed: true })], { fetchStates, now: NOW })

    expect(rows.map((contract) => [contract.address, contract.closed, contract.lastEventAt])).toEqual([
      ["EQA", false, NOW],
      ["EQB", true, undefined],
    ])
  })

  it("fills the bag and the size from the state it just read", async () => {
    putState("EQA", "hash-1", state)

    const [refreshed] = await refreshStates([row("EQA")], { fetchStates: statesOf(false) })

    expect(refreshed).toMatchObject({ bagId: state.torrentHash, size: state.fileSize })
    expect(refreshed.state).toBe(peekState("EQA"))
    expect(knownStateHash("EQA")).toBe("hash-1")
  })
})

describe("runPass", () => {
  beforeEach(() => resetContractCachesForTests())

  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => (resolve = done))
    return { promise, resolve }
  }
  const deploys = (addresses: string[], hasMore = false) => pageOf(addresses.map((destination, at) => message({ destination, createdLt: String(100 - at) })), hasMore)
  const io = (pages: MessagesPage[], extra: Partial<Parameters<typeof runPass>[3]> = {}) => {
    const calls: string[] = []
    const pageQueue = [...pages]
    const shown: ContractRow[][] = []
    return {
      calls,
      shown,
      io: {
        signal: new AbortController().signal,
        onUnauthorized: vi.fn(() => false),
        onRows: (rows: ContractRow[]) => void shown.push(rows),
        now: NOW,
        fetchPage: vi.fn((query: MessagesQuery) => {
          calls.push(query.opcode === "0xb6236d63" ? "closed" : "deploys")
          return Promise.resolve(pageQueue.shift() ?? pageOf([]))
        }),
        fetchStates: vi.fn((addresses: string[], withData: boolean): Promise<AccountStates> => {
          calls.push(`states:${addresses.length}`)
          return Promise.resolve({ accounts: addresses.map((address) => account(address, { dataBoc: withData ? BOC : null })), friendly: {} })
        }),
        fetchBags: vi.fn((addresses: string[]) => {
          calls.push(`bags:${addresses.length}`)
          return Promise.resolve(addresses.map((address) => ({ contract_address: address, bag_id: "b", description: "docs", size: 7 })))
        }),
        fetchStatuses: vi.fn((addresses: string[]) => {
          calls.push(`checks:${addresses.length}`)
          return Promise.resolve(addresses.map((address) => ({ address, provider_pubkey: "p", reason: 0, reason_timestamp: 1 })))
        }),
        ...extra,
      },
    }
  }

  it("asks for the next page while the backend answers, but draws it only once the page before is complete", async () => {
    const { calls, shown, io: deps } = io([pageOf([]), deploys(["0:1", "0:2"], true), deploys(["0:3"])])
    const bagsGate = deferred<void>()
    deps.fetchBags = vi.fn((addresses: string[]) => { calls.push(`bags:${addresses.length}`); return bagsGate.promise.then(() => addresses.map((address) => ({ contract_address: address, bag_id: "b", description: "docs", size: 7 }))) })

    const pass = runPass(OWNER, { headLt: null, closedLt: null }, [], deps)
    await new Promise((tick) => setTimeout(tick, 0))
    expect(calls).toEqual(["closed", "deploys", "states:2", "bags:2", "checks:2", "deploys"])
    expect(shown.at(-1)?.map((contract) => contract.address)).toEqual(["0:1", "0:2"])
    bagsGate.resolve()
    await pass

    expect(calls).toEqual(["closed", "deploys", "states:2", "bags:2", "checks:2", "deploys", "states:1", "bags:1", "checks:1"])
    expect((shown.at(-1) ?? []).map((contract) => [contract.address, contract.enriched, contract.total, contract.state !== undefined])).toEqual([
      ["0:1", true, 1, true],
      ["0:2", true, 1, true],
      ["0:3", true, 1, true],
    ])
  })

  it("closes a contract from a terminated message seen before its deploy page, and moves both cursors only at the end", async () => {
    const { shown, io: deps } = io([pageOf([message({ source: "0:2", destination: OWNER, createdLt: "5", createdAt: NOW - 3600 })]), deploys(["0:1", "0:2"])], {
      fetchStates: vi.fn((addresses: string[], withData: boolean): Promise<AccountStates> =>
        Promise.resolve({ accounts: addresses.map((address) => account(address, { ...(address === "0:2" ? { balance: CONTRACT_RESERVE } : {}), dataBoc: withData ? BOC : null })), friendly: {} }),
      ),
    })

    const cursors = await runPass(OWNER, { headLt: null, closedLt: null }, [], deps)

    expect(shown.at(-1)?.find((contract) => contract.address === "0:2")?.closed).toBe(true)
    expect(cursors).toEqual({ headLt: "100", closedLt: "5" })
  })

  it("refreshes every cached row the pages did not mention, closed ones included, and asks the backend only about the open ones", async () => {
    putState("0:9", "hash-1", { ...state, balance: CONTRACT_RESERVE })
    const { calls, shown, io: deps } = io([pageOf([]), pageOf([])])
    const cached = [row("0:8", { enriched: true }), row("0:9", { closed: true, enriched: true, state })]

    await runPass(OWNER, { headLt: "50", closedLt: "5" }, cached, deps)

    expect(calls).toEqual(["closed", "deploys", "states:2", "states:1", "bags:0", "checks:1"])
    expect(shown.at(-1)?.find((contract) => contract.address === "0:9")?.closed).toBe(true)
  })

  it("refreshes only the rows on screen when asked to focus, leaving the rest to the full sweep", async () => {
    const { calls, io: deps } = io([pageOf([]), pageOf([])], { focus: ["0:2"] })
    const cached = [row("0:1", { enriched: true }), row("0:2", { enriched: true }), row("0:3", { enriched: true })]

    await runPass(OWNER, { headLt: "50", closedLt: "5" }, cached, deps)

    expect(calls).toEqual(["closed", "deploys", "states:1", "bags:0", "checks:1"])
    expect(deps.fetchStates).toHaveBeenCalledWith(["0:2"], true, expect.anything())
  })

  it("keeps the checks when the backend refuses the bag details, and asks the backend again next time", async () => {
    const { shown, io: deps } = io([pageOf([]), deploys(["0:1"])], { fetchBags: vi.fn(() => Promise.reject(new Error("502"))) })

    await runPass(OWNER, { headLt: null, closedLt: null }, [], deps)

    expect(shown.at(-1)?.[0]).toMatchObject({ total: 1, valid: 1 })
    expect(shown.at(-1)?.[0].enriched).toBeUndefined()
  })

  it("marks a row the catalog answered nothing about as checked zero times, not as unknown", async () => {
    const { shown, io: deps } = io([pageOf([]), deploys(["0:1"])], { fetchStatuses: vi.fn(() => Promise.resolve([])) })

    await runPass(OWNER, { headLt: null, closedLt: null }, [], deps)

    expect(shown.at(-1)?.[0]).toMatchObject({ pending: 0, total: 0 })
  })

  it("reports an ended session once and leaves the chain facts it already drew", async () => {
    const onUnauthorized = vi.fn(() => true)
    const { shown, io: deps } = io([pageOf([]), deploys(["0:1"])], { fetchBags: vi.fn(() => Promise.reject(new ApiError(401, "POST", "/files/details"))), onUnauthorized })

    await runPass(OWNER, { headLt: null, closedLt: null }, [], deps)

    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(shown.at(-1)?.[0].state).toBeDefined()
  })

  it("lets the chain failure surface and keeps the cursors where they were", async () => {
    const { io: deps } = io([pageOf([])], { fetchPage: vi.fn((query: MessagesQuery) => (query.opcode === "0xb6236d63" ? Promise.resolve(pageOf([])) : Promise.reject(new ChainRequestError("messages", 429)))) })

    await expect(runPass(OWNER, { headLt: "7", closedLt: "3" }, [], deps)).rejects.toBeInstanceOf(ChainRequestError)
  })
})

describe("mergeRows", () => {
  const row = (address: string, extra: Partial<ContractRow> = {}): ContractRow => ({
    address,
    createdAt: 100,
    closed: false,
    bagId: "abc",
    description: "docs",
    size: 5,
    valid: 1,
    total: 2,
    ...extra,
  })

  it("keeps the enrichment of a known row when the scan repeats it", () => {
    const merged = mergeRows([row("EQA")], [{ address: "EQA", createdAt: 100, closed: false }])
    expect(merged[0]).toMatchObject({ bagId: "abc", description: "docs", size: 5, valid: 1, total: 2 })
  })

  it("closes a row from a terminated event and keeps the original creation date", () => {
    const merged = mergeRows([row("EQA")], [{ address: "EQA", createdAt: 200, closed: true }])
    expect(merged[0]).toMatchObject({ closed: true, createdAt: 100, lastEventAt: 200 })
  })

  it("reopens a closed row when the owner's next provider change comes after the termination", () => {
    const merged = mergeRows([row("EQA", { closed: true, lastEventAt: 200 })], [{ address: "EQA", createdAt: 100, closed: false, lastEventAt: 300 }])
    expect(merged[0]).toMatchObject({ closed: false, createdAt: 100, lastEventAt: 300 })
  })

  it("keeps a row closed when the deploy sweep only brings events older than the termination", () => {
    const merged = mergeRows([row("EQA", { closed: true, lastEventAt: 200 })], [{ address: "EQA", createdAt: 100, closed: false }])
    expect(merged[0]).toMatchObject({ closed: true, lastEventAt: 200 })
  })

  it("gives a brand-new address empty enrichment to fill later", () => {
    const merged = mergeRows([], [{ address: "EQB", createdAt: 300, closed: false }])
    expect(merged[0]).toEqual({
      address: "EQB",
      createdAt: 300,
      lastEventAt: 300,
      closed: false,
      bagId: "",
      description: "",
      size: 0,
      valid: 0,
      total: 0,
    })
  })

  it("sorts rows newest first", () => {
    const merged = mergeRows([row("EQA")], [{ address: "EQB", createdAt: 300, closed: false }])
    expect(merged.map((contract) => contract.address)).toEqual(["EQB", "EQA"])
  })
})

describe("withPending", () => {
  const store = new Map<string, string>()
  const OWNER = "EQOWNER"
  const FRESH = "EQFRESH"

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
  })

  const remember = (extra: Record<string, unknown> = {}): void =>
    void store.set(
      PENDING_KEY,
      JSON.stringify({
        bagId: "f".repeat(64),
        contract: FRESH,
        at: 5000,
        owner: OWNER,
        description: "backup",
        size: 42,
        linked: true,
        ...extra,
      }),
    )

  const row = (address: string, createdAt: number): ContractRow => ({
    address,
    createdAt,
    closed: false,
    bagId: "abc",
    description: "docs",
    size: 5,
    valid: 1,
    total: 2,
  })

  it("puts the freshly paid contract on top as a checking row until the scan meets it", () => {
    remember()

    const rows = withPending([row("EQA", 1)], OWNER)

    expect(rows.map((contract) => contract.address)).toEqual([FRESH, "EQA"])
    expect(rows[0]).toEqual({
      address: FRESH,
      createdAt: 5,
      closed: false,
      bagId: "f".repeat(64),
      description: "backup",
      size: 42,
      valid: 0,
      total: 0,
    })
    expect(contractStatus(rows[0], NOW)).toBeNull()
  })

  it("builds the same row the wizard write and link leave behind", () => {
    writePendingPaid("f".repeat(64), FRESH, OWNER, "backup", 42)
    markPendingLinked()

    const rows = withPending([], OWNER)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ address: FRESH, bagId: "f".repeat(64), description: "backup", size: 42, valid: 0, total: 0 })
  })

  it("keeps the instant row enriched when the scan meets it later and stops re-adding once the record is gone", () => {
    remember()
    const shown = withPending([], OWNER)

    forgetPendingFound([FRESH])
    const merged = mergeRows(shown, [{ address: FRESH, createdAt: 6000, closed: false }])

    expect(store.has(PENDING_KEY)).toBe(false)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ address: FRESH, bagId: "f".repeat(64), description: "backup", size: 42, createdAt: 5 })
    expect(withPending(merged, OWNER)).toBe(merged)
  })

  it("lets the scan portion beat the instant row: the forgotten record adds nothing on top of the scanned contract", () => {
    remember()
    forgetPendingFound([FRESH])
    const scanned = mergeRows([], [{ address: FRESH, createdAt: 6000, closed: false }])
    const rows = withPending(scanned, OWNER)

    expect(store.has(PENDING_KEY)).toBe(false)
    expect(rows).toBe(scanned)
    expect(rows.map((contract) => contract.address)).toEqual([FRESH])
  })

  it("hands back the very same list once the scan already knows the address", () => {
    remember()

    const rows = [row(FRESH, 1)]
    expect(withPending(rows, OWNER)).toBe(rows)
  })

  it("never shows the record of another wallet or of a deploy that was not confirmed", () => {
    remember({ owner: "EQSOMEONE" })
    expect(withPending([], OWNER)).toEqual([])

    remember({ linked: false })
    expect(withPending([], OWNER)).toEqual([])
  })

  it("skips a record written before rows carried an owner", () => {
    remember({ owner: undefined })
    expect(withPending([], OWNER)).toEqual([])
    expect(withPending([], "")).toEqual([])
  })
})

describe("countChecks", () => {
  const statuses = [
    { address: "EQA", provider_pubkey: "a", reason: 0, reason_timestamp: null },
    { address: "EQA", provider_pubkey: "b", reason: 401, reason_timestamp: null },
    { address: "EQB", provider_pubkey: "c", reason: 0, reason_timestamp: null },
  ]

  it("counts only the checks belonging to the given contract", () => {
    expect(countChecks(statuses, "EQA")).toEqual({ valid: 1, total: 2, pending: 0, stored: ["a"] })
  })

  it("reports an unchecked contract as zero of zero", () => {
    expect(countChecks(statuses, "EQC")).toEqual({ valid: 0, total: 0, pending: 0, stored: [] })
  })

  it("counts a check that has not run yet in the denominator and names it pending", () => {
    const pending: ContractStatus = { address: "EQA", provider_pubkey: "d", reason: null, reason_timestamp: null }
    expect(countChecks([...statuses, pending], "EQA")).toEqual({ valid: 1, total: 3, pending: 1, stored: ["a"] })
  })
})

describe("shownChecks", () => {
  const key = (seed: string) => seed.repeat(64).slice(0, 64)
  const provider = (pubkey: string) => ({ pubkey, ratePerMbDay: 1, maxSpan: 86400, lastProofTime: 0 })
  const state = { torrentHash: "", fileSize: 1, balance: 1, providers: ["a", "b", "c", "d", "e", "f"].map((seed) => provider(key(seed))) }

  it("counts the backend confirmations against every provider the chain holds, not against the rows the backend returned", () => {
    expect(shownChecks({ valid: 2, total: 2, pending: 0, stored: [key("a"), key("b")], state })).toEqual({ valid: 2, total: 6 })
  })

  it("does not count a confirmation for a provider the contract no longer hires, whatever case the backend wrote the key in", () => {
    const narrow = { ...state, providers: [provider(key("a"))] }
    expect(shownChecks({ valid: 2, total: 2, pending: 0, stored: [key("A").toUpperCase(), key("z")], state: narrow })).toEqual({ valid: 1, total: 1 })
  })

  it("shows nothing until both the backend and the chain have answered, and the backend rows alone when the chain has no account", () => {
    expect(shownChecks({ valid: 2, total: 2, pending: 0, stored: [], state: undefined })).toBe(null)
    expect(shownChecks({ valid: 2, total: 2, pending: undefined, stored: [], state })).toBe(null)
    expect(shownChecks({ valid: 2, total: 3, pending: 0, stored: [], state: null })).toEqual({ valid: 2, total: 3 })
  })
})

describe("runContractAction", () => {
  const transaction: WalletTransaction = { address: "EQA", amount: 1e9, body: "", state_init: "" }
  const sender: WalletSender = { sendTransaction: () => Promise.reject(new Error("unused")) }

  beforeEach(() => {
    sendAndConfirm.mockReset()
  })

  it("refuses to start a second action while one is still in flight", async () => {
    const lock = { current: null as string | null }
    let settle: (confirmed: boolean) => void = () => {}
    sendAndConfirm.mockReturnValue(new Promise<boolean>((resolve) => (settle = resolve)))

    const first = runContractAction(lock, sender, "EQA", () => Promise.resolve(transaction))
    const build = vi.fn(() => Promise.resolve(transaction))

    expect(runContractAction(lock, sender, "EQB", build)).toBe(null)
    expect(build).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(sendAndConfirm).toHaveBeenCalledTimes(1)

    settle(true)
    await expect(first).resolves.toBe(null)
    expect(lock.current).toBe(null)
  })

  it("names a confirmation that never arrived with the agreed key, not a failure", async () => {
    sendAndConfirm.mockResolvedValue(false)

    const outcome = await runContractAction({ current: null }, sender, "EQA", () => Promise.resolve(transaction))

    expect(outcome).toEqual({ key: "errors.confirmTimeout", status: null, kind: "action" })
  })

  it("keeps a wallet refusal apart from a confirmed action, without naming it a failure", async () => {
    const lock = { current: null as string | null }
    sendAndConfirm.mockRejectedValue(new UserRejectsError())

    await expect(runContractAction(lock, sender, "EQA", () => Promise.resolve(transaction))).resolves.toBe("refused")
    expect(lock.current).toBe(null)
  })

  it("hands any other failure to the caller instead of hushing it", async () => {
    sendAndConfirm.mockRejectedValue(new ApiError(429, "POST", "/api/v1/contracts/topup", "too many requests"))

    await expect(runContractAction({ current: null }, sender, "EQA", () => Promise.resolve(transaction))).rejects.toBeInstanceOf(
      ApiError,
    )
  })

  it("keeps the timeout wording byte for byte as the owner set it", () => {
    expect(en.errors.confirmTimeout).toBe(
      "No confirmation arrived in time — if you signed the transaction, it will land and the list will refresh itself.",
    )
    expect(ru.errors.confirmTimeout).toBe(
      "Подтверждение не пришло вовремя — если вы подписали транзакцию, она дойдёт и список обновится сам.",
    )
  })
})

describe("loadFailure and actionFailure", () => {
  const unreachable = new ChainRequestError("transactions", 502)
  const refused = new ApiError(429, "POST", "/api/v1/contracts/topup", "too many requests")

  it("names the kind of failure as a value, since only a reading can be read again", () => {
    expect(loadFailure(unreachable).kind).toBe("load")
    expect(actionFailure(refused).kind).toBe("action")
  })

  it("carries the response code beside the key, whichever of the two failed", () => {
    expect(loadFailure(unreachable)).toMatchObject({ key: "errors.failedToLoadContracts", status: 502 })
    expect(actionFailure(refused)).toMatchObject({ key: "errors.rateLimited", status: 429 })
  })

  it("keeps a chain failure out of the backend status, and a network drop without one", () => {
    expect(loadFailure(new Error("offline")).status).toBeNull()
    expect(actionFailure(unreachable).status).toBeNull()
  })
})

describe("loadFailure and removeFailure of the unpaid list", () => {
  const unreadable = new ApiError(502, "GET", "/api/v1/bags", "bad gateway")
  const refusedRemoval = new ApiError(429, "DELETE", "/api/v1/bags", "too many requests")
  const expired = new ApiError(401, "GET", "/api/v1/bags", "unauthorized")

  it("names the kind of failure of the unpaid list too, since only a reading can be read again", () => {
    expect(unpaidLoadFailure(unreadable).kind).toBe("load")
    expect(removeFailure(refusedRemoval).kind).toBe("remove")
  })

  it("carries the response code beside a locale key for the unpaid list as well", () => {
    expect(unpaidLoadFailure(unreadable)).toMatchObject({ key: "errors.unpaidUnknown", status: 502 })
    expect(removeFailure(refusedRemoval)).toMatchObject({ key: "errors.removeFailed", status: 429 })
    expect(removeFailure(new Error("offline")).status).toBeNull()
  })

  it("keeps the ended session under its own key on both paths", () => {
    expect(unpaidLoadFailure(expired).key).toBe("errors.unauthorized")
    expect(removeFailure(expired).key).toBe("errors.unauthorized")
  })
})

describe("Ratio", () => {
  beforeAll(async () => {
    await i18n.use(initReactI18next).init({ resources: { en: { translation: en } }, lng: "en" })
  })

  const shown = (valid: number, total: number): string =>
    renderToStaticMarkup(createElement(Ratio, { valid, total })).replace(/<[^>]*>/g, "")

  it("names the unchecked state instead of printing an empty fraction", () => {
    expect(shown(0, 0)).toBe("No checks")
  })

  it("keeps the fraction once a check has run", () => {
    expect(shown(1, 3)).toBe("1/3")
    expect(shown(0, 2)).toBe("0/2")
  })
})

describe("checkLabelOf", () => {
  const NOW = 1785545100
  const PHRASED = new Set([
    "details.checkOk",
    "details.checkAgo",
    "reason.0",
    "reason.401",
    "status.notStored",
    "status.unchecked",
    "status.unknownReason",
  ])

  const t: Translate = (key, options) => {
    const names = Array.isArray(key) ? key : [key]
    const found = names.find((name) => PHRASED.has(name)) ?? names[names.length - 1]
    return options?.time === undefined ? translate(found, options) : `${found}(${options.time})`
  }

  const statusOf = (reason: number | null, at: number | null = null): ContractStatus => ({
    address: "EQA",
    provider_pubkey: "a",
    reason,
    reason_timestamp: at,
  })

  it("gives no verdict on a check that has not run yet", () => {
    expect(checkLabelOf(statusOf(null), NOW, t)).toBeNull()
  })

  it("keeps zero healthy and dates a failed code from the given moment", () => {
    expect(checkLabelOf(statusOf(0), NOW, t)).toEqual({
      kind: "stored",
      tone: "green",
      short: "details.checkOk",
      long: "reason.0",
      at: 0,
      ago: "",
      agoShort: "",
    })
    expect(checkLabelOf(statusOf(401, NOW - 7200), NOW, t)).toEqual({
      kind: "notStored",
      tone: "red",
      short: "status.notStored",
      long: "reason.401",
      at: NOW - 7200,
      ago: "details.checkAgo(2.hr)",
      agoShort: "provider.ago(2.hr)",
    })
  })

  it("files a code nobody translated under unchecked and names the code in the reason", () => {
    expect(checkLabelOf(statusOf(599), NOW, t)).toEqual({
      kind: "unchecked",
      tone: "gray",
      short: "status.unchecked",
      long: "status.unknownReason",
      at: 0,
      ago: "",
      agoShort: "",
    })
  })

  it("blames the provider only for codes the checker reached it with", () => {
    expect([301, 302, 401, 402, 403].map(checkKindOf)).toEqual(Array(5).fill("notStored"))
    expect([101, 103, 201, 203].map(checkKindOf)).toEqual(Array(4).fill("unavailable"))
    expect([102, 104, 105, 202].map(checkKindOf)).toEqual(Array(4).fill("unchecked"))
  })
})

describe("paymentTone", () => {
  it("tells money that already ran out from money that is about to", () => {
    expect(paymentTone(null)).toBeNull()
    expect(paymentTone(0)).toBe("red")
    expect(paymentTone(0.99)).toBe("red")
    expect(paymentTone(1)).toBe("yellow")
    expect(paymentTone(LOW_BALANCE_DAYS - 0.01)).toBe("yellow")
    expect(paymentTone(LOW_BALANCE_DAYS)).toBeNull()
  })
})

describe("contractStatus", () => {
  const week = 7 * 86400
  const rate = 8797
  const provider = (lastProofTime: number, maxSpan = week) => ({ pubkey: "p" + lastProofTime + maxSpan, ratePerMbDay: rate, maxSpan, lastProofTime })
  const stateWith = (balance: number, ...proofs: number[]) => ({ ...state, fileSize: BYTES_IN_GIB, balance, providers: proofs.map((at) => provider(at)) })
  const hourly = (balance: number, lastProofTime: number) => ({ ...state, fileSize: BYTES_IN_GIB, balance, providers: [provider(lastProofTime, 3600)] })
  const rich = 10 * fullBounty(BYTES_IN_GIB, rate, week)
  const HIRED = NOW - 30 * 86400
  const verdictOf = (contract: Parameters<typeof contractStatus>[0], now: number): string | undefined => contractStatus(contract, now)?.word
  const row = (chain: ReturnType<typeof stateWith> | null | undefined, createdAt = HIRED, lastEventAt?: number) => ({
    closed: false,
    createdAt,
    lastEventAt,
    state: chain,
    valid: 1,
    total: 1,
  })

  it("marks a closed contract regardless of the chain", () => {
    expect(contractStatus({ ...row(stateWith(rich, NOW)), closed: true }, NOW)).toEqual({ tone: "gray", word: "files.closed" })
  })

  it("gives no verdict at all until the chain has answered", () => {
    expect(contractStatus(row(undefined), NOW)).toBeNull()
  })

  it("tells a chain that answered nothing from a contract with nobody hired", () => {
    expect(contractStatus(row(null), NOW)).toEqual({ tone: "gray", word: "status.noData" })
    expect(contractStatus(row(stateWith(rich)), NOW)).toEqual({ tone: "gray", word: "files.statusNotHired" })
  })

  it("gives a provider a day to download before it has to prove anything", () => {
    expect(verdictOf(row(hourly(rich, 0), NOW - 86400 + 60), NOW)).toBe("files.statusStarting")
    expect(verdictOf(row(hourly(rich, 0), NOW - 86400 - 60), NOW)).toBe("files.statusNone")
  })

  it("gives a day from the hire whatever the period: the first proof follows the download, not the period", () => {
    expect(verdictOf(row(stateWith(rich, 0), NOW - 86400 + 60), NOW)).toBe("files.statusStarting")
    expect(verdictOf(row(stateWith(rich, 0), NOW - 2 * 86400), NOW)).toBe("files.statusNone")
  })

  it("stretches that window for a bag nobody could fetch in a day, up to its period", () => {
    const huge = (proof: number) => ({ ...stateWith(rich, proof), fileSize: 1024 * BYTES_IN_GIB })
    expect(verdictOf(row(huge(0), NOW - 2 * 86400), NOW)).toBe("files.statusStarting")
    expect(verdictOf(row(huge(0), NOW - 3 * 86400), NOW)).toBe("files.statusNone")
  })

  it("counts that wait from the last change of the set, since a change resets the proofs", () => {
    expect(verdictOf(row(stateWith(rich, 0), NOW - 365 * 86400, NOW - 60), NOW)).toBe("files.statusStarting")
    expect(verdictOf(row(stateWith(rich, 0), NOW - 365 * 86400), NOW)).toBe("files.statusNone")
  })

  it("names the money only once a provider is already late with nothing left to pay it", () => {
    const late = NOW - week - PROOF_GRACE_SECONDS - 60
    expect(contractStatus(row(stateWith(MIN_BOUNTY - 1, late)), NOW)).toEqual({ tone: "red", word: "files.statusUnpaid" })
    expect(verdictOf(row(stateWith(MIN_BOUNTY - 1, NOW - 3600)), NOW)).toBe("files.statusStored")
  })

  it("greens a contract every provider has proven within its period", () => {
    expect(verdictOf(row(stateWith(rich, NOW - 3600, NOW - week + 60)), NOW)).toBe("files.statusStored")
  })

  it("keeps a contract stored while a proof runs late by less than a tenth of its period", () => {
    const due = NOW - week - Math.round(week * 0.1)
    expect(verdictOf(row(stateWith(rich, due + 60)), NOW)).toBe("files.statusStored")
    expect(verdictOf(row(stateWith(rich, due - 120)), NOW)).toBe("files.statusNone")
  })

  it("still names the money by the hour the daemon waits, not by that tenth", () => {
    const late = NOW - week - PROOF_GRACE_SECONDS - 60
    expect(verdictOf(row(stateWith(MIN_BOUNTY - 1, late)), NOW)).toBe("files.statusUnpaid")
    expect(verdictOf(row(stateWith(MIN_BOUNTY - 1, late + 120)), NOW)).toBe("files.statusStored")
  })

  it("treats the reserve the contract may never spend as money it does not have", () => {
    const late = NOW - week - PROOF_GRACE_SECONDS - 60
    const owed = fullBounty(BYTES_IN_GIB, rate, week)
    expect(verdictOf(row(stateWith(owed + CONTRACT_RESERVE - 1, late)), NOW)).toBe("files.statusUnpaid")
    expect(verdictOf(row(stateWith(owed + CONTRACT_RESERVE, late)), NOW)).not.toBe("files.statusUnpaid")
  })

  it("never stretches that window past the period, since the proof falls due with it", () => {
    const span = 2 * 86400
    const size = 1024 * BYTES_IN_GIB
    const huge = { ...state, fileSize: size, balance: 10 * fullBounty(size, rate, span), providers: [provider(0, span)] }
    expect(verdictOf(row(huge, NOW - span + 3600), NOW)).toBe("files.statusStarting")
    expect(verdictOf(row(huge, NOW - span - 7200), NOW)).toBe("files.statusNone")
  })

  it("cuts the download window to a day once the catalog checked everyone and confirmed nobody", () => {
    const fresh = NOW - 2 * 86400
    const huge = { ...stateWith(rich, 0), fileSize: 1024 * BYTES_IN_GIB }
    const checked = { ...row(huge, fresh), valid: 0, total: 3 }
    expect(contractStatus(checked, NOW)?.word).toBe("files.statusNone")
    expect(contractStatus({ ...checked, valid: 1 }, NOW)?.word).toBe("files.statusStarting")
    expect(contractStatus({ ...checked, valid: 0, total: 0 }, NOW)?.word).toBe("files.statusStarting")
  })

  it("calls a contract partially stored while one provider still proves and another does not", () => {
    expect(verdictOf(row(stateWith(rich, NOW - 3600, NOW - 2 * week)), NOW)).toBe("files.statusPartial")
    expect(verdictOf(row(stateWith(rich, NOW - 3600, 0), NOW - 365 * 86400), NOW)).toBe("files.statusPartial")
  })
})
