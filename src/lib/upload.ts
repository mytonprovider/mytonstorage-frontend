import type { PickedFile, UnpaidBags } from "@/types/bag"
import { API_URL, ApiError, errorDetailOf, unpaidBagsOf } from "./api"

const UPLOAD_PATH = "/api/v1/files"
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000
const SEGMENT_BYTES = 255

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

export const uploadBag = (files: PickedFile[], description: string, onProgress: (percent: number) => void): UploadHandle => {
  const request = new XMLHttpRequest()

  const promise = new Promise<UnpaidBags>((resolve, reject) => {
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
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
