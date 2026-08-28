import { useCallback, useRef, useState } from "react"
import type {
  BagInfoShort,
  ContractStatus,
  InitStorageContract,
  UpdateStorageContract,
  WalletTransaction,
} from "@/types/contract"
import type { Offers, ProviderDecline, ProviderOffer, UnpaidBags, UserBag } from "@/types/bag"
import type { ApiProvider, ApiTelemetry, Provider, Telemetry } from "@/types/provider"
import { applyServerDate, BYTES_IN_GB, BYTES_IN_GIB } from "./format"
import { asArray, asRecord } from "./json"

export const API_URL = import.meta.env.VITE_API_URL ?? "https://mytonstorage.org"
const MTPO_URL = import.meta.env.VITE_MTPO_URL ?? "https://mytonprovider.org"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    method: string,
    path: string,
    readonly detail = "",
  ) {
    super(`${method} ${path} failed with ${status}`)
    this.name = "ApiError"
  }
}

export const failureStatus = (error: unknown): number | null => (error instanceof ApiError ? error.status : null)

export const sessionEnded = (error: unknown): boolean => error instanceof ApiError && error.status === 401

const DETAIL_LIMIT = 300

export const errorDetailOf = (raw: string): string => {
  try {
    const parsed: unknown = JSON.parse(raw)
    const detail = asRecord(parsed).error
    return typeof detail === "string" ? detail : ""
  } catch {
    return raw.trim().slice(0, DETAIL_LIMIT)
  }
}

interface RequestOptions {
  body?: unknown
  method?: string
  signal?: AbortSignal
  credentials?: RequestCredentials
}

const REQUEST_TIMEOUT_MS = 30_000

const withTimeout = (signal: AbortSignal | undefined, ms: number): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)

const request = async (base: string, path: string, options: RequestOptions = {}): Promise<unknown> => {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST")

  const response = await fetch(`${base}${path}`, {
    method,
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: options.credentials,
    redirect: "error",
    signal: withTimeout(options.signal, REQUEST_TIMEOUT_MS),
  })

  applyServerDate(response.headers.get("date"))

  if (!response.ok) {
    const raw = await response.text().catch(() => "")
    throw new ApiError(response.status, method, path, errorDetailOf(raw))
  }
  if (response.status === 204) return null

  const text = await response.text()
  return text ? (JSON.parse(text) as unknown) : null
}

export const fetchTonProofPayload = async (): Promise<string> => {
  const payload = asRecord(await request(API_URL, "/api/v1/ton-proof")).data
  if (typeof payload !== "string") throw new Error("unexpected ton-proof response shape")
  return payload
}

interface LoginPayload {
  address: string
  proof: unknown
  state_init: string
}

export const login = async (payload: LoginPayload): Promise<void> => {
  await request(API_URL, "/api/v1/login", { body: payload, credentials: "include" })
}

export const unpaidBagsOf = (value: unknown): UnpaidBags => {
  const envelope = asRecord(value)
  return {
    free_storage: typeof envelope.free_storage === "number" ? envelope.free_storage : 0,
    bags: asArray(envelope.bags).filter((bag): bag is UserBag => typeof asRecord(bag).bag_id === "string"),
  }
}

export const fetchUnpaidBags = async (signal?: AbortSignal): Promise<UnpaidBags> =>
  unpaidBagsOf(await request(API_URL, "/api/v1/files/unpaid", { body: {}, credentials: "include", signal }))

export const fetchBagDetails = async (addresses: string[], signal?: AbortSignal): Promise<BagInfoShort[]> => {
  if (!addresses.length) return []
  const listed = await request(API_URL, "/api/v1/files/details", {
    body: { contracts: addresses },
    credentials: "include",
    signal,
  })
  return asArray(listed).filter((bag): bag is BagInfoShort => typeof asRecord(bag).bag_id === "string")
}

export const markBagPaid = async (bagId: string, storageContract: string): Promise<void> => {
  await request(API_URL, "/api/v1/files/paid", {
    body: { bag_id: bagId, storage_contract: storageContract },
    credentials: "include",
  })
}

export const deleteBag = async (bagId: string): Promise<void> => {
  await request(API_URL, `/api/v1/files/${bagId}`, { method: "DELETE", credentials: "include" })
}

const nanotons = (amount: unknown): boolean =>
  typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0

const quotedOffer = (value: unknown): value is ProviderOffer => {
  const fields = asRecord(value)
  return (
    nanotons(fields.price_per_mb) &&
    nanotons(fields.price_per_proof) &&
    typeof asRecord(fields.provider).key === "string"
  )
}

const quotedDecline = (value: unknown): value is ProviderDecline => {
  const fields = asRecord(value)
  return typeof fields.provider_key === "string" && typeof fields.reason === "string"
}

export const fetchOffers = async (
  bagId: string,
  span: number,
  providers: string[],
  bagSize = 0,
  signal?: AbortSignal,
): Promise<Offers> => {
  const quoted = asRecord(
    await request(API_URL, "/api/v1/providers/offers", {
      body: { bag_id: bagId, bag_size: bagSize, span, providers },
      credentials: "include",
      signal,
    }),
  )

  return {
    offers: asArray(quoted.offers).filter(quotedOffer),
    declines: asArray(quoted.declines).filter(quotedDecline),
  }
}

