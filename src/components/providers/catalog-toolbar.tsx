import { useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { CalendarCheck, SlidersHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Card,
  cx,
  FilterOption,
  FilterRange,
  glyphClass,
  Hint,
  IconButton,
  Range,
  SearchField,
  SectionTitle,
} from "@myton/ui"
import { filterEdges, fmt, type Edge, type Provider } from "@myton/ui/domain"
import type { Translate } from "@/lib/format"
import { PROOF_PRESETS, PROOF_STEPS, nearestProofDays } from "@/lib/pricing"
import { countMatching, hasFilters, type ProviderFilters } from "@/lib/providers"
import { Menu, RangeMenuBody } from "../menu"
import shared from "../shared.module.css"
import styles from "./providers-step.module.css"

type MenuId = "countries" | "rating" | "price"

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
}

export const ProofPeriodRow = ({
  proofDays,
  onProofDays,
  proofValueLabel,
  sheet,
}: {
  proofDays: number
  onProofDays: (days: number) => void
  proofValueLabel?: string
  sheet?: boolean
}) => {
  const { t } = useTranslation()
  const value = proofValueLabel ?? daysLabel(t, proofDays)

  const range = (
    <Range
      label={t("details.span")}
      min={0}
      max={PROOF_STEPS.length - 1}
      step={1}
      value={Math.max(0, PROOF_STEPS.indexOf(nearestProofDays(proofDays)))}
      valueText={value}
      ticks={PROOF_PRESETS.map(([, name], index) => ({ at: index, label: t(`presets.${name}`) }))}
      onChange={(index) => onProofDays(PROOF_STEPS[index])}
    />
  )

  if (sheet) {
    return (
      <>
        <div className={styles.headRow}>
          <SectionTitle size="md" icon={CalendarCheck}>
            <span>{t("details.span")}</span>
          </SectionTitle>
          <Hint text={t("filters.proofNote")} />
          <span className={shared.spacer} />
          <span className={styles.proofValue}>{value}</span>
        </div>
        <Card frame className={styles.proofRow}>{range}</Card>
      </>
    )
  }

  return (
    <Card frame className={styles.proofRow}>
      <div className={styles.proofHeading}>
        <span className={styles.proofLabel}>{t("details.span")}</span>
        <Hint text={t("filters.proofNote")} />
        <span className={shared.spacer} />
        <span className={styles.proofValue}>{value}</span>
      </div>
      {range}
    </Card>
  )
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
}: CatalogToolbarProps) => {
  const { t } = useTranslation()
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const edges = useMemo(() => filterEdges(providers, Date.now() / 1000), [providers])

  // The most providers first, as the MTP location list orders them
  const countries = useMemo(() => {
    const names = new Set(providers.map((provider) => provider.location?.country).filter(Boolean) as string[])
    return [...names]
      .map((name) => ({ name, count: countMatching(providers, { ...filters, countries: [name] }, proofDays, bagSize) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [providers, filters, proofDays, bagSize])

  const setRange = (key: "rating" | "price", from: number | undefined, to: number | undefined) =>
    onFilters((current) => ({ ...current, [`${key}Min`]: from ?? null, [`${key}Max`]: to ?? null }))

  const rangeLabel = (low: number | null, high: number | null, edge: Edge) =>
    `${fmt.number(low ?? edge.min, 2)} – ${high === null ? `${fmt.number(edge.max, 2)}+` : fmt.number(high, 2)}`

  const rangeMenu = (key: "rating" | "price", low: number | null, high: number | null) => (
    <RangeMenuBody resetLabel={t("ui:ui.reset")} onReset={() => setRange(key, undefined, undefined)}>
      <FilterRange
        label={t(`ui:filters.field.${key}`)}
        edge={edges[key]}
        step={0.01}
        open
        value={{ from: low ?? undefined, to: high ?? undefined }}
        onChange={({ from, to }) => setRange(key, from, to)}
      />
    </RangeMenuBody>
  )

  return (
    <div className={cx(styles.toolbar, bare && styles.toolbarBare)}>
      <SearchField value={query} onChange={onQuery} label={t("ui.search")} className={styles.search} />

      <IconButton
        size="xl"
        variant={hasFilters(filters) ? "primary" : "secondary"}
        label={t("filters.title")}
        aria-expanded={filtersOpen}
        onClick={() => {
          setOpenMenu(null)
          setFiltersOpen(!filtersOpen)
        }}
        className={styles.filterToggle}
      >
        <SlidersHorizontal aria-hidden="true" className={glyphClass("sm")} />
      </IconButton>

      <div data-open={filtersOpen} className={styles.filters}>
        <Menu
          label={
            filters.countries.length === 0
              ? t("filters.allCountries")
              : filters.countries.length === 1
                ? filters.countries[0]
                : `${filters.countries[0]} +${filters.countries.length - 1}`
          }
          active={filters.countries.length > 0}
          open={openMenu === "countries"}
          onToggle={() => setOpenMenu(openMenu === "countries" ? null : "countries")}
        >
          {countries.map((country) => (
            <FilterOption
              key={country.name}
              label={country.name}
              count={country.count}
              checked={filters.countries.includes(country.name)}
              disabled={country.count === 0 && !filters.countries.includes(country.name)}
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
              ? rangeLabel(filters.priceMin, filters.priceMax, edges.price)
              : t("filters.priceAny")
          }
          active={filters.priceMin != null || filters.priceMax != null}
          open={openMenu === "price"}
          onToggle={() => setOpenMenu(openMenu === "price" ? null : "price")}
        >
          {rangeMenu("price", filters.priceMin, filters.priceMax)}
        </Menu>

        <Menu
          align="right"
          label={
            filters.ratingMin != null || filters.ratingMax != null
              ? rangeLabel(filters.ratingMin, filters.ratingMax, edges.rating)
              : t("filters.ratingAny")
          }
          active={filters.ratingMin != null || filters.ratingMax != null}
          open={openMenu === "rating"}
          onToggle={() => setOpenMenu(openMenu === "rating" ? null : "rating")}
        >
          {rangeMenu("rating", filters.ratingMin, filters.ratingMax)}
        </Menu>
      </div>
    </div>
  )
}
