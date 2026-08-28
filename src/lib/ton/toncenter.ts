import { asArray, asRecord } from "../json"

const TONCENTER_URL = import.meta.env.VITE_TONCENTER_URL ?? "https://toncenter.com"

const MIN_GAP_MS = 1250
const MAX_RETRIES = 3

interface OutMessage {
  opcode?: string | null
  destination?: string | null
  created_at?: string | number | null
}

export interface ChainTransaction {
  lt: string
  now: number
  hash?: string | null
  out_msgs: OutMessage[]
  in_msg?: { source?: string | null } | null
}

export interface TransactionsPage {
  transactions: ChainTransaction[]
  friendly: Record<string, string>
  nextLt: string | null
  hasMore: boolean
}

export class GetMethodError extends Error {
  readonly exitCode: number | null

  constructor(method: string, exitCode: unknown) {
    super(`${method} exited with ${String(exitCode)}`)
    this.exitCode = typeof exitCode === "number" ? exitCode : null
  }
}

export class ChainRequestError extends Error {
  constructor(
    call: string,
    readonly status: number,
  ) {
    super(`toncenter ${call} failed with ${status}`)
  }
}

export interface StackEntry {
  type: string
  value: unknown
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let lastAt = 0
let queue: Promise<unknown> = Promise.resolve()

const throttle = <T>(task: () => Promise<T>): Promise<T> => {
  const result = queue.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now()
    if (wait > 0) await delay(wait)
    lastAt = Date.now()
    return task()
  })

  queue = result.then(
    () => undefined,
    () => undefined,
  )

  return result
}

const REQUEST_TIMEOUT_MS = 30_000

const send = (path: string, init: RequestInit): Promise<Response> =>
  throttle(() => {
    const signal = init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    return fetch(`${TONCENTER_URL}${path}`, { ...init, signal })
  })

const request = async (path: string, init: RequestInit): Promise<Response> => {
  for (let attempt = 0; ; attempt++) {
    const response = await send(path, init)
    if (response.status !== 429 || attempt >= MAX_RETRIES) return response
    lastAt = Date.now()
  }
}

const friendlyBook = (value: unknown): Record<string, string> => {
  const book = asRecord(asRecord(value).address_book)
  const friendly: Record<string, string> = {}
  Object.entries(book).forEach(([raw, entry]) => {
    const shown = asRecord(entry).user_friendly
    if (typeof shown === "string") friendly[raw] = shown
  })
  return friendly
}

export const nextCursor = (transactions: ChainTransaction[], limit: number): string | null => {
  const last = transactions[transactions.length - 1]
  if (!last || transactions.length < limit) return null

  const before = BigInt(last.lt) - 1n
  return before > 0n ? before.toString() : null
}

export const fetchTransactions = async (
  account: string,
  limit: number,
  endLt: string | null,
  signal?: AbortSignal,
): Promise<TransactionsPage> => {
  const params = new URLSearchParams({ account, limit: String(limit), sort: "desc", archival: "true" })
  if (endLt) params.set("end_lt", endLt)

  const response = await request(`/api/v3/transactions?${params.toString()}`, { signal })
  if (!response.ok) throw new ChainRequestError("transactions", response.status)

  const body: unknown = await response.json()
  const transactions = asArray(asRecord(body).transactions) as ChainTransaction[]
  const nextLt = nextCursor(transactions, limit)

  return { transactions, friendly: friendlyBook(body), nextLt, hasMore: nextLt !== null }
}

export const runGetMethod = async (address: string, method: string, signal?: AbortSignal): Promise<StackEntry[]> => {
  const response = await request("/api/v3/runGetMethod", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, method, stack: [] }),
    signal,
  })
  if (!response.ok) throw new ChainRequestError("runGetMethod", response.status)

  const result = asRecord(await response.json())
  if (result.exit_code !== 0) throw new GetMethodError(method, result.exit_code)

  return asArray(result.stack) as StackEntry[]
}

export const stackNumber = (entry: StackEntry | undefined): number =>
  entry && typeof entry.value === "string" ? Number(BigInt(entry.value)) : 0

export const stackBigInt = (entry: StackEntry | undefined): bigint =>
  entry && typeof entry.value === "string" ? BigInt(entry.value) : 0n
