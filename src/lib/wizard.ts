import { useCallback, useEffect, useRef, useState } from "react"
import { useTonConnectUI } from "@tonconnect/ui-react"
import type { PickedFile, ProviderDecline, ProviderOffer, UserBag } from "@/types/bag"
import type { WalletTransaction } from "@/types/contract"
import { ApiError, deleteBag, initContract, markBagPaid, sessionEnded, useQuote } from "./api"
import { useCountdown } from "./countdown"
import { scrollToTop } from "./dom"
import { nowSeconds, SECONDS_IN_DAY } from "./format"
import { clearPendingPaid, contractDeployed, markPendingLinked, readPendingPaid, writePendingPaid, type DeployCheck } from "./paid-link"
import { DEFAULT_PROOF_DAYS, DEFAULT_STORAGE_DAYS, gridDays, storageCost } from "./pricing"
import { sendAndConfirm, waitForTransaction, walletRefused } from "./ton/transactions"
import { mergeFiles, totalSize, uploadBag, type UploadHandle } from "./upload"

const BAG_ID_LENGTH = 64

export type WizardStep = 1 | 2 | 3 | 4

export interface WizardData {
  files: PickedFile[]
  description: string
  bagId: string | null
  selected: string[]
  contractAddress: string | null
  paid: boolean
}

export const EMPTY_WIZARD: WizardData = {
  files: [],
  description: "",
  bagId: null,
  selected: [],
  contractAddress: null,
  paid: false,
}

const hasBag = (data: WizardData): boolean => !!data.bagId && data.bagId.length === BAG_ID_LENGTH

export const reachedStep = (data: WizardData, offersReady: boolean): WizardStep => {
  const uploaded = hasBag(data)
  const chosen = uploaded && data.selected.length > 0

  if (chosen && !!data.contractAddress && data.paid) return 4
  if (chosen && offersReady) return 3
  if (uploaded) return 2
  return 1
}

export const allAccepted = (offers: ProviderOffer[], declines: ProviderDecline[], selected: string[]): boolean => {
  const quoted = new Set(offers.map((offer) => offer.provider.key.toLowerCase()))
  return selected.length > 0 && declines.length === 0 && selected.every((key) => quoted.has(key.toLowerCase()))
}

export const deployInFlight = (data: WizardData): string | null =>
  data.contractAddress && !data.paid ? data.contractAddress : null

export const deployAction = (check: DeployCheck): "link" | "send" | "wait" =>
  check === "deployed" ? "link" : check === "missing" ? "send" : "wait"

export const resumedContract = (bagId: string): string | null => {
  const pending = readPendingPaid()
  return pending && pending.bagId === bagId ? pending.contract : null
}

export const UNAUTHORIZED = "errors.unauthorized"

export const UNPAID_UNKNOWN = "errors.unpaidUnknown"

const PAYMENT_UNCHECKED = "errors.paymentUnchecked"

const OFFERS_INCOMPLETE = "errors.offersIncomplete"

export const CONFIRM_TIMEOUT = "errors.confirmTimeout"

export const checkErrorKey = (check: DeployCheck): string =>
  check === "missing" ? "errors.paymentFailed" : PAYMENT_UNCHECKED

export const payErrorTone = (key: string): "neutral" | "red" =>
  key === PAYMENT_UNCHECKED || key === CONFIRM_TIMEOUT ? "neutral" : "red"

export const contractAfterFailure = (contract: string | null, error: unknown): string | null =>
  walletRefused(error) ? null : contract

export const clampStep = (picked: number, reached: WizardStep): WizardStep =>
  Math.max(1, Math.min(picked, reached)) as WizardStep

const DEPLOY_TIMEOUT_MS = 240_000

const PAYMENT_HASH_TIMEOUT_MS = 60_000

