import { useEffect, useMemo, useState } from "react"
import { SquareCheck } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button, Card, cx, FieldList, LoadError, Notice, SectionTitle, SheetFooter, skeletonClass } from "@myton/ui"
import { DAY, EMPTY, rankByRating, type Provider } from "@myton/ui/domain"
import { forgetOffers, useQuote } from "@/lib/api"
import { quoteTargetOf, silentProviders, type ContractRow } from "@/lib/contracts"
import { useContractData } from "@/lib/contracts-cache"
import { formatDate, nowSeconds, tonLabel } from "@/lib/format"
import { FEE_GAS, nextPaidDaysLeft, offerRates, providerFate, quotedBounties, recreateTotal, unquotedBounties, updateFee } from "@/lib/pricing"
import { declineKeyOf, freshSeed, hostingPool, pickReplacements, spanAllows } from "@/lib/providers"
import type { ProviderOffer } from "@/types/bag"
import { daysLabel } from "../providers/catalog-toolbar"
import { SelectedTable } from "../providers/selected-table"
import { SheetField } from "../sheet-fields"
import shared from "../shared.module.css"
import styles from "./contract-fix.module.css"

const MAX_ROUNDS = 2

interface ContractFixProps {
  contract: ContractRow
  providers: Provider[]
  catalogLoading: boolean
  catalogFailed: boolean
  catalogStatus: number | null
  busy: boolean
  copied: string | null
  onRetryCatalog: () => void
  onCopy: (value: string) => void
  onOpen: (pubkey: string) => void
  onManual: () => void
  onSubmit: (pubkeys: string[], span: number, fileSize: number, amount: number) => void
  onGone: () => void
}

