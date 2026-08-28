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
import { checkLabelOf } from "./check-label"
import {
  OPCODE_CLOSE,
  OPCODE_DEPLOY,
  actionFailure,
  contractTone,
  contractsFromPage,
  countChecks,
  loadFailure,
  mergeRows,
  requeueEconomics,
  runContractAction,
  scanContracts,
  withPending,
  type ContractRow,
} from "./contracts"
import { economicsFrom } from "./contracts-cache"
import { economics, translate } from "./fixtures"
import type { Translate } from "./format"
import { PENDING_PAID_KEY } from "./local-storage"
import { forgetPendingFound, markPendingLinked, writePendingPaid } from "./paid-link"
import type { ChainTransaction, TransactionsPage } from "./ton/toncenter"
import { ChainRequestError, nextCursor } from "./ton/toncenter"
import type { WalletSender } from "./ton/transactions"
import { loadFailure as unpaidLoadFailure, removeFailure } from "./unpaid-bags"

const { sendAndConfirm } = vi.hoisted(() => ({ sendAndConfirm: vi.fn() }))

vi.mock("./ton/transactions", async (importOriginal) => ({ ...(await importOriginal<object>()), sendAndConfirm }))

const RAW = "0:1111111111111111111111111111111111111111111111111111111111111111"
const FRIENDLY = "EQARERERERERERERERERERERERERERERERERERERERERERGX"

const pageWith = (opcode: string | null, destination: string | null): TransactionsPage => ({
  transactions: [{ lt: "1", now: 1785545100, out_msgs: [{ opcode, destination, created_at: 1785545000 }] }],
  friendly: { [RAW]: FRIENDLY },
  nextLt: null,
  hasMore: false,
})

describe("contractsFromPage", () => {
  it("keeps only the deploy and close opcodes", () => {
    expect(contractsFromPage(pageWith(OPCODE_DEPLOY, RAW))).toHaveLength(1)
    expect(contractsFromPage(pageWith(OPCODE_CLOSE, RAW))).toHaveLength(1)
    expect(contractsFromPage(pageWith("0xdeadbeef", RAW))).toHaveLength(0)
  })

  it("marks a close transaction as a closed contract", () => {
    expect(contractsFromPage(pageWith(OPCODE_CLOSE, RAW))[0].closed).toBe(true)
    expect(contractsFromPage(pageWith(OPCODE_DEPLOY, RAW))[0].closed).toBe(false)
  })

  it("resolves the raw destination through the address book", () => {
    expect(contractsFromPage(pageWith(OPCODE_DEPLOY, RAW))[0].address).toBe(FRIENDLY)
  })

  it("falls back to the raw address when the book has no entry", () => {
    const page = { ...pageWith(OPCODE_DEPLOY, "0:abc"), friendly: {} }
    expect(contractsFromPage(page)[0].address).toBe("0:abc")
  })

  it("skips transactions with no outgoing message to read", () => {
    const empty = { transactions: [{ lt: "1", now: 1, out_msgs: [] }], friendly: {}, nextLt: null, hasMore: false }
    expect(contractsFromPage(empty)).toEqual([])
    expect(contractsFromPage(pageWith(OPCODE_DEPLOY, null))).toEqual([])
  })

  it("finds the contract even when the wallet batched it behind other transfers", () => {
    const batched: TransactionsPage = {
      transactions: [
        {
          lt: "1",
          now: 1785545100,
          out_msgs: [
            { opcode: "0x0f8a7ea5", destination: "0:jetton", created_at: 1785545000 },
            { opcode: OPCODE_DEPLOY, destination: RAW, created_at: 1785545000 },
          ],
        },
      ],
      friendly: { [RAW]: FRIENDLY },
      nextLt: null,
      hasMore: false,
    }

    expect(contractsFromPage(batched)).toEqual([{ address: FRIENDLY, createdAt: 1785545000, closed: false }])
  })

  it("takes both contracts out of a transaction that touched two of them", () => {
    const two: TransactionsPage = {
      transactions: [
        {
          lt: "1",
          now: 1785545100,
          out_msgs: [
            { opcode: OPCODE_DEPLOY, destination: "0:a", created_at: 1785545000 },
            { opcode: OPCODE_CLOSE, destination: "0:b", created_at: 1785545000 },
          ],
        },
      ],
      friendly: {},
      nextLt: null,
      hasMore: false,
    }

    expect(contractsFromPage(two).map((contract) => contract.address)).toEqual(["0:a", "0:b"])
  })

  it("falls back to the transaction time when the message carries no usable one", () => {
    const undated = { ...pageWith(OPCODE_DEPLOY, RAW) }
    undated.transactions[0].out_msgs[0].created_at = null
    expect(contractsFromPage(undated)[0].createdAt).toBe(1785545100)
  })
})

