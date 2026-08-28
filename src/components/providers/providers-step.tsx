import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ListChecks, Loader, Minus, Plus, Server, SlidersHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"
import { fetchProviderByKey } from "@/lib/api"
import { cx } from "@/lib/cx"
import { nearBottom } from "@/lib/dom"
import { DEFAULT_PROOF_DAYS, MAX_SELECTED, type ProviderFate } from "@/lib/pricing"
import {
  NO_FILTERS,
  countSpanMismatched,
  eligibleFor,
  hasFilters,
  matches,
  pickBest,
  pinnedOf,
  priceCeiling,
  pubkeyFrom,
  ratingCeiling,
  sortProviders,
  type ProviderFilters,
  type SortDirection,
  type SortField,
} from "@/lib/providers"
import type { ProviderDecline } from "@/types/bag"
import type { Provider } from "@/types/provider"
import { CatalogToolbar, daysLabel } from "./catalog-toolbar"
import { Notice } from "../notice"
import { ProviderHeader, ProviderRow, ProviderSkeleton } from "./provider-row"
import { SelectedTable } from "./selected-table"
import { SheetField } from "../sheet-fields"
import { SheetFooter } from "../sheet"
import { RECIPES, STRATEGIES, StrategyCards, type Strategy } from "./strategy-cards"
import shared from "../shared.module.css"
import styles from "./providers-step.module.css"

const SKELETON_ROWS = 7
const RARE_PROOF_DAYS = 90
const STAGGER = 10
const PAGE = 100
const NEXT_PAGE_AHEAD = 200
const WINDOW_ROWS = 5

const orderPinned = (list: Provider[], strategy: Strategy | null): Provider[] => {
  if (!strategy) return list
  const recipe = RECIPES[strategy]
  if (recipe.criterion === "price") return sortProviders(list, "price", "asc")
  if (recipe.diversity === "differentCountries") return sortProviders(list, "location", "asc")
  return sortProviders(list, "rating", "desc")
}

interface ProvidersStepProps {
  providers: Provider[]
  loading: boolean
  failed: boolean
  status: number | null
  onRetry: () => void
  selected: string[]
  proofDays: number
  bagSize?: number
  autoPick?: boolean
  editor?: boolean
  total?: string
  until?: string
  checking: boolean
  declines: ProviderDecline[]
  copied: string | null
  proofValueLabel?: string
  error?: string | null
  submitLabel?: string
  submitDisabled?: boolean
  submitReason?: string
  revertDisabled?: boolean
  fates?: Map<string, ProviderFate>
  warning?: string
  warnOf?: (pubkey: string) => { short: string; full: string } | undefined
  onSelected: (next: string[]) => void
  onAddManual: (provider: Provider) => void
  onProofDays: (days: number) => void
  onCopy: (value: string) => void
  onOpen: (pubkey: string) => void
  onRevert?: () => void
  onBack?: () => void
  onContinue: () => void
}

