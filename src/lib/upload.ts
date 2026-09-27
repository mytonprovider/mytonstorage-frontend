import { useEffect, useState, type RefObject } from "react"
import type { PickedFile, UnpaidBags } from "@/types/bag"
import { API_URL, ApiError, errorDetailOf, unpaidBagsOf } from "./api"
import { SECONDS_IN_MINUTE } from "./format"

const UPLOAD_PATH = "/api/v1/files"
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000
const SEGMENT_BYTES = 255
const RATE_WINDOW_MS = 5000
const RATE_WARMUP_MS = 2000
const STATS_TICK_MS = 1000
const LEFT_STEP_SECONDS = 5

const encoder = new TextEncoder()

export const safeName = (name: string): string =>
  [...name]
    .filter((char) => char !== "\0" && char !== "\\")
    .join("")
    .split("/")
    .filter((part) => part !== "." && part !== "..")
    .join("/") || "file"

const normalizedPath = (name: string): string => name.split("/").filter((part) => part).join("/")

const segmentTooLong = (name: string): boolean =>
  name.split("/").some((part) => encoder.encode(part).length > SEGMENT_BYTES)

const invalidName = (name: string): boolean =>
  !name ||
  /[\0\\\r\n"]/.test(name) ||
  name.startsWith("/") ||
  name.endsWith("/") ||
  name.split("/").some((part) => part === "." || part === "..")

export const validatePicked = (picked: PickedFile[]): { errorKey: string, names: string[] } | null => {
  const invalid = picked.filter((file) => invalidName(file.name))
  if (invalid.length) return { errorKey: "upload.invalidName", names: [...new Set(invalid.map((file) => file.name))] }

  const long = picked.filter((file) => segmentTooLong(file.name))
  if (long.length) return { errorKey: "upload.nameTooLong", names: [...new Set(long.map((file) => file.name))] }

  const counts = new Map<string, number>()
  for (const file of picked) {
    const path = normalizedPath(file.name)
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  const colliding = picked.filter((file) => (counts.get(normalizedPath(file.name)) ?? 0) > 1)
  if (colliding.length) return { errorKey: "upload.duplicateNames", names: [...new Set(colliding.map((file) => file.name))] }

  return null
}

export interface UploadHandle {
  promise: Promise<UnpaidBags>
  abort: () => void
}

const formOf = (files: PickedFile[], description: string): FormData => {
  const form = new FormData()
  form.append("description", description)
  files.forEach((picked) => form.append("file", picked.file, safeName(picked.name)))
  return form
}

export interface UploadProgress {
  loaded: number
  total: number
}

export const uploadBag = (
  files: PickedFile[],
  description: string,
  onProgress: (progress: UploadProgress) => void,
): UploadHandle => {
  const request = new XMLHttpRequest()

  const promise = new Promise<UnpaidBags>((resolve, reject) => {
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress({ loaded: event.loaded, total: event.total })
    })

    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new ApiError(request.status, "POST", UPLOAD_PATH, errorDetailOf(request.responseText)))
        return
      }
      try {
        resolve(unpaidBagsOf(JSON.parse(request.responseText)))
      } catch {
        reject(new Error("unexpected upload response shape"))
      }
    })

    request.addEventListener("error", () => reject(new ApiError(0, "POST", UPLOAD_PATH)))
    request.addEventListener("timeout", () => reject(new ApiError(0, "POST", UPLOAD_PATH)))
    request.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))

    request.open("POST", `${API_URL}${UPLOAD_PATH}`)
    request.timeout = UPLOAD_TIMEOUT_MS
    request.withCredentials = true
    request.send(formOf(files, description))
  })

  return { promise, abort: () => request.abort() }
}

export const totalSize = (files: PickedFile[]): number => files.reduce((sum, file) => sum + file.size, 0)

interface RateSample extends UploadProgress {
  at: number
}

export interface UploadStats extends UploadProgress {
  elapsed: number
  speed: number | null
  left: number | null
}

export const uploadStatsOf = (samples: RateSample[], startedAt: number): UploadStats => {
  const first = samples[0]
  const last = samples[samples.length - 1]
  const warm = last.at - startedAt >= RATE_WARMUP_MS && last.at > first.at
  const speed = warm ? ((last.loaded - first.loaded) * 1000) / (last.at - first.at) : null

  return {
    loaded: last.loaded,
    total: last.total,
    elapsed: (last.at - startedAt) / 1000,
    speed,
    left: speed ? (last.total - last.loaded) / speed : null,
  }
}

export const roundedLeft = (seconds: number): number =>
  seconds < SECONDS_IN_MINUTE
    ? Math.max(LEFT_STEP_SECONDS, Math.ceil(seconds / LEFT_STEP_SECONDS) * LEFT_STEP_SECONDS)
    : Math.ceil(seconds / SECONDS_IN_MINUTE) * SECONDS_IN_MINUTE

export const useUploadStats = (sent: RefObject<UploadProgress | null>, active: boolean): UploadStats | null => {
  const [stats, setStats] = useState<UploadStats | null>(null)

  useEffect(() => {
    if (!active) return

    const startedAt = performance.now()
    let samples: RateSample[] = []

    const tick = () => {
      const at = performance.now()
      const current = sent.current ?? { loaded: 0, total: 0 }
      samples = [...samples.filter((sample) => sample.at >= at - RATE_WINDOW_MS), { at, ...current }]
      setStats(uploadStatsOf(samples, startedAt))
    }

    tick()
    const timer = setInterval(tick, STATS_TICK_MS)

    return () => {
      clearInterval(timer)
      setStats(null)
    }
  }, [sent, active])

  return stats
}

const fingerprint = (file: PickedFile): string => `${file.name}-${file.size}-${file.file.lastModified}`

export const mergeFiles = (current: PickedFile[], added: PickedFile[]): PickedFile[] => {
  const seen = new Set(current.map(fingerprint))
  const fresh = added.filter((file) => {
    const key = fingerprint(file)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...current, ...fresh]
}

export const pickedFrom = (list: FileList | File[] | null): PickedFile[] =>
  Array.from(list ?? []).map((file) => ({ name: file.webkitRelativePath || file.name, size: file.size, file }))

export const hasFolder = (files: PickedFile[]): boolean => files.some((file) => file.name.includes("/"))

export const rootsOf = (files: PickedFile[]): string[] => [
  ...new Set(files.filter((file) => file.name.includes("/")).map((file) => file.name.split("/", 1)[0])),
]
