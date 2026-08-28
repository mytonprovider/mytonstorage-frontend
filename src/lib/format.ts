export type Translate = (key: string | string[], options?: { count?: string | number; time?: string; value?: string }) => string

export const NANO = 1e9
export const MIB = 1024 ** 2
export const BYTES_IN_GIB = 1024 ** 3
export const BYTES_IN_GB = 1e9
export const SECONDS_IN_DAY = 86400

let serverOffsetMs: number | null = null

export const nowSeconds = (): number => Math.floor((Date.now() + (serverOffsetMs ?? 0)) / 1000)

export const applyServerDate = (header: string | null): void => {
  if (serverOffsetMs !== null) return
  const serverMs = Date.parse(header ?? "")
  if (Number.isFinite(serverMs)) serverOffsetMs = serverMs - Date.now()
}

const SECONDS_IN_HOUR = 3600
const SECONDS_IN_MINUTE = 60
const SECONDS_IN_YEAR = 31536000

const pad = (value: number): string => String(value).padStart(2, "0")

export const formatNumber = (value: number, digits: number): string =>
  Number.isFinite(value) ? String(Number(value.toFixed(digits))) : ""

export const formatPercent = (value: number, digits = 2): string => `${formatNumber(value, digits)}%`

export const shortenMiddle = (value: string | null | undefined, head: number, tail: number): string => {
  if (!value) return ""
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}

export const splitFileName = (name: string): [string, string] => {
  const dot = name.lastIndexOf(".")
  const at = dot > 0 && dot > name.lastIndexOf("/") ? dot : name.length
  return [name.slice(0, at), name.slice(at)]
}

export const GRAM = "GRAM"
export const MBIT_PER_SECOND = "Mbit/s"
export const MILLISECONDS = "ms"

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"]
const FILE_TOP = BYTE_UNITS.length - 1
const HARDWARE_TOP = BYTE_UNITS.indexOf("GB")
const WHOLE_FROM = 1000

const scaleFor = (bytes: number, top = FILE_TOP): { divisor: number; unit: string } => {
  let divisor = 1
  let index = 0

  while (bytes >= divisor * 1024 && index < top) {
    divisor *= 1024
    index += 1
  }

  return { divisor, unit: BYTE_UNITS[index] }
}

const scaleForHardware = (bytes: number): { divisor: number; unit: string } => scaleFor(bytes, HARDWARE_TOP)

const formatScaled = (bytes: number, divisor: number): string => {
  const value = bytes / divisor
  return formatNumber(value, value >= WHOLE_FROM ? 0 : 2)
}

export const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return ""

  const { divisor, unit } = scaleFor(bytes)
  return `${formatScaled(bytes, divisor)} ${unit}`
}

export const splitSpace = (bytes: number | null): { value: string; unit: string } => {
  if (bytes == null) return { value: "", unit: "" }

  const { divisor, unit } = scaleForHardware(bytes)
  return { value: formatScaled(bytes, divisor), unit }
}

const SPEED_UNITS: Record<string, number> = {
  B: 1,
  KB: 1e3,
  KIB: 1024,
  MB: 1e6,
  MIB: MIB,
  GB: BYTES_IN_GB,
  GIB: BYTES_IN_GIB,
}

const parseSpeed = (value: string | null | undefined): number | null => {
  const match = value === null || value === undefined ? null : /^([\d.]+)\s*(B|[KMG]iB|[KMG]B)(?:\/s|ps)?$/i.exec(value)
  if (match === null) return null
  const amount = Number(match[1])
  const factor = SPEED_UNITS[match[2].toUpperCase()]
  return factor !== undefined && Number.isFinite(amount) ? amount * factor : null
}

export const formatDiskSpeed = (value: string | null | undefined): string => {
  const speed = parseSpeed(value)
  return speed === null ? "" : `${formatNumber(speed / MIB, 2)} MiB/s`
}

export const formatBytesFloor = (bytes: number): string => {
  const { divisor, unit } = scaleFor(bytes)
  return `${formatNumber(Math.floor((bytes / divisor) * 100) / 100, 2)} ${unit}`
}

export const share = (used: number | null | undefined, total: number): string => {
  const { divisor, unit } = scaleForHardware(total)
  return `${formatScaled(used ?? 0, divisor)} / ${formatScaled(total, divisor)} ${unit}`
}

export const formatDuration = (seconds: number | null | undefined, t: Translate): string => {
  if (seconds == null || !Number.isFinite(seconds)) return ""
  if (seconds < SECONDS_IN_MINUTE) return t("time.sec", { count: Math.max(0, Math.round(seconds)) })

  const minutes = Math.floor(seconds / SECONDS_IN_MINUTE) % 60
  const hours = Math.floor(seconds / SECONDS_IN_HOUR) % 24
  const days = Math.floor(seconds / SECONDS_IN_DAY) % 365
  const years = Math.floor(seconds / SECONDS_IN_YEAR)

  if (years > 0) {
    const head = t("time.year", { count: years })
    return days ? `${head} ${t("time.days", { count: days })}` : head
  }

  if (seconds < SECONDS_IN_HOUR) return t("time.min", { count: minutes })

  if (seconds < SECONDS_IN_DAY) {
    const head = t("time.hr", { count: hours })
    return minutes ? `${head} ${t("time.min", { count: minutes })}` : head
  }

  const head = t("time.days", { count: days })
  return hours ? `${head} ${t("time.hr", { count: hours })}` : head
}

export const SHOWN_DIGITS = 3

export const formatTon = (nanotons: number, digits = SHOWN_DIGITS): string => formatNumber(nanotons / NANO, digits)

export const tonLabel = (nanotons: number, digits?: number): string =>
  `${formatTon(nanotons, digits)} ${GRAM}`

export const shownNano = (nanotons: number): number => Math.round(Number(formatTon(nanotons, SHOWN_DIGITS)) * NANO)

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
