import { afterEach, describe, expect, it, vi } from "vitest"
import { TonConnectUIError, UserRejectsError } from "@tonconnect/ui-react"
import { fromSender, sendAndConfirm, waitForTransaction, walletRefused, type WalletSender } from "./transactions"
import type { TransactionsPage } from "./toncenter"

const { fetchTransactions } = vi.hoisted(() => ({ fetchTransactions: vi.fn() }))

vi.mock("./toncenter", () => ({ fetchTransactions }))

const WALLET = `0:${"a".repeat(64)}`
const PROVIDER = `0:${"b".repeat(64)}`

const BOUNCEABLE = "EQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljMwB"
const NON_BOUNCEABLE = "UQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljJHE"
const SAME_ACCOUNT_RAW = "0:234613cda82f666369ae14db18c182397aa6fe96cabeb03e7193748b7eb0e58c"
const BROKEN_CHECKSUM = "EQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljAAA"

const CHAIN_HASH = "tSUirmJt0jK8JWXEFOm8Zt6azH77Uzyv42/XRNJApp4="
const EXPLORER_HASH = "b52522ae626dd232bc2565c414e9bc66de9acc7efb533cafe36fd744d240a69e"

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
  it("keeps a message the connected wallet sent", () => {
    expect(fromSender(WALLET, WALLET)).toBe(true)
    expect(fromSender(WALLET.toUpperCase(), WALLET)).toBe(true)
  })

  it("drops a message another account sent to the same contract", () => {
    expect(fromSender(PROVIDER, WALLET)).toBe(false)
  })

  it("keeps a message from the same account written in the friendly form", () => {
    expect(fromSender(BOUNCEABLE, SAME_ACCOUNT_RAW)).toBe(true)
    expect(fromSender(SAME_ACCOUNT_RAW, NON_BOUNCEABLE)).toBe(true)
    expect(fromSender(BOUNCEABLE, NON_BOUNCEABLE)).toBe(true)
  })

  it("drops a message it cannot pin on the connected wallet", () => {
    expect(fromSender(null, WALLET)).toBe(false)
    expect(fromSender(undefined, WALLET)).toBe(false)
    expect(fromSender(PROVIDER, null)).toBe(false)
    expect(fromSender("EQAsomeFriendlyForm", WALLET)).toBe(false)
    expect(fromSender(PROVIDER, "EQAsomeFriendlyForm")).toBe(false)
    expect(fromSender(BROKEN_CHECKSUM, SAME_ACCOUNT_RAW)).toBe(false)
  })
})

describe("sendAndConfirm", () => {
  it("never lets the wallet broadcast after the confirmation window is over", async () => {
    const sender = senderThat("rejects")
    await sendAndConfirm(sender, transaction, 180_000)

    const request = vi.mocked(sender.sendTransaction).mock.calls[0][0]
    expect(request.validUntil - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(180)
  })

  it("caps the deadline at five minutes for a window longer than that", async () => {
    const sender = senderThat("rejects")
    await sendAndConfirm(sender, transaction, 600_000)

    const request = vi.mocked(sender.sendTransaction).mock.calls[0][0]
    expect(request.validUntil - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300)
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

  it("confirms on a contract transaction the connected wallet caused", async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    fetchTransactions.mockResolvedValue(
      page([{ lt: "1", now: now + 2, out_msgs: [], in_msg: { source: WALLET } }]),
    )

    const confirmed = sendAndConfirm(senderThat("never"), transaction, 180_000)
    await vi.advanceTimersByTimeAsync(6000)

    await expect(confirmed).resolves.toBe(true)
  })

  it("does not take a provider proof landing in the same window for our transaction", async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    fetchTransactions.mockResolvedValue(
      page([{ lt: "1", now: now + 2, out_msgs: [], in_msg: { source: PROVIDER } }]),
    )

    const confirmed = sendAndConfirm(senderThat("never"), transaction, 20_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(confirmed).resolves.toBe(false)
  })

  it("waits instead of taking a contract transaction toncenter reports without a sender", async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    fetchTransactions.mockResolvedValue(page([{ lt: "1", now: now + 2, out_msgs: [] }]))

    const confirmed = sendAndConfirm(senderThat("never"), transaction, 20_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(confirmed).resolves.toBe(false)
  })

  it("ignores what the contract did before the transaction was built", async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    fetchTransactions.mockResolvedValue(
      page([{ lt: "1", now: now - 60, out_msgs: [], in_msg: { source: WALLET } }]),
    )

    const confirmed = sendAndConfirm(senderThat("never"), transaction, 20_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(confirmed).resolves.toBe(false)
  })

  it("takes the answer of the wallet itself as the confirmation, without waiting for the chain to show it", async () => {
    const sender: WalletSender = {
      account: { address: WALLET },
      sendTransaction: vi.fn(() => Promise.resolve({ boc: "te6ccg" })),
    }

    await expect(sendAndConfirm(sender, transaction, 180_000)).resolves.toBe(true)
    expect(fetchTransactions).not.toHaveBeenCalled()
  })

  it("confirms a payment whose hash it cannot read, since the money does not hang on the explorer link", async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    fetchTransactions.mockResolvedValue(
      page([{ lt: "1", now: now + 2, hash: "not a hash", out_msgs: [], in_msg: { source: WALLET } }]),
    )

    const confirmed = sendAndConfirm(senderThat("never"), transaction, 20_000)
    await vi.advanceTimersByTimeAsync(6000)

    await expect(confirmed).resolves.toBe(true)
  })
})

describe("waitForTransaction", () => {
  const found = (hash: string | undefined, source: string | undefined) => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    fetchTransactions.mockResolvedValue(page([{ lt: "1", now: now + 2, hash, out_msgs: [], in_msg: { source } }]))

    const hunt = waitForTransaction(transaction.address, now, WALLET, 20_000)
    return vi.advanceTimersByTimeAsync(30_000).then(() => hunt)
  }

  it("keeps the transaction it confirmed on, in the form an explorer takes", async () => {
    await expect(found(CHAIN_HASH, WALLET)).resolves.toBe(EXPLORER_HASH)
  })

  it("keeps nothing off a transaction another account sent to the same contract", async () => {
    await expect(found(CHAIN_HASH, PROVIDER)).resolves.toBe(null)
  })

  it("keeps nothing when the hash is missing or unreadable, rather than pointing at a guess", async () => {
    await expect(found(undefined, WALLET)).resolves.toBe(null)
    await expect(found("not a hash", WALLET)).resolves.toBe(null)
  })
})
