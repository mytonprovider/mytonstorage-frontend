import { ApiError } from "./api"
import type { DeployCheck } from "./paid-link"
import { walletRefused } from "./ton/transactions"

export const UNAUTHORIZED = "errors.unauthorized"

export const UNPAID_UNKNOWN = "errors.unpaidUnknown"

const PAYMENT_UNCHECKED = "errors.paymentUnchecked"

export const OFFERS_INCOMPLETE = "errors.offersIncomplete"

export const CONFIRM_TIMEOUT = "errors.confirmTimeout"

export const checkErrorKey = (check: DeployCheck): string =>
  check === "missing" ? "errors.paymentFailed" : PAYMENT_UNCHECKED

export const payErrorTone = (key: string): "neutral" | "red" =>
  key === PAYMENT_UNCHECKED || key === CONFIRM_TIMEOUT ? "neutral" : "red"

export const payErrorKey = (
  error: unknown,
  { withBag = true, fallback = "errors.paymentFailed" }: { withBag?: boolean; fallback?: string } = {},
): string => {
  if (!(error instanceof ApiError)) return fallback
  if (error.status === 429) return "errors.rateLimited"
  if (withBag && error.status === 400 && error.detail.includes("providers unavailable")) return OFFERS_INCOMPLETE
  if (withBag && (error.status === 410 || error.detail.includes("expired") || error.detail.includes("fetch providers rates"))) {
    return "wizard.expired"
  }
  return fallback
}

export const deployFailureKey = (deployed: boolean, error: unknown): string | null =>
  walletRefused(error) ? null : deployed ? "errors.notLinked" : payErrorKey(error)

export const uploadErrorKey = (error: unknown): string => {
  if (!(error instanceof ApiError)) return "errors.uploadFailed"
  if (error.status === 0) return "errors.offline"
  if (error.status === 400 && error.detail.includes("unpaid bags")) return "errors.hasUnpaid"
  if (error.status === 400 && error.detail.startsWith("too many files")) return "upload.tooMany"
  if (error.status === 400 && error.detail.includes("invalid filename")) return "errors.badNames"
  if (error.status === 413) return "errors.uploadTooLarge"
  if (error.status === 503) return "errors.serverFull"
  if (error.status === 429) return "errors.rateLimited"
  return "errors.uploadFailed"
}
