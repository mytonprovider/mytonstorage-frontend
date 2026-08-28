import { TonConnectError, UserRejectsError } from "@tonconnect/ui-react"
import type { WalletTransaction } from "@/types/contract"
import { nowSeconds } from "../format"
import { toRawAddress } from "./ton-address"
import { fetchTransactions, type ChainTransaction } from "./toncenter"

const VALID_FOR_SECONDS = 300
const POLL_INTERVAL_MS = 5000
const BASE64_HASH = /^[A-Za-z0-9+/_-]{43}=$/

export interface WalletSender {
  account?: { address: string } | null
  sendTransaction: (request: {
    validUntil: number
    messages: Array<{ address: string; amount: string; stateInit?: string; payload?: string }>
  }) => Promise<unknown>
}

export const walletRefused = (error: unknown): boolean => error instanceof UserRejectsError

export const fromSender = (source: string | null | undefined, wallet: string | null | undefined): boolean => {
  const sender = toRawAddress(source)
  return sender !== null && sender === toRawAddress(wallet)
}

const hashInHex = (hash: string | null | undefined): string | null => {
  if (!hash || !BASE64_HASH.test(hash)) return null

  const raw = atob(hash.replace(/-/g, "+").replace(/_/g, "/"))
  return Array.from(raw, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("")
}

const seenOnChain = async (
  contract: string,
  since: number,
  wallet: string | null | undefined,
  signal: AbortSignal,
): Promise<ChainTransaction | null> => {
  try {
    const page = await fetchTransactions(contract, 10, null, signal)
    return (
      page.transactions.find(
        (transaction) => transaction.now >= since && fromSender(transaction.in_msg?.source, wallet),
      ) ?? null
    )
  } catch {
    return null
  }
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })

    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })

const pollUntil = async (
  contract: string,
  since: number,
  wallet: string | null | undefined,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ChainTransaction | null> => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline && !signal.aborted) {
    await sleep(POLL_INTERVAL_MS, signal)
    if (signal.aborted) return null
    const found = await seenOnChain(contract, since, wallet, signal)
    if (found) return found
  }

  return null
}

export const waitForTransaction = async (
  contract: string,
  since: number,
  wallet: string | null | undefined,
  timeoutMs: number,
): Promise<string | null> =>
  hashInHex((await pollUntil(contract, since, wallet, timeoutMs, AbortSignal.timeout(timeoutMs)))?.hash)

const messageOf = (transaction: WalletTransaction) => ({
  address: transaction.address,
  amount: BigInt(Math.round(transaction.amount)).toString(),
  stateInit: transaction.state_init || undefined,
  payload: transaction.body || undefined,
})

export const sendAndConfirm = async (
  sender: WalletSender,
  transaction: WalletTransaction,
  timeoutMs: number,
): Promise<boolean> => {
  const since = nowSeconds()
  const wallet = sender.account?.address

  const controller = new AbortController()

  const sent = sender
    .sendTransaction({
      validUntil: since + Math.min(VALID_FOR_SECONDS, Math.ceil(timeoutMs / 1000)),
      messages: [messageOf(transaction)],
    })
    .then(
      () => true,
      (error: unknown) => {
        if (error instanceof TonConnectError) throw error
        return false
      },
    )

  try {
    const landed = pollUntil(transaction.address, since, wallet, timeoutMs, controller.signal).then(
      (found) => found !== null,
    )
    return await Promise.race([sent, landed])
  } finally {
    controller.abort()
  }
}