export const ContractFix = ({
  contract,
  providers,
  catalogLoading,
  catalogFailed,
  catalogStatus,
  busy,
  copied,
  onRetryCatalog,
  onCopy,
  onOpen,
  onManual,
  onSubmit,
  onGone,
}: ContractFixProps) => {
  const { t, i18n } = useTranslation()
  const [seed, setSeed] = useState(0)
  const [refused, setRefused] = useState<string[]>([])
  const [rounds, setRounds] = useState(0)
  const [dropped, setDropped] = useState(0)
  const [keptDeclines, setKeptDeclines] = useState<Record<string, string>>({})
  const [attempt, setAttempt] = useState(0)
  const [offers, setOffers] = useState<ProviderOffer[] | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [pickedFrom, setPickedFrom] = useState<Provider[] | null>(null)
  const { checking, invalidate, request } = useQuote()
  const { state: latest } = useContractData(contract.address)

  const now = nowSeconds()
  const state = latest ?? contract.state
  const silent = state ? silentProviders({ ...contract, state }, now) : []
  const { bagId, span, fileSize } = quoteTargetOf({ ...contract, state }) ?? { bagId: "", span: 0, fileSize: 0 }
  // The place among those that can take this contract's bag, as the picker counts it
  const ranks = useMemo(() => rankByRating(hostingPool(providers, span / DAY, fileSize)), [providers, span, fileSize])
  const alive = (state?.providers ?? []).map(({ pubkey }) => pubkey).filter((key) => !silent.includes(key))
  const unanswered = alive.filter((key) => key.toLowerCase() in keptDeclines)
  const stuck = unanswered.length > 0 && unanswered.length === alive.length
  const outgoing = stuck ? silent : [...silent, ...unanswered]
  const kept = alive.filter((key) => !outgoing.includes(key))
  const wanted = {
    skip: [...(state?.providers ?? []).map(({ pubkey }) => pubkey), ...refused],
    count: Math.max(0, outgoing.length - dropped),
    bagSize: fileSize,
    seed,
  }
  const candidates = pickedFrom ?? providers
  const added = state ? pickReplacements(candidates, { ...wanted, proofDays: span / DAY }) : []
  const spanLimited = added.length < wanted.count && pickReplacements(candidates, { ...wanted, proofDays: null }).length > added.length
  const picking = catalogLoading || catalogFailed
  const keptKey = kept.join(",")
  const addedKey = added.join(",")
  const gone = !state || silent.length === 0 || silent.length === state.providers.length

  useEffect(() => {
    if (!picking && pickedFrom === null) setPickedFrom(providers)
  }, [picking, pickedFrom, providers])

  useEffect(() => {
    invalidate()
    setOffers(null)
    setQuoteError(null)
    const keys = [...keptKey.split(","), ...addedKey.split(",")].filter(Boolean)
    if (gone || picking || !bagId || keys.length === 0) return
    const fresh = new Set(addedKey.split(",").map((key) => key.toLowerCase()))

    request(
      bagId,
      span,
      keys,
      fileSize,
      ({ offers: quoted, declines: refusedNow, complete }) => {
        if (refusedNow.length > 0) {
          const freshRefused = refusedNow.map(({ provider_key }) => provider_key.toLowerCase()).filter((key) => fresh.has(key))
          const keptRefused = refusedNow.filter(({ provider_key }) => !fresh.has(provider_key.toLowerCase()))
          if (keptRefused.length > 0) {
            const kept = Object.fromEntries(keptRefused.map(({ provider_key, reason }) => [provider_key.toLowerCase(), reason]))
            setKeptDeclines((known) => ({ ...known, ...kept }))
          }
          if (freshRefused.length > 0) {
            setRefused((known) => [...known, ...freshRefused])
            if (rounds < MAX_ROUNDS) setRounds((count) => count + 1)
            else setDropped((count) => count + freshRefused.length)
          }
          return
        }
        setOffers(quoted)
        if (!complete) setQuoteError("errors.offersIncomplete")
      },
      () => setQuoteError("errors.offersFailed"),
    )
  }, [gone, picking, bagId, span, fileSize, keptKey, addedKey, rounds, attempt, request, invalidate])

  useEffect(() => {
    if (gone) onGone()
  }, [gone, onGone])

  if (!state || gone) return null

  const selected = [...kept, ...added]
  const total = state.providers.length
  const ready = !picking && !stuck && (bagId ? offers !== null && quoteError === null : true)

  const fates = providerFate(state.providers, selected, span, offers)
  const rates = offerRates(offers)
  const pool = bagId ? quotedBounties(fileSize, span, rates) : unquotedBounties(fileSize, span, selected, state.providers)
  const fee = updateFee(pool, added.length > 0, state.balance)
  const nextPaidDays = nextPaidDaysLeft(state.providers, selected, span, offers, fileSize, state.balance + fee - FEE_GAS, now)
  const recreated = new Map([...fates].filter(([, fate]) => fate === "recreated"))
  const date = (seconds: number) => formatDate(seconds, i18n.language)

  const leadKey = !picking && added.length === 0 ? "fix.leadRemove" : !picking && added.length < outgoing.length ? "fix.leadShort" : "fix.leadReplace"
  const lead = t(outgoing.length > silent.length ? `${leadKey}Mixed` : leadKey, { count: outgoing.length, total, found: added.length })
  const reason = !picking && spanLimited ? ` ${t("fix.spanRare", { days: daysLabel(t, span / DAY) })}` : ""

  const whyOf = (pubkey: string): string => {
    const decline = keptDeclines[pubkey.toLowerCase()]
    if (decline !== undefined) return t(declineKeyOf(decline) ?? "catalog.noOffer")
    const { lastProofTime } = state.providers.find((provider) => provider.pubkey === pubkey) ?? { lastProofTime: 0 }
    if (lastProofTime) return t("fix.why.silent")
    const listed = providers.find((provider) => provider.pubkey.toLowerCase() === pubkey.toLowerCase())
    return listed && !spanAllows(listed, span / DAY)
      ? t("catalog.spanShort", { days: daysLabel(t, span / DAY) })
      : t("fix.why.neverTook")
  }

  const pickAgain = () => {
    setPickedFrom(providers)
    setSeed(freshSeed())
    setRounds(0)
    setDropped(0)
  }

  const askAgain = () => {
    forgetOffers(bagId)
    setKeptDeclines({})
    setAttempt((count) => count + 1)
  }

  return (
    <div className={styles.body}>
      <Notice tone="yellow">{lead + reason}</Notice>

      <div>
        <div className={styles.head} data-sheet="">
          <SectionTitle size="md" icon={SquareCheck}>
            <span>{t("fix.newTitle")}</span>
          </SectionTitle>
          {!picking && <span className={styles.count}>{`${added.length} / ${outgoing.length}`}</span>}
          <div className={styles.headActions}>
            <Button variant="text" onClick={pickAgain}>
              {t("catalog.pickAgain")}
            </Button>
            <span className={shared.spacer} />
            <Button variant="text" onClick={onManual}>
              {t("fix.manual")}
            </Button>
          </div>
        </div>

        <SelectedTable
          ranks={ranks}
          pinned={[...silent, ...unanswered, ...added].map((pubkey) => ({
            pubkey,
            provider: providers.find((provider) => provider.pubkey.toLowerCase() === pubkey.toLowerCase()) ?? null,
          }))}
          proofDays={span / DAY}
          catalogReady={!picking}
          declineByKey={new Map(Object.entries(keptDeclines))}
          fates={fates}
          copied={copied}
          reasonOf={whyOf}
          onCopy={onCopy}
          onOpen={onOpen}
        />
      </div>

      {catalogFailed && (
        <LoadError message={t("errors.failedToLoadProviders")} status={catalogStatus} onRetry={onRetryCatalog} />
      )}
      {stuck && (
        <Notice
          tone="red"
          action={
            <Button size="sm" onClick={askAgain}>
              {t("ui:ui.retry")}
            </Button>
          }
        >
          {t("fix.unanswered", { count: unanswered.length })}
        </Notice>
      )}
      {quoteError && (
        <Notice
          tone="red"
          action={
            <Button size="sm" onClick={askAgain}>
              {t("ui:ui.retry")}
            </Button>
          }
        >
          {t(quoteError)}
        </Notice>
      )}
      {ready && recreated.size > 0 && (
        <Notice tone="yellow">{t("providers.recreateSummary", { count: recreated.size, amount: tonLabel(recreateTotal(fileSize, span, recreated, rates)) })}</Notice>
      )}

      {!stuck && !quoteError && !catalogFailed && (
        <Card pad="row" className={styles.panel}>
          <FieldList>
            <div className={styles.total}>
              <span>{t("period.total")}</span>
              <span className={shared.spacer} />
              <span className={cx(styles.totalValue, !ready && skeletonClass())}>{tonLabel(fee)}</span>
            </div>
            <SheetField
              ghost={!ready}
              label={t("files.topupNewUntil")}
              value={!ready ? date(now) : nextPaidDays === null ? EMPTY : date(now + nextPaidDays * DAY)}
            />
          </FieldList>
        </Card>
      )}

      <SheetFooter>
        <Button variant="primary" size="xl" disabled={busy || checking || !ready} onClick={() => onSubmit(selected, span, fileSize, fee)}>
          {t(added.length > 0 ? "fix.replace" : "fix.remove")}
        </Button>
      </SheetFooter>
    </div>
  )
}
