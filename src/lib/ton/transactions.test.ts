import { afterEach, describe, expect, it, vi } from "vitest"
import { TonConnectUIError, UserRejectsError } from "@tonconnect/ui-react"
import { Address, beginCell, Cell, ExternalAddress, storeMessage } from "@ton/core"
import { fromSender, normalizedExternalHash, sendAndConfirm, walletRefused, type WalletSender } from "./transactions"
import type { TransactionsPage } from "./toncenter"

const { fetchTransactions } = vi.hoisted(() => ({ fetchTransactions: vi.fn() }))

vi.mock("./toncenter", () => ({ fetchTransactions }))

const WALLET = `0:${"a".repeat(64)}`
const PROVIDER = `0:${"b".repeat(64)}`

const BOUNCEABLE = "EQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljMwB"
const SAME_ACCOUNT_RAW = "0:234613cda82f666369ae14db18c182397aa6fe96cabeb03e7193748b7eb0e58c"

const INDEXED_DEST = "0:90F1C75EE066800F2D9C406C245D8A8AA1E0DAA7B4564E1C29C81E4C872D8CA6"
const INDEXED_BODY =
  "te6cckECBgEAARQAAaFzaWduf///EWrA/+8AAAC6hOTuk7MeMPNLiuj0yu+ejPM+eyXLH283sXRAHLI4U+6djoRun+fwWvGUZgRwnzep1PMenQLvf6jnYgwwpJCIwKABAgoOw8htAwIDAAABaGIAZa/OhCDJRj64Bjg6WO6PpoUflUHeMl0P+GoWMsXGYwUgF9eEAAAAAAAAAAAAAAAAAAEEAagPin6l6U5So+OXFPgwtxsIAQpIh/CzP81LtGn8hgk1icF9Zg43ZX9qzGvVKEJQ+FB1ACQ8cde4GaADy2cQGwkXYqKoeDap7RWThwpyB5Mhy2MpggMFAEoAAAAANTAgVGVsZWdyYW0gU3RhcnMgCgpSZWYja0JWQWRoc1VpiyIguA=="
const INDEXED_HASH_NORM = "f6de9eea144caffd7434f5f7ffd3c3254be3448d49a8915f097e4d1a19282fe9"

const page = (transactions: TransactionsPage["transactions"]): TransactionsPage => ({
  transactions,
  friendly: {},
  nextLt: null,
  hasMore: false,
})

const failureOf = (outcome: "never" | "rejects" | "refuses" | "closes"): Promise<never> => {
  if (outcome === "rejects") return Promise.reject(new Error("bridge is down"))
  if (outcome === "refuses") return Promise.reject(new UserRejectsError())
  if (outcome === "closes") return Promise.reject(new TonConnectUIError("modal closed"))
  return new Promise<never>(() => undefined)
}

const senderThat = (
  outcome: "never" | "rejects" | "refuses" | "closes",
  account: string | null = WALLET,
): WalletSender => ({
  account: account === null ? null : { address: account },
  sendTransaction: vi.fn(() => failureOf(outcome)),
})

const transaction = { address: "EQCONTRACT", amount: 5e8, body: "te6body", state_init: "" }

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("fromSender", () => {
  it.each([
    [WALLET, WALLET, true],
    [PROVIDER, WALLET, false],
    [BOUNCEABLE, SAME_ACCOUNT_RAW, true],
    [null, WALLET, false],
    [PROVIDER, null, false],
  ])("pins a message from %s on the wallet %s: %s", (source, wallet, sent) => {
    expect(fromSender(source, wallet)).toBe(sent)
  })
})

