import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from "react"
import { Loader, Minus, Plus, Server, SlidersHorizontal, SquareCheck } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button, Card, cx, DataTable, DataTableRows, EmptyState, Hint, LoadError, Notice, SectionTitle } from "@myton/ui"
import {
  type Provider,
  pubkeyFrom,
  rankByRating,
  sortProviders,
  type SortDirection,
  type SortField,
} from "@myton/ui/domain"
import { fetchProviderByKey } from "@/lib/api"
import type { CheckWarn } from "@/lib/check-label"
import { nearBottom } from "@/lib/dom"
import { DEFAULT_PICK_COUNT, DEFAULT_PROOF_DAYS, MAX_SELECTED, type ProviderFate } from "@/lib/pricing"
import {
  NO_FILTERS,
  autopickPool,
  countSpanMismatched,
  eligibleFor,
  freshSeed,
  hasFilters,
  hostingPool,
  matchesQuery,
  pickBest,
  pinnedOf,
  priceCeiling,
  ratingCeiling,
  type ProviderFilters,
} from "@/lib/providers"
import type { ProviderDecline } from "@/types/bag"
import { CatalogToolbar, ProofPeriodRow, daysLabel } from "./catalog-toolbar"
import { ProviderHeader, ProviderRow, ProviderSkeleton, tableColumns } from "./provider-row"
import { SelectedTable } from "./selected-table"
import { StepFooter } from "./step-footer"
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

