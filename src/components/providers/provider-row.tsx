import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react"
import { ArrowDown, ArrowUp, Check, Star } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { GRAM, formatDuration, formatNumber, formatPercent, shortenMiddle, splitSpace } from "@/lib/format"
import { MAX_SELECTED } from "@/lib/pricing"
import { freeSpace, priceInTon, spanAllows, STATUS_KEYS, statusOf, statusPercent } from "@/lib/providers"
import type { SortDirection, SortField } from "@/lib/providers"
import type { Provider } from "@/types/provider"
import { CopyButton } from "../copy-button"
import { Hint } from "../hint"
import { GhostCopy, GhostValue } from "../table"
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

interface HeaderProps {
  field?: SortField
  direction?: SortDirection
  onSort?: (field: SortField) => void
}

export const ProviderHeader = ({ field, direction, onSort }: HeaderProps) => {
  const { t } = useTranslation()
  const [focused, setFocused] = useState<SortField | null>(null)

  const headCell = (column: Column) => {
    const label = (
      <>
        <span title={t(column.label)} className={shared.ellipsis}>
          {t(column.label)}
        </span>
        {column.hint && <Hint focusable={false} open={focused === column.id} text={t(column.hint)} />}
      </>
    )

    if (!onSort) {
      return (
        <span key={column.id} className={styles.column}>
          {label}
        </span>
      )
    }

    const name = t(column.label)
    const state =
      field === column.id
        ? t(direction === "asc" ? "ui.sortedAsc" : "ui.sortedDesc", { label: name })
        : t("ui.sortColumn", { label: name })
    const announced = column.hint ? `${state}. ${t(column.hint)}` : state

    return (
      <button
        key={column.id}
        type="button"
        onClick={() => onSort(column.id)}
        onFocus={() => setFocused(column.id)}
        onBlur={() => setFocused(null)}
        aria-label={announced}
        className={cx(
          styles.column,
          field === column.id && styles.columnActive,
          column.id === "status" && styles.columnStatus,
        )}
      >
        {label}
        {field === column.id && direction === "asc" ? (
          <ArrowUp className={styles.sortIcon} aria-hidden="true" />
        ) : (
          <ArrowDown className={cx(styles.sortIcon, field !== column.id && styles.sortIconIdle)} aria-hidden="true" />
        )}
      </button>
    )
  }

  return (
    <div className={styles.headerRow}>
      <span className={styles.pickCell} />
      {COLUMNS.map(headCell)}
    </div>
  )
}

