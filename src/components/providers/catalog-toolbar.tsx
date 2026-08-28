import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { Search, SlidersHorizontal, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { useDismiss } from "@/lib/dismiss"
import { formatNumber, type Translate } from "@/lib/format"
import { DEFAULT_PROOF_DAYS, PROOF_PRESETS, PROOF_STEPS, nearestProofDays } from "@/lib/pricing"
import { bounds, countMatching, hasFilters, priceInTon, type ProviderFilters } from "@/lib/providers"
import type { Provider } from "@/types/provider"
import { IconButton } from "../icon-button"
import { Menu, MenuOption, RangeMenuBody } from "../menu"
import { Range } from "../range"
import styles from "./providers-step.module.css"

type MenuId = "countries" | "rating" | "price" | "proof"

export const daysLabel = (t: Translate, days: number) =>
  `${Number.isInteger(days) ? days : days.toFixed(1)}\u00A0${t("period.days")}`

interface CatalogToolbarProps {
  bare?: boolean
  providers: Provider[]
  bagSize: number
  filters: ProviderFilters
  onFilters: Dispatch<SetStateAction<ProviderFilters>>
  query: string
  onQuery: (value: string) => void
  proofDays: number
  onProofDays: (days: number) => void
  proofValueLabel?: string
}

export const CatalogToolbar = ({
  bare = false,
  providers,
  bagSize,
  filters,
  onFilters,
  query,
  onQuery,
  proofDays,
  onProofDays,
  proofValueLabel,
}: CatalogToolbarProps) => {
  const { t } = useTranslation()
  const searchRef = useRef<HTMLInputElement>(null)
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useDismiss(openMenu !== null, () => setOpenMenu(null))

  const ratingBounds = useMemo(() => bounds(providers.map((provider) => provider.rating || 0), 1), [providers])
  const priceBounds = useMemo(() => bounds(providers.map((provider) => priceInTon(provider)), 0.01), [providers])

  const countries = useMemo(() => {
    const names = new Set(providers.map((provider) => provider.location?.country).filter(Boolean) as string[])
    return [...names]
      .map((name) => ({ name, count: countMatching(providers, { ...filters, countries: [name] }, proofDays, bagSize) }))
      .sort((a, b) => Number(a.count === 0) - Number(b.count === 0) || a.name.localeCompare(b.name))
  }, [providers, filters, proofDays, bagSize])

  const setRange = (key: "rating" | "price", edge: "Min" | "Max", value: number, [low, high]: [number, number]) => {
    onFilters((current) => {
      const next = { ...current }
      const minKey = `${key}Min` as const
      const maxKey = `${key}Max` as const
      const currentLow = next[minKey] ?? low
      const currentHigh = next[maxKey] ?? high

      if (edge === "Min") {
        next[minKey] = Math.min(value, currentHigh)
        next[maxKey] = next[maxKey] ?? currentHigh
      } else {
        next[maxKey] = Math.max(value, currentLow)
        next[minKey] = next[minKey] ?? currentLow
      }

      if ((next[minKey] ?? low) <= low && (next[maxKey] ?? high) >= high) {
        next[minKey] = null
        next[maxKey] = null
      }

      return next
    })
  }

  const rangeLabel = (low: number | null, high: number | null, [min, max]: [number, number], digits: number) =>
    `${formatNumber(low ?? min, digits)} – ${formatNumber(high ?? max, digits)}`

  return (
    <div className={cx(styles.toolbar, bare && styles.toolbarBare)}>
      <div className={styles.search}>
        <Search aria-hidden="true" className={styles.searchIcon} />
        <input
          ref={searchRef}
          type="text"
          autoComplete="off"
          value={query}
          placeholder={t("ui.search")}
          aria-label={t("ui.search")}
          onChange={(event) => onQuery(event.target.value)}
          className={styles.searchInput}
        />
        {query && (
          <IconButton
            size="sm"
            label={t("ui.clear")}
            onClick={() => {
              onQuery("")
              searchRef.current?.focus()
            }}
            className={styles.clear}
          >
            <X aria-hidden="true" className={styles.smIcon} />
          </IconButton>
        )}
      </div>

      <button
        type="button"
        title={t("filters.title")}
        aria-label={t("filters.title")}
        aria-expanded={filtersOpen}
        data-tone={hasFilters(filters) || proofDays !== DEFAULT_PROOF_DAYS ? "accent" : "field"}
        onClick={() => {
          setOpenMenu(null)
          setFiltersOpen(!filtersOpen)
        }}
        className={styles.filterToggle}
      >
        <SlidersHorizontal aria-hidden="true" className={styles.smIcon} />
      </button>

      <div data-open={filtersOpen} className={styles.filters}>
        <Menu
          label={
            filters.countries.length === 0
              ? t("filters.allCountries")
              : filters.countries.length === 1
                ? filters.countries[0]
                : t("filters.countries", { count: filters.countries.length })
          }
          active={filters.countries.length > 0}
          open={openMenu === "countries"}
          onToggle={() => setOpenMenu(openMenu === "countries" ? null : "countries")}
        >
          {countries.map((country) => (
            <MenuOption
              key={country.name}
              label={country.name}
              count={country.count}
              selected={filters.countries.includes(country.name)}
              dimmed={country.count === 0 && !filters.countries.includes(country.name)}
              onToggle={() => {
                onFilters((current) => ({
                  ...current,
                  countries: current.countries.includes(country.name)
                    ? current.countries.filter((name) => name !== country.name)
                    : [...current.countries, country.name],
                }))
              }}
            />
          ))}
        </Menu>

        <Menu
          label={
            filters.priceMin != null || filters.priceMax != null
              ? rangeLabel(filters.priceMin, filters.priceMax, priceBounds, 2)
              : t("filters.priceAny")
          }
          active={filters.priceMin != null || filters.priceMax != null}
          open={openMenu === "price"}
          onToggle={() => setOpenMenu(openMenu === "price" ? null : "price")}
        >
          <RangeMenuBody
            value={rangeLabel(filters.priceMin, filters.priceMax, priceBounds, 2)}
            unit={t("filters.priceUnit")}
            resetLabel={t("ui.reset")}
            onReset={() => onFilters((current) => ({ ...current, priceMin: null, priceMax: null }))}
          >
            <Range
              label={t("table.price")}
              min={priceBounds[0]}
              max={priceBounds[1]}
              step={0.01}
              value={filters.priceMin ?? priceBounds[0]}
              highValue={filters.priceMax ?? priceBounds[1]}
              onChange={(value) => setRange("price", "Min", value, priceBounds)}
              onHighChange={(value) => setRange("price", "Max", value, priceBounds)}
            />
          </RangeMenuBody>
        </Menu>

        <Menu
          align="right"
          label={
            filters.ratingMin != null || filters.ratingMax != null
              ? rangeLabel(filters.ratingMin, filters.ratingMax, ratingBounds, 1)
              : t("filters.ratingAny")
          }
          active={filters.ratingMin != null || filters.ratingMax != null}
          open={openMenu === "rating"}
          onToggle={() => setOpenMenu(openMenu === "rating" ? null : "rating")}
        >
          <RangeMenuBody
            value={rangeLabel(filters.ratingMin, filters.ratingMax, ratingBounds, 1)}
            unit={t("filters.ratingUnit")}
            resetLabel={t("ui.reset")}
            onReset={() => onFilters((current) => ({ ...current, ratingMin: null, ratingMax: null }))}
          >
            <Range
              label={t("table.rating")}
              min={ratingBounds[0]}
              max={ratingBounds[1]}
              step={0.1}
              value={filters.ratingMin ?? ratingBounds[0]}
              highValue={filters.ratingMax ?? ratingBounds[1]}
              onChange={(value) => setRange("rating", "Min", value, ratingBounds)}
              onHighChange={(value) => setRange("rating", "Max", value, ratingBounds)}
            />
          </RangeMenuBody>
        </Menu>

        <Menu
          align="right"
          label={t("filters.proofPill", { days: daysLabel(t, proofDays) })}
          active={proofDays !== DEFAULT_PROOF_DAYS}
          open={openMenu === "proof"}
          onToggle={() => setOpenMenu(openMenu === "proof" ? null : "proof")}
        >
          <RangeMenuBody
            value={proofValueLabel ?? daysLabel(t, proofDays)}
            unit={t("filters.proofUnit")}
            note={t("filters.proofNote")}
            resetLabel={t("ui.reset")}
            onReset={() => onProofDays(DEFAULT_PROOF_DAYS)}
          >
            <Range
              label={t("details.span")}
              min={0}
              max={PROOF_STEPS.length - 1}
              step={1}
              value={Math.max(0, PROOF_STEPS.indexOf(nearestProofDays(proofDays)))}
              valueText={daysLabel(t, proofDays)}
              ticks={PROOF_PRESETS.map(([, name], index) => ({ at: index, label: t(`presets.${name}`) }))}
              onChange={(index) => onProofDays(PROOF_STEPS[index])}
            />
          </RangeMenuBody>
        </Menu>
      </div>
    </div>
  )
}
