import { useCallback, useEffect, useState } from "react"
import type { UserBag } from "@/types/bag"
import { deleteBag, failureStatus, fetchUnpaidBags, sessionEnded } from "./api"
import { retryPendingPaid } from "./paid-link"
import { UNAUTHORIZED, UNPAID_UNKNOWN } from "./wizard"

interface UnpaidFailure {
  key: string
  status: number | null
  kind: "load" | "remove"
}

export const loadFailure = (error: unknown): UnpaidFailure => ({
  key: sessionEnded(error) ? UNAUTHORIZED : UNPAID_UNKNOWN,
  status: failureStatus(error),
  kind: "load",
})

export const removeFailure = (error: unknown): UnpaidFailure => ({
  key: sessionEnded(error) ? UNAUTHORIZED : "errors.removeFailed",
  status: failureStatus(error),
  kind: "remove",
})

export interface UnpaidBagsState {
  bags: UserBag[]
  freeStorageSeconds: number
  listRead: boolean
  busy: boolean
  error: string | null
  status: number | null
  errorKind: UnpaidFailure["kind"] | null
  refresh: () => void
  remove: (bagId: string) => Promise<boolean>
}

export const useUnpaidBags = (address: string, onUnauthorized: () => void): UnpaidBagsState => {
  const [bags, setBags] = useState<UserBag[]>([])
  const [freeStorageSeconds, setFreeStorageSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [listRead, setListRead] = useState(false)
  const [removeError, setRemoveError] = useState<UnpaidFailure | null>(null)
  const [listError, setListError] = useState<UnpaidFailure | null>(null)
  const [attempt, setAttempt] = useState(0)

  const refresh = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    setBags([])
    setFreeStorageSeconds(0)
    setListRead(false)
    setRemoveError(null)
  }, [address])

  useEffect(() => {
    if (!address) return
    void retryPendingPaid().then((outcome) => {
      if (outcome === "linked") refresh()
    })
  }, [address, refresh])

  useEffect(() => {
    if (!address) return
    const controller = new AbortController()

    fetchUnpaidBags(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setBags(result.bags)
        setFreeStorageSeconds(result.free_storage)
        setListRead(true)
        setListError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setListRead(false)
        setListError(loadFailure(error))
        if (sessionEnded(error)) onUnauthorized()
      })

    return () => controller.abort()
  }, [address, attempt, onUnauthorized])

  const remove = useCallback(
    (bagId: string) => {
      setBusy(true)
      setRemoveError(null)
      return deleteBag(bagId)
        .then(() => {
          refresh()
          return true
        })
        .catch((error: unknown) => {
          setRemoveError(removeFailure(error))
          if (sessionEnded(error)) onUnauthorized()
          return false
        })
        .finally(() => setBusy(false))
    },
    [refresh, onUnauthorized],
  )

  const failure = listError ?? removeError

  return {
    bags,
    freeStorageSeconds,
    listRead,
    busy,
    error: failure?.key ?? null,
    status: failure?.status ?? null,
    errorKind: failure?.kind ?? null,
    refresh,
    remove,
  }
}