export const payErrorKey = (error: unknown, { withBag = true }: { withBag?: boolean } = {}): string => {
  if (!(error instanceof ApiError)) return "errors.paymentFailed"
  if (error.status === 429) return "errors.rateLimited"
  if (withBag && error.status === 400 && error.detail.includes("providers unavailable")) return OFFERS_INCOMPLETE
  if (withBag && (error.status === 410 || error.detail.includes("expired") || error.detail.includes("fetch providers rates"))) {
    return "wizard.expired"
  }
  return "errors.paymentFailed"
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

interface WizardOptions {
  restored: boolean
  address: string
  signOut: () => void
  unpaidBags: UserBag[]
  unpaidKnown: boolean
  freeStorageSeconds: number
  refreshUnpaid: () => void
}

export type WizardFlow = ReturnType<typeof useWizardFlow>

export const useWizardFlow = ({ restored, address, signOut, unpaidBags, unpaidKnown, freeStorageSeconds, refreshUnpaid }: WizardOptions) => {
  const [tonConnectUI] = useTonConnectUI()

  const [data, setData] = useState<WizardData>(EMPTY_WIZARD)
  const [picked, setPicked] = useState<WizardStep>(1)
  const [proofDays, setProofDays] = useState(DEFAULT_PROOF_DAYS)
  const [storageDays, setStorageDays] = useState(DEFAULT_STORAGE_DAYS)
  const [offers, setOffers] = useState<ProviderOffer[]>([])
  const [declines, setDeclines] = useState<ProviderDecline[]>([])
  const [bagSize, setBagSize] = useState(0)
  const [filesCount, setFilesCount] = useState(0)

  const [progress, setProgress] = useState<number | null>(null)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [gateBag, setGateBag] = useState<UserBag | null>(null)
  const [sending, setSending] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [paymentHash, setPaymentHash] = useState<string | null>(null)

  const upload = useRef<UploadHandle | null>(null)
  const { checking, invalidate, request: requestQuote } = useQuote()

  const left = useCountdown(deadline ?? 0)
  const expired = deadline !== null && left === 0

  const verified = allAccepted(offers, declines, data.selected)
  const reached = reachedStep(data, verified)
  const step = clampStep(picked, reached)

  useEffect(() => {
    invalidate()
    setOffers([])
    setDeclines([])
  }, [data.selected, proofDays, invalidate])

  const clearFlow = useCallback(() => {
    setPicked(1)
    setOffers([])
    setDeclines([])
    setBagSize(0)
    setFilesCount(0)
    setProgress(null)
    setDeadline(null)
    setUploadError(null)
    setPayError(null)
    setPaymentHash(null)
  }, [])

  const reset = useCallback(() => {
    setData(EMPTY_WIZARD)
    clearFlow()
  }, [clearFlow])

  const dropSession = useCallback(() => {
    setData((current) => ({ ...EMPTY_WIZARD, files: current.files, description: current.description }))
    clearFlow()
  }, [clearFlow])

  useEffect(() => {
    if (restored && !address) dropSession()
  }, [restored, address, dropSession])

  const onUnauthorized = useCallback(
    (error: unknown) => {
      if (!sessionEnded(error)) return false
      dropSession()
      setUploadError(UNAUTHORIZED)
      signOut()
      return true
    },
    [signOut, dropSession],
  )

  const goStep = useCallback((next: WizardStep) => {
    setPicked(next)
    scrollToTop()
  }, [])

  const resumeBag = useCallback(
    (bag: UserBag) => {
      setData({ ...EMPTY_WIZARD, bagId: bag.bag_id, description: bag.description, contractAddress: resumedContract(bag.bag_id) })
      setDeadline(bag.created_at + freeStorageSeconds)
      setOffers([])
      setDeclines([])
      setPayError(null)
      setUploadError(null)
      setBagSize(bag.bag_size)
      setFilesCount(bag.files_count)
      setPicked(2)
      scrollToTop()
    },
    [freeStorageSeconds],
  )

  const forgetBag = useCallback(
    (bagId: string) => setData((current) => (current.bagId === bagId ? EMPTY_WIZARD : current)),
    [],
  )

  const addFiles = useCallback(
    (files: PickedFile[]) => setData((current) => ({ ...current, files: mergeFiles(current.files, files) })),
    [],
  )
  const replaceFiles = useCallback((files: PickedFile[]) => setData((current) => ({ ...current, files })), [])
  const removeFile = useCallback(
    (index: number) => setData((current) => ({ ...current, files: current.files.filter((_, at) => at !== index) })),
    [],
  )
  const clearFiles = useCallback(() => setData((current) => ({ ...current, files: [] })), [])
  const setDescription = useCallback(
    (description: string) => setData((current) => ({ ...current, description })),
    [],
  )
  const selectProviders = useCallback((selected: string[]) => setData((current) => ({ ...current, selected })), [])

  const beginUpload = () => {
    setUploadError(null)
    setProgress(0)

    const size = totalSize(data.files)
    const count = data.files.length

    const handle = uploadBag(data.files, data.description, setProgress)
    upload.current = handle

    handle.promise
      .then((created) => {
        const bag = created.bags[0]
        if (!bag) throw new Error("no bag in upload response")
        setBagSize(bag.bag_size || size)
        setFilesCount(bag.files_count || count)
        setData((current) => ({ ...current, bagId: bag.bag_id }))
        setDeadline(bag.created_at + created.free_storage)
        setProgress(null)
        refreshUnpaid()
        setPicked(2)
        scrollToTop()
      })
      .catch((error: unknown) => {
        setProgress(null)
        if (error instanceof DOMException && error.name === "AbortError") return
        if (onUnauthorized(error)) return
        if (error instanceof ApiError && error.detail.includes("unpaid bags")) refreshUnpaid()
        setUploadError(uploadErrorKey(error))
      })
      .finally(() => {
        upload.current = null
      })
  }

  const submitUpload = () => {
    if (!unpaidKnown) {
      setUploadError(UNPAID_UNKNOWN)
      refreshUnpaid()
      return
    }

    const now = nowSeconds()
    const waiting = unpaidBags.find((bag) => bag.created_at + freeStorageSeconds > now)
    if (waiting) {
      setGateBag(waiting)
      return
    }
    beginUpload()
  }

  const cancelUpload = () => upload.current?.abort()

  const closeGate = () => setGateBag(null)

  const replaceGateBag = () => {
    const bag = gateBag
    if (!bag) return

    setGateBag(null)
    deleteBag(bag.bag_id)
      .then(() => {
        refreshUnpaid()
        beginUpload()
      })
      .catch((error: unknown) => {
        if (!onUnauthorized(error)) setUploadError("errors.uploadFailed")
      })
  }

  const resumeGateBag = () => {
    const bag = gateBag
    if (!bag) return

    setGateBag(null)
    resumeBag(bag)
  }

  const requestOffers = () => {
    if (!data.bagId) return

    setDeclines([])
    setPayError(null)

    requestQuote(
      data.bagId,
      proofDays * SECONDS_IN_DAY,
      data.selected,
      bagSize,
      ({ offers: offered, declines: refused, complete }) => {
        setOffers(offered)
        setDeclines(refused)
        if (!complete && refused.length === 0) setPayError(OFFERS_INCOMPLETE)
        const stillFree = deadline === null || nowSeconds() < deadline
        if (allAccepted(offered, refused, data.selected) && stillFree) goStep(3)
      },
      (error) => {
        if (onUnauthorized(error)) return
        const outdated = error instanceof ApiError && (error.status === 410 || error.detail.includes("expired"))
        setPayError(outdated ? "wizard.expired" : "errors.offersFailed")
      },
    )
  }

  const linkPaidBag = async (bagId: string, contract: string) => {
    await markBagPaid(bagId, contract)
    markPendingLinked()
    setData((current) => ({ ...current, paid: true }))
    refreshUnpaid()
    setPicked(4)
    scrollToTop()
  }

  const signDeploy = async (bagId: string, transaction: WalletTransaction) => {
    let deployed = false
    const since = nowSeconds()
    setPaymentHash(null)

    try {
      const remembered = writePendingPaid(bagId, transaction.address, address, data.description, bagSize)
      setData((current) => ({ ...current, contractAddress: transaction.address }))
      if (!remembered) setPayError("errors.linkNotSaved")

      const confirmed = await sendAndConfirm(tonConnectUI, transaction, DEPLOY_TIMEOUT_MS)
      if (!confirmed) throw new Error("not confirmed")

      deployed = true
      void waitForTransaction(
        transaction.address,
        since,
        tonConnectUI.account?.address,
        PAYMENT_HASH_TIMEOUT_MS,
      ).then(setPaymentHash)
      await linkPaidBag(bagId, transaction.address)
    } catch (error) {
      const keptContract = contractAfterFailure(transaction.address, error)
      if (!keptContract) clearPendingPaid()
      setData((current) => ({ ...current, contractAddress: keptContract }))
      const key = deployFailureKey(deployed, error)
      if (!onUnauthorized(error) && key) setPayError(key)
    }
  }

  const sendDeploy = async () => {
    if (!data.bagId || !address) return

    const bagId = data.bagId

    setSending(true)
    setPayError(null)

    const startedContract = deployInFlight(data)

    if (startedContract) {
      const check = await contractDeployed(startedContract)
      const action = deployAction(check)

      if (action !== "send") {
        if (action === "link") {
          try {
            await linkPaidBag(bagId, startedContract)
          } catch (error) {
            if (!onUnauthorized(error)) setPayError("errors.notLinked")
          }
        } else {
          setPayError(checkErrorKey(check))
        }

        setSending(false)
        return
      }
    }

    try {
      const transaction = await initContract({
        bag_id: bagId,
        providers: data.selected,
        amount: storageCost(offers, gridDays(storageDays, proofDays), proofDays),
        owner_address: address,
        span: proofDays * SECONDS_IN_DAY,
      })

      await signDeploy(bagId, transaction)
    } catch (error) {
      if (!onUnauthorized(error)) {
        const key = payErrorKey(error)
        if (key === OFFERS_INCOMPLETE) {
          invalidate()
          setOffers([])
          setDeclines([])
        }
        setPayError(key)
      }
    } finally {
      setSending(false)
    }
  }

  return {
    data,
    step,
    reached,
    proofDays,
    storageDays,
    offers,
    declines,
    verified,
    bagSize,
    filesCount,
    progress,
    deadline,
    expired,
    checking,
    sending,
    uploadError,
    payError,
    paymentHash,
    gateBag,
    onUnauthorized,
    reset,
    goStep,
    resumeBag,
    forgetBag,
    addFiles,
    replaceFiles,
    removeFile,
    clearFiles,
    setDescription,
    selectProviders,
    setProofDays,
    setStorageDays,
    submitUpload,
    cancelUpload,
    closeGate,
    replaceGateBag,
    resumeGateBag,
    requestOffers,
    deploy: () => void sendDeploy(),
  }
}