const poolOf = (
  list: Provider[],
  filters: ProviderFilters,
  proofDays: number,
  bagSize: number,
  sortField: SortField,
  sortDirection: SortDirection,
): Provider[] => sortProviders(hostingPool(list, proofDays, bagSize, filters), sortField, sortDirection)

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
  warnOf?: (pubkey: string) => CheckWarn | undefined
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
  const [pickCount, setPickCount] = useState(DEFAULT_PICK_COUNT)
  const [shownLimit, setShownLimit] = useState(PAGE)
  const [strategy, setStrategy] = useState<Strategy>("reliable")
  const [seed, setSeed] = useState(0)

  const priceMax = useMemo(() => priceCeiling(providers), [providers])
  const ratingMax = useMemo(() => ratingCeiling(providers), [providers])

  const pool = useMemo(
    () => poolOf(providers, filters, proofDays, bagSize, sortField, sortDirection),
    [providers, filters, proofDays, bagSize, sortField, sortDirection],
  )
  // The place among those that can take this bag under the chosen filters; search does not renumber
  const ranks = useMemo(() => rankByRating(pool), [pool])

  // The search reaches past the countries, price and rating, not past what can take the bag
  const filtered = useMemo(() => {
    if (!query.trim()) return pool
    const found = poolOf(providers, NO_FILTERS, proofDays, bagSize, sortField, sortDirection).filter((provider) =>
      matchesQuery(provider, query),
    )
    if (found.length > 0) return found
    const hit = queryKey ? providers.find((provider) => provider.pubkey.toLowerCase() === queryKey) : undefined
    return hit ? [hit] : found
  }, [pool, providers, proofDays, query, queryKey, bagSize, sortField, sortDirection])

  const spanMismatchedCount = useMemo(
    () => countSpanMismatched(providers, filters, proofDays, bagSize),
    [providers, filters, proofDays, bagSize],
  )

  const emptyCatalog = !loading && !failed && providers.length === 0
  const hasPanel = !failed && !emptyCatalog
  const pickLimit = Math.max(1, Math.min(MAX_SELECTED, eligibleFor(providers).length))
  const poolLimit = Math.min(pickLimit, autopickPool(pool).length)
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

  const [pickedFrom, setPickedFrom] = useState<Provider[] | null>(null)

  const picks = useMemo(() => {
    const base = pickedFrom ?? providers
    const basePool = poolOf(base, filters, proofDays, bagSize, sortField, sortDirection)
    return Object.fromEntries(
      STRATEGIES.map((option) => [
        option,
        pickBest(basePool, {
          count: pickCount,
          ...RECIPES[option],
          priceMax: priceCeiling(base),
          ratingMax: ratingCeiling(base),
          seed: option === strategy ? seed : 0,
        }),
      ]),
    ) as Record<Strategy, string[]>
  }, [pickedFrom, providers, filters, proofDays, bagSize, sortField, sortDirection, pickCount, strategy, seed])

  const matchesSelection = (option: Strategy) =>
    selected.length > 0 && picks[option].length === selected.length && picks[option].every((key) => selected.includes(key))

  const active = matchesSelection(strategy) ? strategy : (STRATEGIES.find(matchesSelection) ?? null)

  const panelRef = useRef<HTMLDetailsElement>(null)

  const applyStrategy = (next: Strategy, count: number, nextSeed = 0) => {
    setStrategy(next)
    setPickCount(count)
    setSeed(nextSeed)
    if (pool.length === 0) return
    setPickedFrom(providers)
    const recipe = RECIPES[next]
    onSelected(pickBest(pool, { count, ...recipe, priceMax, ratingMax, seed: nextSeed }))
  }

  const pickStrategy = (next: Strategy) => {
    if (panelRef.current) panelRef.current.open = false
    if (active !== next) applyStrategy(next, count, freshSeed())
  }

  const prefilled = useRef(!autoPick)
  useEffect(() => {
    if (prefilled.current || loading || providers.length === 0) return
    prefilled.current = true
    if (selected.length > 0) return
    const firstSeed = freshSeed()
    setStrategy("reliable")
    setSeed(firstSeed)
    setPickedFrom(providers)
    onSelected(pickBest(pool, { count: pickCount, ...RECIPES.reliable, priceMax, ratingMax, seed: firstSeed }))
  }, [loading, providers, selected.length, pool, pickCount, priceMax, ratingMax, onSelected])

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
  const [catalogHead, setCatalogHead] = useState<string>()

  const showMore = useCallback(
    () => setShownLimit((current) => Math.min(current + PAGE, filtered.length)),
    [filtered.length],
  )

  useEffect(() => {
    const head = catalogRef.current?.firstElementChild
    const row = rowsRef.current?.firstElementChild
    if (!head || !row) return

    const measure = () => {
      const rows = row.getBoundingClientRect().height * WINDOW_ROWS
      if (rows <= 0) return
      setCatalogWindow(`${rows}px`)
      setCatalogHead(`${head.getBoundingClientRect().height}px`)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(head)
    observer.observe(row)

    return () => observer.disconnect()
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
    <DataTable columns={tableColumns(true)}>
      <ProviderHeader />
      <DataTableRows>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <ProviderSkeleton key={index} index={index} />
        ))}
      </DataTableRows>
    </DataTable>
  )

  const onCatalogScroll = (event: UIEvent<HTMLDivElement>) => {
    const box = event.currentTarget
    if (box.scrollHeight > box.clientHeight && nearBottom(box, NEXT_PAGE_AHEAD)) showMore()
  }

  const catalogBox = (
    <DataTable
      columns={tableColumns(true)}
      gridRef={catalogRef}
      style={{ "--catalog-window": catalogWindow, "--catalog-head": catalogHead } as CSSProperties}
      onScroll={onCatalogScroll}
      className={styles.catalog}
    >
      <ProviderHeader field={sortField} direction={sortDirection} onSort={sort} />
      <DataTableRows ref={rowsRef}>
        {page.map((provider, index) => (
          <ProviderRow
            key={provider.pubkey}
            provider={provider}
            rank={ranks[provider.pubkey]}
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
      </DataTableRows>
    </DataTable>
  )

  const shownLine = (
    <span role="status" className={styles.showing}>
      {t("ui:ui.showing", { shown: page.length, total: filtered.length })}
    </span>
  )

  const panelBody = (bare: boolean) => {
    const boxed = (content: ReactNode) => (bare ? <Card striped>{content}</Card> : content)

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
        />

        {spanMismatchedCount > 0 && (
          <Notice tone="yellow" className={cx(!bare && styles.panelNote)}>
            {t("catalog.spanHidden", { count: spanMismatchedCount, days: daysLabel(t, proofDays) })}
          </Notice>
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

  const periodPart = (
    <>
      {hasPanel && (
        <ProofPeriodRow
          sheet={editor}
          proofDays={proofDays}
          onProofDays={onProofDays}
          proofValueLabel={proofValueLabel}
        />
      )}

      {rareProof && (
        <Notice tone="yellow" className={styles.stepAlert}>
          {rareProof}
        </Notice>
      )}
    </>
  )

  const catalogPart = (
    <>
      <div className={styles.headRow} data-sheet={editor ? "" : undefined}>
        <SectionTitle size={editor ? "md" : "lg"} icon={Server}>
          <span>{t(editor ? "catalog.panel" : "catalog.stepTitle")}</span>
        </SectionTitle>
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

      {!editor && periodPart}

      {autoPick && (
        <div className={styles.cards}>
          <StrategyCards strategy={active} onPick={pickStrategy} />

          {hasPanel && (
            <details ref={panelRef} className={styles.reveal}>
              <summary className={styles.revealSummary}>
                <span className={shared.pickCardHint}>
                  <Hint text={t("catalog.panelHint")} />
                </span>
                <span className={shared.pickCardIcon}>
                  <SlidersHorizontal className={shared.pickCardGlyph} aria-hidden="true" />
                </span>
                <span className={shared.pickCardTitle}>{t("catalog.panel")}</span>
                <span className={shared.pickCardNote}>{t("catalog.panelNote")}</span>
              </summary>
              {panelBody(false)}
            </details>
          )}
        </div>
      )}

      {!autoPick && hasPanel && panelBody(true)}

      {!loading && !failed && filtered.length === 0 && lookupState === null && (
        <EmptyState
          role="status"
          title={t("catalog.notFound")}
          action={
            (hasFilters(filters) || query || proofDays !== DEFAULT_PROOF_DAYS) && (
              <Button
                variant="text"
                tone="red"
                onClick={() => {
                  setFilters(NO_FILTERS)
                  setQuery("")
                  if (proofDays !== DEFAULT_PROOF_DAYS) onProofDays(DEFAULT_PROOF_DAYS)
                }}
              >
                {t("ui:ui.reset")}
              </Button>
            )
          }
        />
      )}

      {lookupState === "checking" && (
        <EmptyState
          role="status"
          title={
            <span className={styles.lookupBusy}>
              <Loader strokeWidth={2.5} aria-hidden="true" className={styles.spinner} />
              <span>{t("catalog.keyChecking")}</span>
            </span>
          }
        />
      )}

      {lookupState === "missing" && (
        <Notice
          tone="yellow"
          className={styles.stepAlert}
          action={
            lookupSelected ? (
              <span>{t("catalog.keyAlreadySelected")}</span>
            ) : (
              <Button
                size="sm"
                disabled={selected.length >= MAX_SELECTED}
                title={
                  selected.length >= MAX_SELECTED
                    ? t("catalog.limitShort", { max: MAX_SELECTED })
                    : t("catalog.offCatalogFull")
                }
                onClick={addLookupKey}
              >
                {t("catalog.addOffCatalog")}
              </Button>
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
            <Button size="sm" onClick={() => setLookupTry((attempt) => attempt + 1)}>
              {t("ui:ui.retry")}
            </Button>
          }
        >
          {t("catalog.keyLookupFailed")}
        </Notice>
      )}

      {failed && (
        <LoadError message={t("errors.failedToLoadProviders")} status={status} onRetry={onRetry} />
      )}
    </>
  )

  const declinesNotice = declines.length > 0 && (
    <Notice
      tone="red"
      className={styles.stepError}
      action={
        <Button size="sm" onClick={() => onSelected(withoutDeclined)}>
          {t("catalog.removeDeclined")}
        </Button>
      }
    >
      {t("catalog.declinedSummary", { count: declines.length, total: selected.length })}
    </Notice>
  )

  const selectedPart = (
    <>
      <div className={styles.sectionHead} data-sheet={editor ? "" : undefined}>
        <SectionTitle size={editor ? "md" : "lg"} icon={SquareCheck}>
          <span>{t("catalog.selectedTitle")}</span>
        </SectionTitle>
        <span className={styles.sectionCount}>{`${selected.length} / ${MAX_SELECTED}`}</span>
        <div className={styles.headActions}>
          {autoPick && active && (
            <Button variant="text" onClick={() => applyStrategy(active, count, freshSeed())}>
              {t("catalog.pickAgain")}
            </Button>
          )}
          <span className={shared.spacer} />
          {onRevert && (
            <Button variant="text" tone="red" onClick={onRevert} disabled={revertDisabled}>
              {t("providers.revert")}
            </Button>
          )}
          <Button
            variant="text"
            tone="red"
            onClick={() => onSelected([])}
            className={cx(selected.length === 0 && shared.invisible)}
          >
            {t("catalog.clearAll")}
          </Button>
        </div>
      </div>

      {pinned.length > 0 ? (
        <SelectedTable
          pinned={pinned}
          ranks={ranks}
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
        <EmptyState title={t("catalog.noneSelected")} />
      )}

      {!editor && declinesNotice}
    </>
  )

  return (
    <div className={styles.step}>
      {editor && periodPart}
      {catalogPart}
      {selectedPart}

      <StepFooter
        editor={!!editor}
        warning={warning}
        total={total}
        until={until}
        declined={editor && declinesNotice}
        error={error}
        checking={checking}
        noneSelected={selected.length === 0}
        submitDisabled={submitDisabled}
        submitReason={submitReason}
        submitLabel={submitLabel}
        onBack={onBack}
        onContinue={onContinue}
      />
    </div>
  )
}
