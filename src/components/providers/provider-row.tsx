import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react"
import { Star } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Badge,
  CheckMark,
  CopyButton,
  cx,
  DataRow,
  DataTableHead,
  FreeMark,
  GhostGlyph,
  GhostIcon,
  GhostValue,
  RankMark,
  ShortId,
  SortColumn,
  skeletonClass,
} from "@myton/ui"
import {
  countryLabel,
  EMPTY,
  fmt,
  freeBytes,
  freePercent,
  GRAM,
  PROVIDER_SAMPLE,
  providerStatus,
  ratioPercent,
  STATE_TONE,
  type Provider,
  type ProviderState,
  type SortDirection,
  type SortField,
} from "@myton/ui/domain"
import { pickLang } from "@myton/ui/i18n"
import { statusView } from "@myton/ui/locale"
import { formatDuration } from "@/lib/format"
import { MAX_SELECTED } from "@/lib/pricing"
import { spanAllows } from "@/lib/providers"
import shared from "../shared.module.css"
import styles from "./provider-row.module.css"

interface Column {
  id: SortField
  label: string
  hint?: string
}

const COLUMNS: Column[] = [
  { id: "pubkey", label: "table.key" },
  { id: "rating", label: "table.rating" },
  { id: "status", label: "table.status", hint: "table.statusHint" },
  { id: "uptime", label: "table.uptime", hint: "table.uptimeHint" },
  { id: "price", label: "table.price", hint: "table.priceHint" },
  { id: "freeSpace", label: "table.free" },
  { id: "workingTime", label: "table.workingTime" },
  { id: "location", label: "table.location" },
]

// The pick box, the rank, then a column each: the catalogue and the picked list share the head and the rows.
export const tableColumns = (pickable: boolean) =>
  `${pickable ? "var(--control-md) " : ""}repeat(${COLUMNS.length + 1}, max-content)`

interface HeaderProps {
  field?: SortField
  direction?: SortDirection
  pickable?: boolean
  onSort?: (field: SortField) => void
}

export const ProviderHeader = ({ field, direction, pickable = true, onSort }: HeaderProps) => {
  const { t } = useTranslation()

  const headCell = (column: Column) => (
    <SortColumn
      key={column.id}
      label={t(column.label)}
      hint={column.hint ? t(column.hint) : undefined}
      active={field === column.id}
      direction={direction ?? "desc"}
      onSort={onSort && (() => onSort(column.id))}
      className={column.id === "status" ? styles.columnStatus : undefined}
    />
  )

  return (
    <DataTableHead className={styles.headerRow}>
      {pickable && <span className={styles.pickCell} />}
      <span />
      {COLUMNS.map(headCell)}
    </DataTableHead>
  )
}

const WIDEST_RATIO = "100%"
const STATES = Object.keys(STATE_TONE) as ProviderState[]
const KEY_PLACEHOLDER = "000000…000000"