interface QuoteOutcome {
  offers: ProviderOffer[]
  declines: ProviderDecline[]
  complete: boolean
}

interface Quote {
  checking: boolean
  invalidate: () => void
  request: (
    bagId: string,
    span: number,
    selected: string[],
    bagSize: number,
    onDone: (outcome: QuoteOutcome) => void,
    onFail: (error: unknown) => void,
  ) => void
}

export const useQuote = (): Quote => {
  const seq = useRef(0)
  const [checking, setChecking] = useState(false)

  const invalidate = useCallback(() => {
    seq.current += 1
    setChecking(false)
  }, [])

  const request = useCallback<Quote["request"]>((bagId, span, selected, bagSize, onDone, onFail) => {
    const current = ++seq.current
    setChecking(true)
    fetchOffers(bagId, span, selected, bagSize)
      .then((result) => {
        if (current !== seq.current) return
        setChecking(false)
        const { offers, declines } = result
        const quoted = new Set(offers.map((offer) => offer.provider.key.toLowerCase()))
        const complete = declines.length === 0 && selected.every((key) => quoted.has(key.toLowerCase()))
        onDone({ offers, declines, complete })
      })
      .catch((error: unknown) => {
        if (current !== seq.current) return
        setChecking(false)
        onFail(error)
      })
  }, [])

  return { checking, invalidate, request }
}

const walletTransactionOf = (value: unknown, endpoint: string): WalletTransaction => {
  const fields = asRecord(value)
  if (typeof fields.address !== "string" || typeof fields.amount !== "number") {
    throw new Error(`unexpected transaction response shape from ${endpoint}`)
  }
  return {
    address: fields.address,
    amount: fields.amount,
    body: typeof fields.body === "string" ? fields.body : "",
    state_init: typeof fields.state_init === "string" ? fields.state_init : "",
  }
}

const walletCall = async (endpoint: string, body: unknown): Promise<WalletTransaction> =>
  walletTransactionOf(
    await request(API_URL, `/api/v1/contracts/${endpoint}`, { body, credentials: "include" }),
    endpoint,
  )

export const initContract = (payload: InitStorageContract): Promise<WalletTransaction> =>
  walletCall("init-contract", payload)

export const updateContract = (payload: UpdateStorageContract): Promise<WalletTransaction> =>
  walletCall("update", payload)

export const topupContract = (address: string, amount: number): Promise<WalletTransaction> =>
  walletCall("topup", { address, amount })

export const withdrawContract = (address: string): Promise<WalletTransaction> =>
  walletCall("withdraw", { address })

export const gatewayUrl = (bagId: string): string => `${API_URL}/api/v1/gateway/${bagId.toUpperCase()}`

const bytesOf = (value: number | null | undefined, factor: number): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value * factor : null

const toTelemetry = ({
  total_provider_space,
  used_provider_space,
  total_ram,
  usage_ram,
  ...telemetry
}: ApiTelemetry): Telemetry => ({
  ...telemetry,
  total_provider_space_bytes: bytesOf(total_provider_space, BYTES_IN_GIB),
  used_provider_space_bytes: bytesOf(used_provider_space, BYTES_IN_GIB),
  total_ram_bytes: bytesOf(total_ram, BYTES_IN_GB),
  usage_ram_bytes: bytesOf(usage_ram, BYTES_IN_GB),
})

export const toProvider = ({ telemetry, ...provider }: ApiProvider): Provider => ({
  ...provider,
  telemetry: telemetry ? toTelemetry(telemetry) : null,
})

const providersOf = (value: unknown): Provider[] =>
  asArray(asRecord(value).providers)
    .filter((provider): provider is ApiProvider => typeof asRecord(provider).pubkey === "string")
    .map(toProvider)

export const fetchProviders = async (signal?: AbortSignal): Promise<Provider[]> =>
  providersOf(
    await request(MTPO_URL, "/api/v1/providers/search", {
      body: { filters: {}, exact: [], limit: 1000, offset: 0 },
      signal,
    }),
  )

export const fetchProviderByKey = async (pubkey: string, signal?: AbortSignal): Promise<Provider | null> => {
  const found = providersOf(
    await request(MTPO_URL, "/api/v1/providers/search", {
      body: { filters: {}, exact: [pubkey.toLowerCase()], limit: 1, offset: 0 },
      signal,
    }),
  )
  return found[0] ?? null
}

export const fetchContractStatuses = async (addresses: string[], signal?: AbortSignal): Promise<ContractStatus[]> => {
  if (!addresses.length) return []
  const envelope = await request(MTPO_URL, "/api/v1/contracts/statuses", { body: { contracts: addresses }, signal })
  return asArray(asRecord(envelope).contracts).filter(
    (status): status is ContractStatus => typeof asRecord(status).address === "string",
  )
}
