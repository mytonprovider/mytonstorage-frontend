import { markBagPaid } from "./api"
import { asRecord } from "./json"
import { PENDING_PAID_KEY, readStored, removeStored, writeStored } from "./local-storage"
import { GetMethodError, runGetMethod } from "./ton/toncenter"

const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000

interface PendingPaid {
  bagId: string
  contract: string
  at: number
  owner?: string
  description?: string
  size?: number
  linked?: boolean
}

export const readPendingPaid = (): PendingPaid | null => {
  const raw = readStored(PENDING_PAID_KEY)
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    const { bagId, contract, at, owner, description, size, linked } = asRecord(parsed)
    if (typeof bagId !== "string" || typeof contract !== "string" || typeof at !== "number") return null
    return {
      bagId,
      contract,
      at,
      owner: typeof owner === "string" ? owner : undefined,
      description: typeof description === "string" ? description : undefined,
      size: typeof size === "number" ? size : undefined,
      linked: linked === true,
    }
  } catch {
    return null
  }
}

export const writePendingPaid = (bagId: string, contract: string, owner = "", description = "", size = 0): boolean =>
  writeStored(PENDING_PAID_KEY, JSON.stringify({ bagId, contract, at: Date.now(), owner, description, size }))

export const clearPendingPaid = (): void => removeStored(PENDING_PAID_KEY)

export const markPendingLinked = (): void => {
  const pending = readPendingPaid()
  if (pending) writeStored(PENDING_PAID_KEY, JSON.stringify({ ...pending, linked: true }))
}

export const forgetPendingFound = (addresses: string[]): void => {
  const pending = readPendingPaid()
  if (pending?.linked && addresses.includes(pending.contract)) clearPendingPaid()
}

const chainAnswered = (error: unknown): boolean => error instanceof GetMethodError && error.exitCode !== null

export type DeployCheck = "deployed" | "missing" | "unknown"

export const contractDeployed = (address: string): Promise<DeployCheck> =>
  runGetMethod(address, "get_storage_info").then(
    () => "deployed",
    (error: unknown) => (chainAnswered(error) ? "missing" : "unknown"),
  )

export const retryPendingPaid = async (): Promise<"linked" | "dropped" | "kept" | "none"> => {
  const pending = readPendingPaid()
  if (!pending) return "none"

  const givenUp = (): "dropped" | "kept" => {
    if (Date.now() - pending.at <= GIVE_UP_AFTER_MS) return "kept"
    clearPendingPaid()
    return "dropped"
  }

  if (pending.linked) return givenUp()

  const check = await contractDeployed(pending.contract)
  if (check === "unknown") return "kept"
  if (check === "missing") return givenUp()

  try {
    await markBagPaid(pending.bagId, pending.contract)
    clearPendingPaid()
    return "linked"
  } catch {
    return givenUp()
  }
}