const StatusLabel = ({ label, ratio }: { label: string; ratio: string | null }) => {
  const { t } = useTranslation()

  return (
    <span className={styles.statusStack}>
      <span className={styles.statusRow}>
        <span className={shared.ellipsis}>{label}</span>
        {ratio && <span className={styles.ratio}>{ratio}</span>}
      </span>
      <span className={styles.statusGhost} aria-hidden="true">
        {STATES.map((key) => (
          <span key={key}>
            {t(`ui:status.${key}`)}
            <span className={styles.ratio}>{WIDEST_RATIO}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

const Cell = ({ children }: { children: ReactNode }) => (
  <div className={styles.cell}>
    <span className={styles.cellValue}>{children}</span>
  </div>
)

export const ProviderSkeleton = ({ index }: { index: number }) => {
  const { t, i18n } = useTranslation()
  const lang = pickLang(i18n.language)
  const space = fmt.splitSpace(PROVIDER_SAMPLE.freeBytes)

  return (
    <DataRow ghost className={styles.card}>
      <span className={styles.pickCell}>
        <span className={styles.pick}>
          <CheckMark checked={false} className={skeletonClass()} />
        </span>
      </span>

      <span>
        <RankMark rank={index + 1} variant="row" className={skeletonClass()} />
      </span>

      <div className={styles.keyCell}>
        <div className={styles.key}>
          <span className={skeletonClass(styles.pubkey)}>{KEY_PLACEHOLDER}</span>
          <GhostIcon />
        </div>
      </div>

      <Cell>
        <GhostGlyph />
        <GhostValue vary sample={fmt.number(PROVIDER_SAMPLE.rating, 2)} />
      </Cell>

      <Badge tone="gray" size="sm" dot className={skeletonClass(styles.status)}>
        <StatusLabel label={t("ui:status.stable")} ratio={WIDEST_RATIO} />
      </Badge>

      <Cell>
        <GhostValue vary sample={fmt.percent(PROVIDER_SAMPLE.uptime)} />
      </Cell>

      <Cell>
        <GhostValue vary sample={fmt.price(PROVIDER_SAMPLE.price)} />
        <GhostValue sample={GRAM} className={styles.unit} />
      </Cell>

      <Cell>
        <GhostValue vary sample={space.value} />
        {space.unit && <GhostValue sample={space.unit} className={styles.unit} />}
        <FreeMark percent={PROVIDER_SAMPLE.freePercent} variant="row" className={skeletonClass()} />
      </Cell>

      <Cell>
        <GhostValue vary sample={formatDuration(PROVIDER_SAMPLE.workingTime, lang)} />
      </Cell>

      <Cell>
        <GhostValue vary sample={PROVIDER_SAMPLE.country} />
      </Cell>
    </DataRow>
  )
}

export type RowRing = "red" | "orange" | "yellow"

interface ProviderRowProps {
  // The place by rating among those that can take the bag; a provider off the catalog has none.
  rank?: number
  provider: Provider
  index?: number
  fresh?: boolean
  viewed?: boolean
  selected: boolean
  full?: boolean
  quiet?: boolean
  unlisted?: boolean
  ring?: RowRing
  fate?: "new" | "removed"
  note?: ReactNode
  proofDays: number
  copied: boolean
  onToggle?: (pubkey: string) => void
  onOpen: (pubkey: string) => void
  onCopy: (value: string) => void
}

export const ProviderRow = ({
  provider,
  rank,
  index = 0,
  fresh = false,
  viewed = false,
  selected,
  full = false,
  quiet = false,
  unlisted = false,
  ring,
  fate,
  note,
  proofDays,
  copied,
  onToggle,
  onOpen,
  onCopy,
}: ProviderRowProps) => {
  const { t, i18n } = useTranslation()
  const lang = pickLang(i18n.language)

  const status = statusView(providerStatus(provider), lang)
  const space = fmt.splitSpace(freeBytes(provider))
  const free = unlisted ? null : freePercent(provider)
  const conflict = !unlisted && !spanAllows(provider, proofDays)
  const keyShort = fmt.shortKey(provider.pubkey)
  const blocked = full && !selected
  const pickLabel = fate === "removed" ? t("providers.restoreRow") : t("catalog.pickOne")

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle?.(provider.pubkey)
  }

  const openRef = useRef<HTMLButtonElement>(null)
  const open = () => onOpen(provider.pubkey)
  const openFromKey = () => {
    openRef.current?.focus()
    open()
  }

  return (
    <DataRow
      onOpen={open}
      label={`${t("catalog.providerDetails")} ${keyShort}`}
      openRef={openRef}
      viewed={viewed}
      data-fate={fate}
      data-ring={ring ?? (selected && conflict ? "yellow" : undefined)}
      style={{ "--card-index": index } as CSSProperties}
      className={cx(styles.card, fresh && shared.cardAppear, !quiet && selected && styles.cardSelected)}
    >
      {onToggle && (
        <span className={styles.pickCell}>
          <button
            type="button"
            onClick={toggle}
            role="checkbox"
            aria-checked={selected}
            aria-label={pickLabel}
            title={blocked ? t("catalog.limitShort", { max: MAX_SELECTED }) : pickLabel}
            aria-disabled={blocked || undefined}
            className={styles.pick}
          >
            <CheckMark checked={selected} />
          </button>
        </span>
      )}

      <span>{rank !== undefined && <RankMark rank={rank} variant="row" />}</span>

      <div className={styles.keyCell}>
        <div className={styles.key}>
          <button type="button" tabIndex={-1} title={provider.pubkey} onClick={openFromKey} className={styles.pubkey}>
            <ShortId value={provider.pubkey} />
          </button>
          <CopyButton
            value={provider.pubkey}
            copied={copied}
            onCopy={onCopy}
            label={`${t("ui:ui.copy")} ${keyShort}`}
          />
        </div>
        {note}
      </div>

      <Cell>
        {!unlisted && <Star fill="currentColor" className={shared.starIcon} aria-hidden="true" />}
        <span>{unlisted ? EMPTY : fmt.number(provider.rating, 2)}</span>
      </Cell>

      <Badge tone={status.tone} size="sm" dot className={styles.status}>
        <StatusLabel
          label={status.label}
          ratio={status.ratio === null ? null : fmt.percent(ratioPercent(status.ratio) ?? 0, 0)}
        />
      </Badge>

      <Cell>
        <span className={shared.ellipsis}>{unlisted ? EMPTY : fmt.percent(provider.uptime)}</span>
      </Cell>

      <Cell>
        <span className={shared.ellipsis}>{unlisted ? EMPTY : fmt.price(provider.price)}</span>
        {!unlisted && <span className={styles.unit}>{GRAM}</span>}
      </Cell>

      <Cell>
        <span className={shared.ellipsis}>{space.value}</span>
        {space.unit && <span className={styles.unit}>{space.unit}</span>}
        {free !== null && <FreeMark percent={free} variant="row" />}
      </Cell>

      <Cell>
        <span className={shared.ellipsis}>{unlisted ? EMPTY : formatDuration(provider.workingTime, lang)}</span>
      </Cell>

      <Cell>
        <span className={shared.ellipsis}>{countryLabel(provider.location) ?? EMPTY}</span>
      </Cell>
    </DataRow>
  )
}
