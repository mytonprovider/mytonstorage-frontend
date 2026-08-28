import { useTranslation } from "react-i18next"
import type { ContractStatus } from "@/types/contract"
import { checkRan } from "./contracts"
import { formatDuration, type Translate } from "./format"

interface CheckLabel {
  failed: boolean
  short: string
  long: string
  at: number
  ago: string
  agoShort: string
}

export const checkLabelOf = (status: ContractStatus | undefined, now: number, t: Translate): CheckLabel | null => {
  if (!status || !checkRan(status)) return null

  const reason = status.reason
  const at = status.reason_timestamp
  const time = at ? formatDuration(now - at, t).replace(/ /g, "\u00A0") : ""

  return {
    failed: reason !== 0,
    short: reason === 0 ? t("details.checkOk") : t([`reasonShort.${reason}`, "status.unknownCode"], { value: String(reason) }),
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
