import { useTranslation } from "react-i18next"
import { checkKind, reasonTone, type CheckKind, type StatusTone } from "@myton/ui/domain"
import { pickLang } from "@myton/ui/i18n"
import { reasonKey, words, type Lang } from "@myton/ui/locale"
import type { ContractStatus } from "@/types/contract"
import { checkRan } from "./contracts"
import { formatDuration, type Translate } from "./format"

type CheckView = "stored" | "notStored" | "unavailable" | "unchecked"

const VIEW_OF_KIND: Record<CheckKind, CheckView> = {
  stored: "stored",
  unavailable: "unavailable",
  unchecked: "unchecked",
  unknown: "unchecked",
  noBagInfo: "notStored",
  noProof: "notStored",
}

// Every hired provider holding the file is green, a majority yellow, fewer red
export const checksTone = (valid: number, total: number): Extract<StatusTone, "green" | "yellow" | "red"> =>
  valid === total ? "green" : valid * 2 > total ? "yellow" : "red"

export const checkKindOf = (reason: number): CheckView => VIEW_OF_KIND[checkKind(reason) ?? "unknown"]

// A check the checker itself broke, or one under a code it does not know, says nothing of the storage: not run
const SHORT_OF_KIND: Record<CheckView, string> = {
  stored: "details.checkOk",
  notStored: "details.checkFailed",
  unavailable: "details.checkFailed",
  unchecked: "details.checkNotRun",
}

interface CheckLabel {
  kind: CheckView
  tone: StatusTone
  short: string
  long: string
  at: number
  agoShort: string
}

export interface CheckWarn {
  short: string
  full: string
  tone: StatusTone
}

export const checkLabelOf = (status: ContractStatus | undefined, now: number, t: Translate, lang: Lang): CheckLabel | null => {
  if (!status || !checkRan(status)) return null

  const reason = status.reason
  const kind = checkKindOf(reason)
  const at = status.reason_timestamp
  const time = at ? formatDuration(now - at, lang).replace(/ /g, "\u00A0") : ""

  return {
    kind,
    tone: reasonTone(reason),
    short: t(SHORT_OF_KIND[kind]),
    long: t(`ui:reason.${reasonKey(reason)}`, { code: reason }),
    at: at ?? 0,
    agoShort: time ? words[lang].ago.ago(time) : "",
  }
}

export const useCheckLabel = (now: number) => {
  const { t, i18n } = useTranslation()
  const lang = pickLang(i18n.language)

  return (status: ContractStatus | undefined): CheckLabel | null => checkLabelOf(status, now, t, lang)
}
