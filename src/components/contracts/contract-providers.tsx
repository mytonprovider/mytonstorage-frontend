import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuote } from "@/lib/api"
import { useCheckLabel } from "@/lib/check-label"
import { useContractData, type ContractEconomics } from "@/lib/contracts-cache"
import { formatDate, formatDuration, nowSeconds, SECONDS_IN_DAY, tonLabel } from "@/lib/format"
import {
  DEFAULT_PROOF_DAYS,
  FEE_GAS,
  nextPaidDaysLeft,
  offerRates,
  providerFate,
  quotedBounties,
  recreateTotal,
  unquotedBounties,
  updateFee,
} from "@/lib/pricing"
import type { ProviderDecline, ProviderOffer } from "@/types/bag"
import type { StorageContract } from "@/types/contract"
import type { Provider } from "@/types/provider"
import { Notice } from "../notice"
import { ProvidersStep } from "../providers/providers-step"

interface ContractProvidersProps {
  contract: StorageContract
  providers: Provider[]
  loading: boolean
  failed: boolean
  status: number | null
  busy: boolean
  active: boolean
  copied: string | null
  onRetry: () => void
  onCopy: (value: string) => void
  onOpen: (pubkey: string) => void
  onAddManual: (provider: Provider) => void
  onSubmit: (pubkeys: string[], span: number, fileSize: number, amount: number) => void
}

export const ContractProviders = ({
  contract,
  providers,
  loading,
  failed,
  status,
  busy,
  active,
  copied,
  onRetry,
  onCopy,
  onOpen,
  onAddManual,
  onSubmit,
}: ContractProvidersProps) => {
  const { t, i18n } = useTranslation()
  const [pickedKeys, setPickedKeys] = useState<string[] | null>(null)
  const [pickedDays, setPickedDays] = useState<number | null>(null)
  const [declines, setDeclines] = useState<ProviderDecline[]>([])
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ContractEconomics | null>(null)
  const [offers, setOffers] = useState<ProviderOffer[] | null>(null)
  const [checked, setChecked] = useState(false)

  const { economics, statuses, unreadable, offline, retry } = useContractData(contract.address, true)
  const now = nowSeconds()
  const checkLabel = useCheckLabel(now)
  const { checking: quoting, invalidate, request: requestQuote } = useQuote()

  useEffect(() => {
    invalidate()
    setDeclines([])
    setOffers(null)
    setChecked(false)
  }, [pickedKeys, pickedDays, invalidate])

  useEffect(() => {
    if (economics) setSnapshot((known) => known ?? economics)
  }, [economics])

  if (unreadable) return <Notice tone="red">{t("providers.unreadable")}</Notice>

  if (offline && !economics) {
    return (
      <Notice
        tone="red"
        action={
          <button type="button" onClick={retry}>
            {t("ui.retry")}
          </button>
        }
      >
        {t("files.topupOffline")}
      </Notice>
    )
  }

  const base = snapshot ?? economics

  if (!base) {
    return (
      <ProvidersStep
        providers={[]}
        loading
        failed={false}
        status={null}
        onRetry={onRetry}
        selected={[]}
        proofDays={DEFAULT_PROOF_DAYS}
        bagSize={contract.size}
        checking={false}
        declines={[]}
        copied={null}
        editor
        onSelected={() => undefined}
        onAddManual={onAddManual}
        onProofDays={() => undefined}
        onCopy={onCopy}
        onOpen={onOpen}
        onContinue={() => undefined}
      />
    )
  }

  const selected = pickedKeys ?? base.pubkeys

  const warnOf = (pubkey: string): { short: string; full: string } | undefined => {
    const check = checkLabel(statuses.find((status) => status.provider_pubkey === pubkey))
    if (!check?.failed) return undefined
    return { short: check.short, full: check.ago ? `${check.long} · ${check.ago}` : check.long }
  }

  const bagId = contract.bagId || base.bagId
  const touched = pickedDays !== null
  const spanSeconds = touched ? pickedDays * SECONDS_IN_DAY : base.span || DEFAULT_PROOF_DAYS * SECONDS_IN_DAY
  const contractKeys = new Set(base.pubkeys.map((key) => key.toLowerCase()))
  const added = selected.some((key) => !contractKeys.has(key.toLowerCase()))
  const unchanged = !added && selected.length === base.pubkeys.length && !touched

  const fates = providerFate(base, selected, spanSeconds, offers)
  const affected = [...fates.values()].filter((fate) => fate === "new" || fate === "recreated").length
  const recreated = recreateTotal(base.fileSize, spanSeconds, fates, offerRates(offers))
  const pool = bagId
    ? quotedBounties(base.fileSize, spanSeconds, offerRates(offers))
    : unquotedBounties(base.fileSize, spanSeconds, selected, base)
  const fee = updateFee(pool, added, base.balance)
  const warning =
    !bagId && !unchanged
      ? t("providers.recreateUnknown")
      : checked && affected > 0
        ? t("providers.recreateSummary", { count: affected, amount: tonLabel(recreated) })
        : undefined

  const nextPaidDays = nextPaidDaysLeft(
    base,
    selected,
    spanSeconds,
    offers,
    base.fileSize,
    base.balance + fee - FEE_GAS,
    now,
  )

  const revert = () => {
    setPickedKeys(null)
    setPickedDays(null)
  }

  const save = () => onSubmit(selected, spanSeconds, base.fileSize, fee)

  const check = () => {
    setQuoteError(null)
    setDeclines([])

    if (!bagId) {
      setChecked(true)
      return
    }

    requestQuote(
      bagId,
      spanSeconds,
      selected,
      base.fileSize,
      ({ offers: quoted, declines: refused, complete }) => {
        setOffers(quoted)
        setDeclines(refused)
        if (refused.length > 0) return
        if (complete) {
          setChecked(true)
          return
        }
        setQuoteError("errors.offersIncomplete")
      },
      () => setQuoteError("errors.offersFailed"),
    )
  }

  return (
    <ProvidersStep
      providers={providers}
      loading={loading}
      failed={failed}
      status={status}
      onRetry={onRetry}
      selected={selected}
      proofDays={spanSeconds / SECONDS_IN_DAY}
      bagSize={base.fileSize}
      checking={quoting || active}
      declines={declines}
      copied={copied}
      proofValueLabel={
        touched || !base.span ? undefined : t("providers.spanCurrent", { value: formatDuration(base.span, t) })
      }
      fates={fates}
      warning={warning}
      error={quoteError}
      submitLabel={checked ? t("providers.submit") : t("ui.continue")}
      warnOf={warnOf}
      submitDisabled={busy || unchanged}
      editor
      total={checked ? tonLabel(fee) : undefined}
      until={checked && nextPaidDays !== null ? formatDate(now + nextPaidDays * SECONDS_IN_DAY, i18n.language) : undefined}
      submitReason={unchanged ? t("providers.unchangedHint") : undefined}
      revertDisabled={unchanged}
      onSelected={setPickedKeys}
      onAddManual={onAddManual}
      onProofDays={setPickedDays}
      onCopy={onCopy}
      onOpen={onOpen}
      onRevert={revert}
      onContinue={checked ? save : check}
    />
  )
}
