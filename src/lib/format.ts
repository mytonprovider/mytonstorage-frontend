import { formatBytes as bytesText, fmt, NANO } from "@myton/ui/domain"
import { words, type Lang } from "@myton/ui/locale"

export type Translate = (key: string | string[], options?: { count?: string | number; code?: number; time?: string }) => string

export const MIB = 1024 ** 2

let serverOffsetMs: number | null = null

export const nowSeconds = (): number => Math.floor((Date.now() + (serverOffsetMs ?? 0)) / 1000)

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    signal?.addEventListener("abort", done, { once: true })

    function done() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", done)
      resolve()
    }
  })

export const applyServerDate = (header: string | null): void => {
  if (serverOffsetMs !== null) return
  const serverMs = Date.parse(header ?? "")
  if (Number.isFinite(serverMs)) serverOffsetMs = serverMs - Date.now()
}

const SECONDS_IN_HOUR = 3600
export const SECONDS_IN_MINUTE = 60

const pad = (value: number): string => String(value).padStart(2, "0")

export const splitFileName = (name: string): [string, string] => {
  const dot = name.lastIndexOf(".")
  const at = dot > 0 && dot > name.lastIndexOf("/") ? dot : name.length
  return [name.slice(0, at), name.slice(at)]
}

export const formatBytesOrZero = (bytes: number): string => bytesText(bytes) ?? "0 B"

export const formatDuration = (seconds: number | null | undefined, lang: Lang): string =>
  fmt.duration(seconds, words[lang].duration)

export const SHOWN_DIGITS = 3

export const formatTon = (nanotons: number, digits = SHOWN_DIGITS): string => fmt.ton(nanotons, digits)

export const tonLabel = (nanotons: number, digits = SHOWN_DIGITS): string => fmt.tonLabel(nanotons, digits)

const SHOWN_STEP = NANO / 10 ** SHOWN_DIGITS

export const ceilShown = (nanotons: number): number => Math.ceil(nanotons / SHOWN_STEP) * SHOWN_STEP

export const GHOST_TON = NANO / 3

export const formatCountdown = (seconds: number): string => {
  const left = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(left / SECONDS_IN_HOUR)
  const minutes = Math.floor((left % SECONDS_IN_HOUR) / SECONDS_IN_MINUTE)
  const rest = pad(left % SECONDS_IN_MINUTE)

  return hours > 0 ? `${hours}:${pad(minutes)}:${rest}` : `${pad(minutes)}:${rest}`
}

export const formatDate = (unixSeconds: number, language: string): string => {
  const date = new Date(unixSeconds * 1000)
  if (language === "ru") return date.toLocaleDateString("ru-RU")

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const formatDateTime = (unixSeconds: number, language: string): string => {
  const date = new Date(unixSeconds * 1000)
  return `${formatDate(unixSeconds, language)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