describe("sendAndConfirm", () => {
  it.each([
    [180_000, 180],
    [600_000, 300],
  ])("never lets the wallet broadcast after a window of %i ms is over, capping the deadline at %i seconds", async (window, seconds) => {
    const sender = senderThat("rejects")
    await sendAndConfirm(sender, transaction, window)

    const request = vi.mocked(sender.sendTransaction).mock.calls[0][0]
    expect(request.validUntil - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(seconds)
  })

  it("takes the answer of the wallet itself as the confirmation and hands the signed message to the caller the moment it returns", async () => {
    const sender: WalletSender = { account: { address: WALLET }, sendTransaction: vi.fn(() => Promise.resolve({ boc: "te6signed" })) }
    const seen: string[] = []

    await expect(sendAndConfirm(sender, transaction, 180_000, (boc) => seen.push(boc))).resolves.toBe(true)
    expect(seen).toEqual(["te6signed"])
    expect(fetchTransactions).not.toHaveBeenCalled()
  })

  it("reports failure as soon as the wallet call fails, without claiming the transaction was refused", async () => {
    await expect(sendAndConfirm(senderThat("rejects"), transaction, 180_000)).resolves.toBe(false)
    expect(fetchTransactions).not.toHaveBeenCalled()
  })

  it("hands an explicit refusal back to the caller, since a refused transaction was never signed", async () => {
    await expect(sendAndConfirm(senderThat("refuses"), transaction, 180_000)).rejects.toBeInstanceOf(UserRejectsError)
    expect(fetchTransactions).not.toHaveBeenCalled()
  })

  it("stops waiting when the ui layer fails, without calling that a refusal by the user", async () => {
    const failure = await sendAndConfirm(senderThat("closes"), transaction, 180_000).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TonConnectUIError)
    expect(walletRefused(failure)).toBe(false)
    expect(fetchTransactions).not.toHaveBeenCalled()
  })

  it("confirms on a contract transaction the connected wallet caused, even one whose hash it cannot read", async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    fetchTransactions.mockResolvedValue(
      page([{ lt: "1", now: now + 2, hash: "not a hash", out_msgs: [], in_msg: { source: WALLET } }]),
    )

    const confirmed = sendAndConfirm(senderThat("never"), transaction, 180_000)
    await vi.advanceTimersByTimeAsync(6000)

    await expect(confirmed).resolves.toBe(true)
  })

  it.each([
    ["a provider proof landing in the same window", 2, PROVIDER],
    ["a contract transaction toncenter reports without a sender", 2, null],
    ["what the contract did before the transaction was built", -60, WALLET],
  ])("does not take %s for our transaction", async (_, offset, source) => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    fetchTransactions.mockResolvedValue(page([{ lt: "1", now: now + offset, out_msgs: [], ...(source === null ? {} : { in_msg: { source } }) }]))

    const confirmed = sendAndConfirm(senderThat("never"), transaction, 20_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(confirmed).resolves.toBe(false)
  })
})

describe("normalizedExternalHash", () => {
  const dest = Address.parse(BOUNCEABLE)
  const body = beginCell().storeUint(0x3dc680ae, 32).endCell()
  const external = (fields: { src?: ExternalAddress; importFee?: bigint; init?: { code: typeof body; data: typeof body } }) =>
    beginCell()
      .store(storeMessage({ info: { type: "external-in", dest, src: fields.src, importFee: fields.importFee ?? 0n }, init: fields.init, body }))
      .endCell()
      .toBoc()
      .toString("base64")

  it("hashes the signed message the way explorers index it: without the sender, the import fee and the state init", () => {
    const plain = normalizedExternalHash(external({}))

    expect(plain).toMatch(/^[0-9a-f]{64}$/)
    expect(normalizedExternalHash(external({ src: new ExternalAddress(7n, 16), importFee: 1n, init: { code: body, data: body } }))).toBe(plain)
  })

  it("matches the hash toncenter indexes for a real external message, so an explorer opens the same transaction", () => {
    const indexed = beginCell()
      .store(storeMessage({ info: { type: "external-in", dest: Address.parse(INDEXED_DEST), importFee: 0n }, body: Cell.fromBase64(INDEXED_BODY) }))
      .endCell()
      .toBoc()
      .toString("base64")

    expect(normalizedExternalHash(indexed)).toBe(INDEXED_HASH_NORM)
  })

  it("keeps nothing off a message that did not come in from outside, or off bytes that are not a message at all", () => {
    const internal = beginCell()
      .store(
        storeMessage({
          info: { type: "internal", ihrDisabled: true, bounce: true, bounced: false, src: dest, dest, value: { coins: 1n }, ihrFee: 0n, forwardFee: 0n, createdLt: 0n, createdAt: 0 },
          body,
        }),
      )
      .endCell()
      .toBoc()
      .toString("base64")

    expect(normalizedExternalHash(internal)).toBe(null)
    expect(normalizedExternalHash("not a boc")).toBe(null)
  })
})