const WIDEST_RATIO = "100%"
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
        {STATUS_KEYS.map((key) => (
          <span key={key}>
            {t(`status.${key}`)}
            <span className={styles.ratio}>{WIDEST_RATIO}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

const SKELETON_WIDTH: Record<string, string> = {
  "table.rating": "4em",
  "table.uptime": "3.7em",
  "table.price": "4.3em",
  "table.free": "3.5em",
  "table.workingTime": "4.7em",
  "table.location": "4.3em",
}

const Cell = ({ children }: { children: ReactNode }) => (
  <div className={styles.cell}>
    <span className={styles.cellValue}>{children}</span>
  </div>
)

export const ProviderSkeleton = ({ index = 0 }: { index?: number }) => {
  const { t } = useTranslation()

  return (
    <article
      aria-hidden="true"
      style={{ "--card-index": index } as CSSProperties}
      className={cx(styles.card, styles.placeholder)}
    >
      <span className={styles.pickCell}>
        <span className={cx(shared.check, shared.ghost)} />
      </span>

      {COLUMNS.map((column) =>
        column.id === "pubkey" ? (
          <div key={column.id} className={styles.keyCell}>
            <div className={styles.key}>
              <span className={cx(styles.pubkey, shared.shape)}>{KEY_PLACEHOLDER}</span>
              <GhostCopy />
            </div>
          </div>
        ) : column.id === "status" ? (
          <span key={column.id} className={cx(styles.status, shared.ghost)}>
            <span className={shared.dot} />
            <StatusLabel label={t("status.stable")} ratio={WIDEST_RATIO} />
          </span>
        ) : (
          <Cell key={column.id}>
            <GhostValue width={SKELETON_WIDTH[column.label]} />
          </Cell>
        ),
      )}
    </article>
  )
}

interface ProviderRowProps {
  provider: Provider
  index?: number
  fresh?: boolean
  viewed?: boolean
  selected: boolean
  full?: boolean
  quiet?: boolean
  unlisted?: boolean
  declined?: boolean
  fate?: "new" | "removed"
  note?: ReactNode
  proofDays: number
  copied: boolean
  onToggle: (pubkey: string) => void
  onOpen: (pubkey: string) => void
  onCopy: (value: string) => void
}

export const ProviderRow = ({
  provider,
  index = 0,
  fresh = false,
  viewed = false,
  selected,
  full = false,
  quiet = false,
  unlisted = false,
  declined = false,
  fate,
  note,
  proofDays,
  copied,
  onToggle,
  onOpen,
  onCopy,
}: ProviderRowProps) => {
  const { t } = useTranslation()

  const status = statusOf(provider)
  const space = splitSpace(freeSpace(provider))
  const conflict = !unlisted && !spanAllows(provider, proofDays)
  const keyShort = shortenMiddle(provider.pubkey, 6, 6)
  const blocked = full && !selected
  const pickLabel = fate === "removed" ? t("providers.restoreRow") : t("catalog.pickOne")

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle(provider.pubkey)
  }

  const open = () => onOpen(provider.pubkey)

  return (
    <article
      data-fresh={fresh ? "" : undefined}
      data-viewed={viewed ? "" : undefined}
      data-fate={fate}
      style={{ "--card-index": index } as CSSProperties}
      className={cx(
        styles.card,
        !quiet && selected && styles.cardSelected,
        selected && conflict && styles.conflict,
        declined && styles.declinedCard,
      )}
    >
      <button
        type="button"
        onClick={open}
        aria-label={`${t("catalog.providerDetails")} ${keyShort}`}
        className={styles.open}
      />

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
          <span className={cx(shared.check, selected && shared.checkOn)}>
            {selected && <Check strokeWidth={3.5} className={shared.checkIcon} aria-hidden="true" />}
          </span>
        </button>
      </span>

      <div className={styles.keyCell}>
        <div className={styles.key}>
          <span title={provider.pubkey} className={styles.pubkey}>
            {keyShort}
          </span>
          <CopyButton
            value={provider.pubkey}
            copied={copied}
            onCopy={onCopy}
            label={`${t("ui.copy")} ${keyShort}`}
          />
        </div>
        {note}
      </div>

      <Cell>
        {!unlisted && <Star fill="currentColor" className={shared.starIcon} aria-hidden="true" />}
        <span>{unlisted ? "" : formatNumber(provider.rating || 0, 2)}</span>
      </Cell>

      <span data-tone={status.tone} className={styles.status}>
        <span className={shared.dot} aria-hidden="true" />
        <StatusLabel
          label={t(`status.${status.key}`)}
          ratio={status.rated ? formatPercent(statusPercent(status.ratio), 0) : null}
        />
      </span>

      <Cell>
        <span className={shared.ellipsis}>{unlisted ? "" : formatPercent(provider.uptime || 0)}</span>
      </Cell>

      <Cell>
        <span className={shared.ellipsis}>{unlisted ? "" : formatNumber(priceInTon(provider), 2)}</span>
        {!unlisted && <span className={styles.unit}>{GRAM}</span>}
      </Cell>

      <Cell>
        <span className={shared.ellipsis}>{space.value}</span>
        {space.unit && <span className={styles.unit}>{space.unit}</span>}
      </Cell>

      <Cell>
        <span className={shared.ellipsis}>{unlisted ? "" : formatDuration(provider.working_time, t)}</span>
      </Cell>

      <Cell>
        <span className={shared.ellipsis}>{provider.location?.country ?? t("unknown")}</span>
      </Cell>
    </article>
  )
}
