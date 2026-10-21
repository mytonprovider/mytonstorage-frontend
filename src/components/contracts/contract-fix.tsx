import { useEffect, useState } from "react"
import { SquareCheck } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useQuote } from "@/lib/api"
import { silentProviders, type ContractRow } from "@/lib/contracts"
import { useContractData } from "@/lib/contracts-cache"
import { cx } from "@/lib/cx"
import { formatDate, nowSeconds, SECONDS_IN_DAY, tonLabel } from "@/lib/format"
import { commonSpan, FEE_GAS, nextPaidDaysLeft, offerRates, providerFate, quotedBounties, recreateTotal, unquotedBounties, updateFee } from "@/lib/pricing"
import { declineKeyOf, freshSeed, pickReplacements, spanAllows } from "@/lib/providers"
import type { ProviderOffer } from "@/types/bag"
import type { Provider } from "@/types/provider"
import { daysLabel } from "../providers/catalog-toolbar"
import { SelectedTable } from "../providers/selected-table"
import { Notice } from "../notice"
import { SheetFooter } from "../sheet"
import { SheetField } from "../sheet-fields"
import shared from "../shared.module.css"
import styles from "./contract-fix.module.css"

const MAX_ROUNDS = 2

interface ContractFixProps {
  contract: ContractRow
  providers: Provider[]
  catalogLoading: boolean
  catalogFailed: boolean
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
  const { checking, invalidate, request } = useQuote()
  const { state: latest } = useContractData(contract.address)

  const now = nowSeconds()
  const state = latest ?? contract.state
  const silent = state ? silentProviders({ ...contract, state }, now) : []
  const span = state ? commonSpan(state.providers) : 0
  const fileSize = state?.fileSize ?? 0
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
  const added = state ? pickReplacements(providers, { ...wanted, proofDays: span / SECONDS_IN_DAY }) : []
  const spanLimited = added.length < wanted.count && pickReplacements(providers, { ...wanted, proofDays: null }).length > added.length
  const bagId = contract.bagId || state?.torrentHash || ""
  const picking = catalogLoading || catalogFailed
  const keptKey = kept.join(",")
  const addedKey = added.join(",")
  const gone = !state || silent.length === 0 || silent.length === state.providers.length

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
            setKeptDeclines((known) => ({ ...known, ...Object.fromEntries(keptRefused.map(({ provider_key, reason }) => [provider_key.toLowerCase(), reason])) }))
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
  const reason = !picking && spanLimited ? ` ${t("fix.spanRare", { days: daysLabel(t, span / SECONDS_IN_DAY) })}` : ""

  const whyOf = (pubkey: string): string => {
    const decline = keptDeclines[pubkey.toLowerCase()]
    if (decline !== undefined) return t(declineKeyOf(decline) ?? "catalog.noOffer")
    const { lastProofTime } = state.providers.find((provider) => provider.pubkey === pubkey) ?? { lastProofTime: 0 }
    if (lastProofTime) return t("fix.why.silent")
    const listed = providers.find((provider) => provider.pubkey.toLowerCase() === pubkey.toLowerCase())
    return listed && !spanAllows(listed, span / SECONDS_IN_DAY)
      ? t("catalog.spanShort", { days: daysLabel(t, span / SECONDS_IN_DAY) })
      : t("fix.why.neverTook")
  }

  const pickAgain = () => {
    setSeed(freshSeed())
    setRounds(0)
    setDropped(0)
  }

  const askAgain = () => {
    setKeptDeclines({})
    setAttempt((count) => count + 1)
  }

  return (
    <div className={styles.body}>
      <Notice tone="yellow">{lead + reason}</Notice>

      <div>
        <div className={styles.head} data-sheet="">
          <h2 className={shared.sheetTitle}>
            <SquareCheck className={shared.titleIcon} aria-hidden="true" />
            <span>{t("fix.newTitle")}</span>
          </h2>
          {!picking && <span className={styles.count}>{`${added.length} / ${outgoing.length}`}</span>}
          <div className={styles.headActions}>
            <button type="button" onClick={pickAgain} className={shared.textAction}>
              {t("catalog.pickAgain")}
            </button>
            <span className={shared.spacer} />
            <button type="button" onClick={onManual} className={shared.textAction}>
              {t("fix.manual")}
            </button>
          </div>
        </div>

        <SelectedTable
          pinned={[...silent, ...unanswered, ...added].map((pubkey) => ({
            pubkey,
            provider: providers.find((provider) => provider.pubkey.toLowerCase() === pubkey.toLowerCase()) ?? null,
          }))}
          proofDays={span / SECONDS_IN_DAY}
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
        <Notice
          tone="red"
          action={
            <button type="button" onClick={onRetryCatalog}>
              {t("ui.retry")}
            </button>
          }
        >
          {t("errors.failedToLoadProviders")}
        </Notice>
      )}
      {stuck && (
        <Notice
          tone="red"
          action={
            <button type="button" onClick={askAgain}>
              {t("ui.retry")}
            </button>
          }
        >
          {t("fix.unanswered", { count: unanswered.length })}
        </Notice>
      )}
      {quoteError && <Notice tone="red">{t(quoteError)}</Notice>}
      {ready && recreated.size > 0 && (
        <Notice tone="yellow">{t("providers.recreateSummary", { count: recreated.size, amount: tonLabel(recreateTotal(fileSize, span, recreated, rates)) })}</Notice>
      )}

      {!stuck && !quoteError && !catalogFailed && (
        <div className={styles.panel}>
          <div className={styles.fields}>
            <div className={styles.total}>
              <span>{t("period.total")}</span>
              <span className={shared.spacer} />
              <span className={cx(styles.totalValue, !ready && shared.shape)}>{tonLabel(fee)}</span>
            </div>
            <SheetField
              ghost={!ready}
              label={t("files.topupNewUntil")}
              value={!ready ? date(now) : nextPaidDays === null ? "" : date(now + nextPaidDays * SECONDS_IN_DAY)}
            />
          </div>
        </div>
      )}

      <SheetFooter className={shared.sheetActions}>
        <button type="button" disabled={busy || checking || !ready} onClick={() => onSubmit(selected, span, fileSize, fee)} className={shared.primary}>
          {t(added.length > 0 ? "fix.replace" : "fix.remove")}
        </button>
      </SheetFooter>
    </div>
  )
}