export const ProvidersStep = ({
  providers,
  loading,
  failed,
  status,
  onRetry,
  selected,
  proofDays,
  bagSize = 0,
  editor,
  total,
  until,
  autoPick = false,
  checking,
  declines,
  copied,
  proofValueLabel,
  error = null,
  submitLabel,
  submitDisabled = false,
  submitReason,
  revertDisabled = false,
  fates,
  warning,
  warnOf,
  onSelected,
  onAddManual,
  onProofDays,
  onCopy,
  onOpen,
  onRevert,
  onBack,
  onContinue,
}: ProvidersStepProps) => {
  const { t } = useTranslation()

  const [query, setQuery] = useState("")
  const queryKey = pubkeyFrom(query)
  const [filters, setFilters] = useState<ProviderFilters>(NO_FILTERS)
  const [sortField, setSortField] = useState<SortField>("rating")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [pickCount, setPickCount] = useState(3)
  const [shownLimit, setShownLimit] = useState(PAGE)
  const [strategy, setStrategy] = useState<Strategy>("reliable")
  const [seed, setSeed] = useState(0)

  const priceMax = useMemo(() => priceCeiling(providers), [providers])
  const ratingMax = useMemo(() => ratingCeiling(providers), [providers])

  const pool = useMemo(
    () => sortProviders(providers.filter((provider) => matches(provider, filters, proofDays, "", bagSize)), sortField, sortDirection),
    [providers, filters, proofDays, bagSize, sortField, sortDirection],
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return pool
    const found = pool.filter((provider) => matches(provider, filters, proofDays, query, bagSize))
    if (found.length > 0) return found
    const hit = queryKey ? providers.find((provider) => provider.pubkey.toLowerCase() === queryKey) : undefined
    return hit ? [hit] : found
  }, [pool, providers, filters, proofDays, query, queryKey, bagSize])

  const spanMismatchedCount = useMemo(
    () => countSpanMismatched(providers, filters, proofDays, bagSize),
    [providers, filters, proofDays, bagSize],
  )

  const emptyCatalog = !loading && !failed && providers.length === 0
  const hasPanel = !failed && !emptyCatalog
  const pickLimit = Math.max(1, Math.min(MAX_SELECTED, eligibleFor(providers).length))
  const poolLimit = Math.min(pickLimit, eligibleFor(pool).length)
  const count = Math.min(selected.length || pickCount, pickLimit)

  const lookupKey = !loading && !failed && filtered.length === 0 ? queryKey : null
  const [lookup, setLookup] = useState<{ key: string; failed: boolean } | null>(null)
  const [lookupTry, setLookupTry] = useState(0)

  useEffect(() => {
    if (!lookupKey) {
      setLookup(null)
      return
    }
    setLookup(null)
    const controller = new AbortController()
    fetchProviderByKey(lookupKey, controller.signal)
      .then((provider) => {
        if (controller.signal.aborted) return
        if (provider) onAddManual(provider)
        else setLookup({ key: lookupKey, failed: false })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setLookup({ key: lookupKey, failed: true })
      })
    return () => controller.abort()
  }, [lookupKey, lookupTry, onAddManual])

  const lookupState =
    lookupKey === null ? null : lookup?.key === lookupKey ? (lookup.failed ? "failed" : "missing") : "checking"
  const lookupSelected = lookupKey !== null && selected.some((key) => key.toLowerCase() === lookupKey)
  const addLookupKey = () => {
    if (lookupKey) onSelected([...selected, lookupKey])
  }

  const picks = useMemo(
    () =>
      Object.fromEntries(
        STRATEGIES.map((option) => [
          option,
          pickBest(pool, {
            count: pickCount,
            diversity: RECIPES[option].diversity,
            criterion: RECIPES[option].criterion,
            priceMax,
            ratingMax,
            seed: option === strategy ? seed : 0,
          }),
        ]),
      ) as Record<Strategy, string[]>,
    [pool, pickCount, priceMax, ratingMax, strategy, seed],
  )

  const matchesSelection = (option: Strategy) =>
    selected.length > 0 && picks[option].length === selected.length && picks[option].every((key) => selected.includes(key))

  const active = matchesSelection(strategy) ? strategy : (STRATEGIES.find(matchesSelection) ?? null)

  const panelRef = useRef<HTMLDetailsElement>(null)

  const applyStrategy = (next: Strategy, count: number, nextSeed = 0) => {
    setStrategy(next)
    setPickCount(count)
    setSeed(nextSeed)
    if (pool.length === 0) return
    const recipe = RECIPES[next]
    onSelected(
      pickBest(pool, {
        count,
        diversity: recipe.diversity,
        priceMax,
        ratingMax,
        criterion: recipe.criterion,
        seed: nextSeed,
      }),
    )
  }

  const pickStrategy = (next: Strategy) => {
    if (panelRef.current) panelRef.current.open = false
    applyStrategy(next, count, active === next ? seed + 1 : 0)
  }

  const prefilled = useRef(!autoPick)
  useEffect(() => {
    if (prefilled.current || loading || providers.length === 0) return
    prefilled.current = true
    if (selected.length > 0) return
    const recipe = RECIPES.reliable
    onSelected(
      pickBest(pool, { count: pickCount, diversity: recipe.diversity, priceMax, ratingMax, criterion: recipe.criterion }),
    )
  }, [loading, providers.length, selected.length, pool, pickCount, priceMax, ratingMax, onSelected])

  const pinned = useMemo(() => {
    const known = new Map(providers.map((provider) => [provider.pubkey, provider]))
    const listed = selected.map((key) => known.get(key)).filter((provider) => provider != null)
    const rows = pinnedOf(orderPinned(listed, active), selected)
    const removed = fates
      ? [...fates.entries()]
          .filter(([, fate]) => fate === "removed")
          .map(([pubkey]) => ({ pubkey, provider: known.get(pubkey) ?? null }))
      : []
    return [...rows, ...removed]
  }, [providers, selected, active, fates])
  const page = filtered.slice(0, shownLimit)

  const [viewedKey, setViewedKey] = useState<string | null>(null)
  const openRow = (pubkey: string) => {
    setViewedKey(pubkey)
    onOpen(pubkey)
  }

  const seenRows = useRef(new Set<string>())
  useEffect(() => {
    for (const provider of page) seenRows.current.add(provider.pubkey)
  }, [page])

  useEffect(() => {
    setShownLimit(PAGE)
  }, [filters, query, sortField, sortDirection, proofDays])

  const atBottom = useRef(false)
  const catalogRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const [catalogWindow, setCatalogWindow] = useState<string>()

  const showMore = useCallback(
    () => setShownLimit((current) => Math.min(current + PAGE, filtered.length)),
    [filtered.length],
  )

  useEffect(() => {
    const head = catalogRef.current?.firstElementChild
    const row = rowsRef.current?.firstElementChild
    if (!head || !row) return
    setCatalogWindow(`${head.getBoundingClientRect().height + row.getBoundingClientRect().height * WINDOW_ROWS}px`)
  }, [page.length])

  useEffect(() => {
    const onScroll = () => {
      const box = catalogRef.current
      if (box && box.scrollHeight > box.clientHeight) return
      const reached = nearBottom(document.documentElement, NEXT_PAGE_AHEAD)
      if (reached && !atBottom.current) showMore()
      atBottom.current = reached
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [showMore])

  const toggle = (pubkey: string) => {
    if (selected.includes(pubkey)) {
      onSelected(selected.filter((key) => key !== pubkey))
      return
    }
    if (selected.length >= MAX_SELECTED) return
    onSelected([...selected, pubkey])
  }

  const sort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
      return
    }
    setSortField(field)
    setSortDirection(field === "pubkey" || field === "location" ? "asc" : "desc")
  }

  const declineByKey = useMemo(() => {
    const map = new Map<string, string>()
    declines.forEach((decline) => map.set(decline.provider_key.toLowerCase(), decline.reason))
    return map
  }, [declines])

  const withoutDeclined = useMemo(() => selected.filter((key) => !declineByKey.has(key.toLowerCase())), [selected, declineByKey])

  const rareProof = proofDays > RARE_PROOF_DAYS ? t("filters.proofRare", { days: RARE_PROOF_DAYS }) : null

  const catalogSkeleton = (
    <div className={styles.scrollX}>
      <ProviderHeader />
      <div className={styles.scroll}>
        <div className={styles.rows}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <ProviderSkeleton key={index} index={index} />
          ))}
        </div>
      </div>
    </div>
  )

  const catalogBox = (
    <div
      ref={catalogRef}
      style={{ "--catalog-window": catalogWindow } as CSSProperties}
      onScroll={(event) => {
        const box = event.currentTarget
        if (box.scrollHeight > box.clientHeight && nearBottom(box, NEXT_PAGE_AHEAD)) showMore()
      }}
      className={styles.catalog}
    >
      <ProviderHeader field={sortField} direction={sortDirection} onSort={sort} />
      <div className={styles.scroll}>
        <div ref={rowsRef} className={styles.rows}>
          {page.map((provider, index) => (
            <ProviderRow
              key={provider.pubkey}
              provider={provider}
              index={index % STAGGER}
              fresh={!seenRows.current.has(provider.pubkey)}
              viewed={provider.pubkey === viewedKey}
              selected={selected.includes(provider.pubkey)}
              full={selected.length >= MAX_SELECTED}
              proofDays={proofDays}
              copied={copied === provider.pubkey}
              onToggle={toggle}
              onOpen={openRow}
              onCopy={onCopy}
            />
          ))}
        </div>
      </div>
    </div>
  )

  const shownLine = (
    <span role="status" className={styles.showing}>
      {t("ui.showing", { shown: page.length, total: filtered.length })}
    </span>
  )

  const panelBody = (bare: boolean) => {
    const boxed = (content: ReactNode) => (bare ? <div className={shared.tablePanel}>{content}</div> : content)

    return (
      <div className={bare ? styles.bare : styles.panel}>
        <CatalogToolbar
          bare={bare}
          providers={providers}
          bagSize={bagSize}
          filters={filters}
          onFilters={setFilters}
          query={query}
          onQuery={setQuery}
          proofDays={proofDays}
          onProofDays={onProofDays}
          proofValueLabel={proofValueLabel}
        />

        {spanMismatchedCount > 0 && (
          <span role="status" className={cx(styles.quietNote, !bare && styles.panelNote)}>
            {t("catalog.spanHidden", { count: spanMismatchedCount, days: daysLabel(t, proofDays) })}
          </span>
        )}

        {loading && boxed(catalogSkeleton)}

        {!loading &&
          filtered.length > 0 &&
          boxed(
            <>
              {catalogBox}
              {shownLine}
            </>,
          )}
      </div>
    )
  }

  const catalogPart = (
    <>
      <div className={styles.headRow} data-second={editor ? "" : undefined}>
        <h2 className={shared.tableTitle}>
          <Server className={shared.titleIcon} aria-hidden="true" />
          <span>{t("catalog.stepTitle")}</span>
        </h2>
        <span className={shared.spacer} />

        {autoPick && (
          <div className={styles.count}>
            <span className={styles.countLabel}>{t("catalog.count")}</span>
            <div role="group" aria-label={t("catalog.count")} className={cx(styles.stepper, !active && styles.stepperOff)}>
              <button
                type="button"
                disabled={!active || count <= 1}
                aria-label={t("catalog.fewer")}
                onClick={() => applyStrategy(strategy, Math.max(1, count - 1))}
                className={styles.stepperButton}
              >
                <Minus aria-hidden="true" className={styles.smIcon} />
              </button>
              <span className={styles.stepperValue}>{count}</span>
              <button
                type="button"
                disabled={!active || count >= poolLimit}
                aria-label={t("catalog.more")}
                onClick={() => applyStrategy(strategy, Math.min(poolLimit, count + 1))}
                className={styles.stepperButton}
              >
                <Plus aria-hidden="true" className={styles.smIcon} />
              </button>
            </div>
          </div>
        )}
      </div>

      {rareProof && (
        <Notice tone="yellow" className={styles.stepAlert}>
          {rareProof}
        </Notice>
      )}

      {autoPick && (
        <div className={styles.cards}>
          <StrategyCards strategy={active} onPick={pickStrategy} />

          {hasPanel && (
            <details ref={panelRef} className={styles.reveal}>
              <summary className={styles.revealSummary}>
                <span className={styles.cardIcon}>
                  <SlidersHorizontal className={styles.cardGlyph} aria-hidden="true" />
                </span>
                <span className={styles.cardTitle}>{t("catalog.panel")}</span>
                <span className={styles.cardNote}>{t("catalog.panelNote")}</span>
              </summary>
              {panelBody(false)}
            </details>
          )}
        </div>
      )}

      {!autoPick && hasPanel && panelBody(true)}

      {!loading && !failed && filtered.length === 0 && lookupState === null && (
        <div role="status" className={shared.emptyState}>
          <p>{t("catalog.notFound")}</p>
          {(hasFilters(filters) || query || proofDays !== DEFAULT_PROOF_DAYS) && (
            <button
              type="button"
              onClick={() => {
                setFilters(NO_FILTERS)
                setQuery("")
                if (proofDays !== DEFAULT_PROOF_DAYS) onProofDays(DEFAULT_PROOF_DAYS)
              }}
              className={cx(shared.textDanger, styles.emptyReset)}
            >
              {t("ui.reset")}
            </button>
          )}
        </div>
      )}

      {lookupState === "checking" && (
        <div role="status" className={shared.emptyState}>
          <span className={styles.lookupBusy}>
            <Loader strokeWidth={2.5} aria-hidden="true" className={styles.spinner} />
            <span>{t("catalog.keyChecking")}</span>
          </span>
        </div>
      )}

      {lookupState === "missing" && (
        <Notice
          tone="yellow"
          className={styles.stepAlert}
          action={
            lookupSelected ? (
              <span>{t("catalog.keyAlreadySelected")}</span>
            ) : (
              <button
                type="button"
                disabled={selected.length >= MAX_SELECTED}
                title={
                  selected.length >= MAX_SELECTED
                    ? t("catalog.limitShort", { max: MAX_SELECTED })
                    : t("catalog.offCatalogFull")
                }
                onClick={addLookupKey}
              >
                {t("catalog.addOffCatalog")}
              </button>
            )
          }
        >
          {t("catalog.notInCatalog")}
        </Notice>
      )}

      {lookupState === "failed" && (
        <Notice
          tone="red"
          className={styles.stepAlert}
          action={
            <button type="button" onClick={() => setLookupTry((attempt) => attempt + 1)}>
              {t("ui.retry")}
            </button>
          }
        >
          {t("catalog.keyLookupFailed")}
        </Notice>
      )}

      {failed && (
        <div role="alert" className={shared.emptyState}>
          <p>{t("errors.failedToLoadProviders")}</p>
          {status !== null && <p className={shared.errorCode}>{t("errors.statusCode", { status })}</p>}
          <button type="button" onClick={onRetry} className={cx(shared.textAction, styles.emptyReset)}>
            {t("ui.retry")}
          </button>
        </div>
      )}
    </>
  )

  const selectedPart = (
    <>
      <div className={styles.sectionHead} data-first={editor ? "" : undefined}>
        <h2 className={shared.tableTitle}>
          <ListChecks className={shared.titleIcon} aria-hidden="true" />
          <span>{t("catalog.selectedTitle")}</span>
        </h2>
        <span className={styles.sectionCount}>{`${selected.length} / ${MAX_SELECTED}`}</span>
        <span className={shared.spacer} />
        {onRevert && (
          <button
            type="button"
            onClick={onRevert}
            disabled={revertDisabled}
            className={cx(shared.textDanger, styles.clearAll)}
          >
            {t("providers.revert")}
          </button>
        )}
        <button
          type="button"
          onClick={() => onSelected([])}
          className={cx(shared.textDanger, styles.clearAll, selected.length === 0 && shared.invisible)}
        >
          {t("catalog.clearAll")}
        </button>
      </div>

      {pinned.length > 0 ? (
        <SelectedTable
          pinned={pinned}
          proofDays={proofDays}
          catalogReady={!loading && !failed}
          declineByKey={declineByKey}
          fates={fates}
          copied={copied}
          warnOf={warnOf}
          onCopy={onCopy}
          onOpen={openRow}
          onRemove={toggle}
        />
      ) : (
        <p className={shared.emptyState}>{t("catalog.noneSelected")}</p>
      )}

      {declines.length > 0 && (
        <Notice
          tone="red"
          className={styles.stepError}
          action={
            <button type="button" onClick={() => onSelected(withoutDeclined)}>
              {t("catalog.removeDeclined")}
            </button>
          }
        >
          {t("catalog.declinedSummary", { count: declines.length, total: selected.length })}
        </Notice>
      )}
    </>
  )

  return (
    <div className={styles.step}>
      {editor ? selectedPart : catalogPart}
      {editor ? catalogPart : selectedPart}

      {warning && (
        <Notice tone="yellow" className={styles.stepError}>
          {warning}
        </Notice>
      )}

      {total && (
        <div className={styles.summary}>
          <div className={styles.total}>
            <span>{t("period.total")}</span>
            <span className={shared.spacer} />
            <span className={styles.totalValue}>{total}</span>
          </div>
          {until && <SheetField label={t("files.topupNewUntil")} value={until} />}
        </div>
      )}

      <SheetFooter className={styles.footer}>
        {onBack && (
          <button type="button" onClick={onBack} className={shared.secondary}>
            {t("ui.back")}
          </button>
        )}
        <span className={shared.spacer} />
        <button
          type="button"
          onClick={onContinue}
          disabled={selected.length === 0 || checking || submitDisabled}
          title={submitDisabled ? submitReason : selected.length === 0 ? t("catalog.noneSelected") : undefined}
          className={shared.primary}
        >
          {checking && <Loader strokeWidth={2.5} aria-hidden="true" className={styles.spinner} />}
          <span>{submitLabel ?? t("ui.continue")}</span>
        </button>
      </SheetFooter>

      {error && (
        <Notice tone="red" className={styles.stepError}>
          {t(error)}
        </Notice>
      )}
    </div>
  )
}