describe("nextCursor", () => {
  const at = (lt: string): ChainTransaction => ({ lt, now: 1, out_msgs: [] })

  it("points below the oldest transaction of a full page, since end_lt includes its own bound", () => {
    expect(nextCursor([at("70"), at("50")], 2)).toBe("49")
  })

  it("reports the end of history when the page came back short", () => {
    expect(nextCursor([at("70")], 2)).toBe(null)
    expect(nextCursor([], 2)).toBe(null)
  })

  it("stops rather than asking for a logical time below the chain", () => {
    expect(nextCursor([at("1")], 1)).toBe(null)
  })
})

describe("scanContracts", () => {
  const deploy = (address: string, lt: string, opcode = OPCODE_DEPLOY): ChainTransaction => ({
    lt,
    now: Number(lt),
    out_msgs: [{ opcode, destination: address, created_at: Number(lt) }],
  })

  const page = (transactions: ChainTransaction[], nextLt: string | null): TransactionsPage => ({
    transactions,
    friendly: {},
    nextLt,
    hasMore: nextLt !== null,
  })

  const feed = (pages: TransactionsPage[]) => {
    const cursors: Array<string | null> = []
    const fetchPage = (_account: string, _limit: number, endLt: string | null): Promise<TransactionsPage> => {
      cursors.push(endLt)
      return Promise.resolve(pages[cursors.length - 1] ?? page([], null))
    }
    return { cursors, fetchPage }
  }

  it("hands every page to onPage as it arrives", async () => {
    const { cursors, fetchPage } = feed([page([deploy("EQA", "300")], "299"), page([deploy("EQB", "200")], null)])
    const seen: Array<[string[], string | null]> = []

    await scanContracts("EQW", {
      fetchPage,
      onPage: (found, nextLt) => seen.push([found.map((contract) => contract.address), nextLt]),
    })

    expect(cursors).toEqual([null, "299"])
    expect(seen).toEqual([
      [["EQA"], "299"],
      [["EQB"], null],
    ])
  })

  it("stops at the end of the history", async () => {
    const { cursors, fetchPage } = feed([page([deploy("EQA", "300")], "299"), page([deploy("EQB", "200")], null)])

    const scan = await scanContracts("EQW", { fetchPage })

    expect(cursors).toEqual([null, "299"])
    expect(scan.nextLt).toBe(null)
  })

  it("gives up at the page ceiling and hands back the cursor to resume from", async () => {
    const { cursors, fetchPage } = feed([page([deploy("EQA", "300")], "299"), page([deploy("EQB", "200")], "199")])

    const scan = await scanContracts("EQW", { maxPages: 2, fetchPage })

    expect(cursors).toHaveLength(2)
    expect(scan.nextLt).toBe("199")
  })

  it("resumes from the cursor of an earlier scan", async () => {
    const { cursors, fetchPage } = feed([page([deploy("EQA", "100")], null)])

    await scanContracts("EQW", { beforeLt: "199", fetchPage })

    expect(cursors).toEqual(["199"])
  })

  it("stops once the pages reach the already known history", async () => {
    const { cursors, fetchPage } = feed([page([deploy("EQA", "300")], "150"), page([deploy("EQB", "100")], "99")])

    const scan = await scanContracts("EQW", { stopLt: "200", fetchPage })

    expect(cursors).toEqual([null])
    expect(scan.nextLt).toBe("150")
  })

  it("reports the newest transaction it saw for the next catch-up", async () => {
    const { fetchPage } = feed([page([deploy("EQA", "300")], null)])

    const scan = await scanContracts("EQW", { fetchPage })

    expect(scan.topLt).toBe("300")
  })

  it("does not reach for a page once the caller has aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const { cursors, fetchPage } = feed([page([deploy("EQA", "300")], "299")])

    const scan = await scanContracts("EQW", { fetchPage, signal: controller.signal })

    expect(cursors).toEqual([])
    expect(scan).toEqual({ topLt: null, nextLt: null })
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

  it("closes a row from a fresher event and keeps the original creation date", () => {
    const merged = mergeRows([row("EQA")], [{ address: "EQA", createdAt: 200, closed: true }])
    expect(merged[0]).toMatchObject({ closed: true, createdAt: 100, lastEventAt: 200 })
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
      PENDING_PAID_KEY,
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
    expect(contractTone(rows[0])).toBe("orange")
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

    expect(store.has(PENDING_PAID_KEY)).toBe(false)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ address: FRESH, bagId: "f".repeat(64), description: "backup", size: 42, createdAt: 5 })
    expect(withPending(merged, OWNER)).toBe(merged)
  })

  it("lets the scan portion beat the instant row: the forgotten record adds nothing on top of the scanned contract", () => {
    remember()
    forgetPendingFound([FRESH])
    const scanned = mergeRows([], [{ address: FRESH, createdAt: 6000, closed: false }])
    const rows = withPending(scanned, OWNER)

    expect(store.has(PENDING_PAID_KEY)).toBe(false)
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

describe("requeueEconomics", () => {
  const rowWith = (address: string, economics?: ContractRow["economics"]): ContractRow => ({
    address,
    createdAt: 100,
    closed: false,
    bagId: "",
    description: "",
    size: 0,
    valid: 0,
    total: 0,
    economics,
  })

  it("returns a failed reading to the queue and keeps the readings that succeeded", () => {
    const requeued = requeueEconomics([rowWith("EQA", null), rowWith("EQB", economics), rowWith("EQC")])
    expect(requeued.map((row) => row.economics)).toEqual([undefined, economics, undefined])
  })

  it("hands back the very same list when no reading failed", () => {
    const rows = [rowWith("EQA", economics), rowWith("EQB")]
    expect(requeueEconomics(rows)).toBe(rows)
  })
})

describe("countChecks", () => {
  const statuses = [
    { address: "EQA", provider_pubkey: "a", reason: 0, reason_timestamp: null },
    { address: "EQA", provider_pubkey: "b", reason: 401, reason_timestamp: null },
    { address: "EQB", provider_pubkey: "c", reason: 0, reason_timestamp: null },
  ]

  it("counts only the checks belonging to the given contract", () => {
    expect(countChecks(statuses, "EQA")).toEqual({ valid: 1, total: 2, pending: 0 })
  })

  it("reports an unchecked contract as zero of zero", () => {
    expect(countChecks(statuses, "EQC")).toEqual({ valid: 0, total: 0, pending: 0 })
  })

  it("counts a check that has not run yet in the denominator and names it pending", () => {
    const pending: ContractStatus = { address: "EQA", provider_pubkey: "d", reason: null, reason_timestamp: null }
    expect(countChecks([...statuses, pending], "EQA")).toEqual({ valid: 1, total: 3, pending: 1 })
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

  it("swallows a wallet refusal recognized by its class and releases the lock", async () => {
    const lock = { current: null as string | null }
    sendAndConfirm.mockRejectedValue(new UserRejectsError())

    await expect(runContractAction(lock, sender, "EQA", () => Promise.resolve(transaction))).resolves.toBe(null)
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

  it("names the kind of failure as a value, since only a reading can be read again", () => {
    expect(unpaidLoadFailure(unreadable).kind).toBe("load")
    expect(removeFailure(refusedRemoval).kind).toBe("remove")
  })

  it("carries the response code beside a locale key, not a sentence, whichever of the two failed", () => {
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
    expect(shown(0, 0)).toBe("Not checked")
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
    "reasonShort.401",
    "status.unknownCode",
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
      failed: false,
      short: "details.checkOk",
      long: "reason.0",
      at: 0,
      ago: "",
      agoShort: "",
    })
    expect(checkLabelOf(statusOf(401, NOW - 7200), NOW, t)).toEqual({
      failed: true,
      short: "reasonShort.401",
      long: "reason.401",
      at: NOW - 7200,
      ago: "details.checkAgo(2.hr)",
      agoShort: "provider.ago(2.hr)",
    })
  })

  it("shows the code itself when nobody translated it", () => {
    expect(checkLabelOf(statusOf(599), NOW, t)).toEqual({
      failed: true,
      short: "status.unknownCode",
      long: "status.unknownReason",
      at: 0,
      ago: "",
      agoShort: "",
    })
  })
})

describe("contractTone", () => {
  it("marks a closed contract regardless of its check ratio", () => {
    expect(contractTone({ valid: 5, total: 5, closed: true })).toBe("gray")
  })

  it("ambers a contract nobody has checked yet", () => {
    expect(contractTone({ valid: 0, total: 0, closed: false })).toBe("orange")
  })

  it("ambers a contract whose only check has not run yet", () => {
    const pending: ContractStatus[] = [{ address: "EQC", provider_pubkey: "d", reason: null, reason_timestamp: null }]
    expect(contractTone({ ...countChecks(pending, "EQC"), closed: false })).toBe("orange")
  })

  it("ambers a stored fraction that could still be waiting and greens one that cannot", () => {
    const stored = { valid: 2, total: 3, closed: false }
    expect(contractTone(stored)).toBe("orange")
    expect(contractTone({ valid: 5, total: 5, closed: false })).toBe("green")

    const arrived: ContractStatus[] = [
      { address: "EQA", provider_pubkey: "a", reason: 0, reason_timestamp: null },
      { address: "EQA", provider_pubkey: "b", reason: 0, reason_timestamp: null },
      { address: "EQA", provider_pubkey: "c", reason: null, reason_timestamp: null },
    ]
    expect(contractTone({ ...stored, ...countChecks(arrived, "EQA") })).toBe("orange")
  })

  it("grades an open contract by its proof ratio once every check has reported", () => {
    expect(contractTone({ valid: 5, total: 5, pending: 0, closed: false })).toBe("green")
    expect(contractTone({ valid: 3, total: 5, pending: 0, closed: false })).toBe("yellow")
    expect(contractTone({ valid: 2, total: 5, pending: 0, closed: false })).toBe("red")
  })
})

describe("economicsFrom", () => {
  const num = (value: number) => ({ type: "num", value: `0x${value.toString(16)}` })
  const info = [num(1), num(1048576), num(131072), { type: "cell", value: "te6" }, num(7)]
  const providers = [
    { type: "list", value: [{ type: "tuple", value: [num(11), num(300), num(86400), num(0), num(0), num(0)] }] },
    num(1_000_000_000),
  ]

  it("reads the bag size, the balance and every provider rate", () => {
    expect(economicsFrom(info, providers)).toEqual({
      bagId: "0000000000000000000000000000000000000000000000000000000000000001",
      fileSize: 1048576,
      balance: 1_000_000_000,
      ratesPerMibDay: [300],
      pubkeys: ["000000000000000000000000000000000000000000000000000000000000000b"],
      spans: [86400],
      lastProofs: [0],
      span: 86400,
    })
  })

  it("reads the time of the last proof each provider submitted", () => {
    const proved = [
      { type: "list", value: [{ type: "tuple", value: [num(11), num(300), num(86400), num(1785540000), num(0), num(0)] }] },
      num(5),
    ]
    expect(economicsFrom(info, proved).lastProofs).toEqual([1785540000])
  })

  it("takes the longest span attached to the contract", () => {
    const spans = [
      {
        type: "list",
        value: [
          { type: "tuple", value: [num(11), num(300), num(86400), num(0)] },
          { type: "tuple", value: [num(12), num(300), num(604800), num(0)] },
        ],
      },
      num(1_000_000_000),
    ]
    expect(economicsFrom(info, spans).span).toBe(604800)
  })

  it("collects a rate from each attached provider", () => {
    const two = [
      { type: "list", value: [providers[0].value[0], { type: "tuple", value: [num(12), num(500), num(86400)] }] },
      num(5),
    ]
    expect(economicsFrom(info, two).ratesPerMibDay).toEqual([300, 500])
  })

  it("survives a contract that reports no providers", () => {
    expect(economicsFrom(info, [{ type: "list", value: [] }, num(7)])).toEqual({
      bagId: "0000000000000000000000000000000000000000000000000000000000000001",
      fileSize: 1048576,
      balance: 7,
      ratesPerMibDay: [],
      pubkeys: [],
      spans: [],
      lastProofs: [],
      span: 0,
    })
  })

  it("falls back to zeroes on a stack it cannot read", () => {
    expect(economicsFrom([], [])).toEqual({
      bagId: "0000000000000000000000000000000000000000000000000000000000000000",
      fileSize: 0,
      balance: 0,
      ratesPerMibDay: [],
      pubkeys: [],
      spans: [],
      lastProofs: [],
      span: 0,
    })
  })
})
