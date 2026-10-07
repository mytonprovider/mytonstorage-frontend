import { useTranslation } from "react-i18next"
import type { ContractStatus } from "@/types/contract"
import type { Tone } from "@/types/tone"
import { checkRan } from "./contracts"
import { formatDuration, type Translate } from "./format"

export type CheckKind = "stored" | "notStored" | "unavailable" | "unchecked"

const KIND_OF_CODE: Record<number, CheckKind> = {
  0: "stored",
  101: "unavailable",
  102: "unchecked",
  103: "unavailable",
  104: "unchecked",
  105: "unchecked",
  201: "unavailable",
  202: "unchecked",
  203: "unavailable",
  301: "notStored",
  302: "notStored",
  401: "notStored",
  402: "notStored",
  403: "notStored",
}

const KIND_WORD: Record<CheckKind, string> = {
  stored: "details.checkOk",
  notStored: "status.notStored",
  unavailable: "status.unavailable",
  unchecked: "status.unchecked",
}

const KIND_TONE: Record<CheckKind, Tone> = {
  stored: "green",
  notStored: "red",
  unavailable: "gray",
  unchecked: "gray",
}

export const checkKindOf = (reason: number): CheckKind => KIND_OF_CODE[reason] ?? "unchecked"

export interface CheckLabel {
  kind: CheckKind
  tone: Tone
  short: string
  long: string
  at: number
  ago: string
  agoShort: string
}

export interface CheckWarn {
  short: string
  full: string
}

export const checkLabelOf = (status: ContractStatus | undefined, now: number, t: Translate): CheckLabel | null => {
  if (!status || !checkRan(status)) return null

  const reason = status.reason
  const kind = checkKindOf(reason)
  const at = status.reason_timestamp
  const time = at ? formatDuration(now - at, t).replace(/ /g, "\u00A0") : ""

  return {
    kind,
    tone: KIND_TONE[kind],
    short: t(KIND_WORD[kind]),
    long: t([`reason.${reason}`, "status.unknownReason"], { value: String(reason) }),
    at: at ?? 0,
    ago: time ? t("details.checkAgo", { time }) : "",
    agoShort: time ? t("provider.ago", { time }) : "",
  }
}

export const useCheckLabel = (now: number) => {
  const { t } = useTranslation()

  return (status: ContractStatus | undefined): CheckLabel | null => checkLabelOf(status, now, t)
}
