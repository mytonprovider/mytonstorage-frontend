import { sleep } from "../format"
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

export interface ChainMessage {
  source: string
  destination: string
  createdLt: string
  createdAt: number
}

export interface MessagesPage {
  messages: ChainMessage[]
  friendly: Record<string, string>
  hasMore: boolean
  lastLt: string | null
}

export interface MessagesQuery {
  source?: string
  destination?: string
  opcode: string
  startLt?: string | null
  endLt?: string | null
}

export interface AccountState {
  address: string
  balance: number
  codeHash: string | null
  stateHash: string | null
  lastLt: string | null
  dataBoc: string | null
}

export interface AccountStates {
  accounts: AccountState[]
  friendly: Record<string, string>
}

export const MESSAGES_PAGE = 500
export const ADDRESS_BATCH = 100

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

let lastAt = 0
let queue: Promise<unknown> = Promise.resolve()

const throttle = <T>(task: () => Promise<T>): Promise<T> => {
  const result = queue.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
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

const transactionOf = (value: unknown): ChainTransaction | null => {
  const raw = asRecord(value)
  if (typeof raw.lt !== "string" || !/^\d+$/.test(raw.lt)) return null

  return {
    lt: raw.lt,
    now: Number(raw.now) || 0,
    hash: typeof raw.hash === "string" ? raw.hash : null,
    out_msgs: asArray(raw.out_msgs) as OutMessage[],
    in_msg: asRecord(raw.in_msg),
  }
}

const nextCursor = (transactions: ChainTransaction[], limit: number): string | null => {
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
  const transactions = asArray(asRecord(body).transactions)
    .map(transactionOf)
    .filter((transaction): transaction is ChainTransaction => transaction !== null)
  const nextLt = nextCursor(transactions, limit)

  return { transactions, friendly: friendlyBook(body), nextLt, hasMore: nextLt !== null }
}

const messageOf = (value: unknown): ChainMessage | null => {
  const raw = asRecord(value)
  if (typeof raw.source !== "string" || typeof raw.destination !== "string") return null
  if (typeof raw.created_lt !== "string" || !/^\d+$/.test(raw.created_lt)) return null

  return {
    source: raw.source,
    destination: raw.destination,
    createdLt: raw.created_lt,
    createdAt: Number(raw.created_at) || 0,
  }
}

export const fetchMessages = async (query: MessagesQuery, signal?: AbortSignal): Promise<MessagesPage> => {
  const params = new URLSearchParams({ opcode: query.opcode, limit: String(MESSAGES_PAGE), sort: query.startLt ? "asc" : "desc" })
  if (query.source) params.set("source", query.source)
  if (query.destination) params.set("destination", query.destination)
  if (query.startLt) params.set("start_lt", query.startLt)
  if (query.endLt) params.set("end_lt", query.endLt)

  const response = await request(`/api/v3/messages?${params.toString()}`, { signal })
  if (!response.ok) throw new ChainRequestError("messages", response.status)

  const body: unknown = await response.json()
  const listed = asArray(asRecord(body).messages)
  const messages = listed.map(messageOf).filter((message): message is ChainMessage => message !== null)
  const lastRaw = asRecord(listed[listed.length - 1]).created_lt
  const lastLt = typeof lastRaw === "string" && /^\d+$/.test(lastRaw) ? lastRaw : null

  return { messages, friendly: friendlyBook(body), hasMore: listed.length >= MESSAGES_PAGE, lastLt }
}

const accountOf = (value: unknown): AccountState | null => {
  const raw = asRecord(value)
  if (typeof raw.address !== "string") return null
  return {
    address: raw.address,
    balance: Number(raw.balance) || 0,
    codeHash: typeof raw.code_hash === "string" ? raw.code_hash : null,
    stateHash: typeof raw.account_state_hash === "string" ? raw.account_state_hash : null,
    lastLt: typeof raw.last_transaction_lt === "string" ? raw.last_transaction_lt : null,
    dataBoc: typeof raw.data_boc === "string" ? raw.data_boc : null,
  }
}

export const fetchAccountStates = async (
  addresses: string[],
  withData: boolean,
  signal?: AbortSignal,
): Promise<AccountStates> => {
  const accounts: AccountState[] = []
  const friendly: Record<string, string> = {}

  for (let at = 0; at < addresses.length; at += ADDRESS_BATCH) {
    const batch = addresses.slice(at, at + ADDRESS_BATCH)
    const params = new URLSearchParams({ address: batch.join(","), include_boc: String(withData) })
    const response = await request(`/api/v3/accountStates?${params.toString()}`, { signal })
    if (!response.ok) throw new ChainRequestError("accountStates", response.status)

    const body: unknown = await response.json()
    asArray(asRecord(body).accounts).forEach((entry) => {
      const account = accountOf(entry)
      if (account) accounts.push(account)
    })
    Object.assign(friendly, friendlyBook(body))
  }

  return { accounts, friendly }
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
