import { useTranslation } from "react-i18next"
import { Card, DataTable, DataTableRows, Hint } from "@myton/ui"
import type { StatusTone } from "@myton/ui/domain"
import type { CheckWarn } from "@/lib/check-label"
import { MAX_SELECTED, type ProviderFate } from "@/lib/pricing"
import { declineKeyOf, spanAllows, stubOf, type PinnedProvider } from "@/lib/providers"
import { daysLabel } from "./catalog-toolbar"
import { ProviderHeader, ProviderRow, tableColumns, type RowRing } from "./provider-row"
import styles from "./providers-step.module.css"

type ShownFate = Exclude<ProviderFate, "kept">

const FATE_KEYS: Record<ShownFate, string> = {
  new: "providers.rowNew",
  removed: "providers.rowRemoved",
  recreated: "providers.rowRecreated",
  unknown: "providers.rowOnContract",
}

// A failed check rings the row in the details badge's tone; an unreachable provider's gray stays unringed
const CHECK_RINGS: Partial<Record<StatusTone, RowRing>> = {
  red: "red",
  orange: "orange",
}

const FATE_TONES: Record<ShownFate, string> = {
  new: "green",
  removed: "red",
  recreated: "yellow",
  unknown: "gray",
}

type RowState =
  | { kind: "declined"; label: string; raw?: string }
  | { kind: "warn"; label: string; title?: string }
  | { kind: "failed"; label: string; title?: string; tone: StatusTone }
  | { kind: "fate"; fate: ShownFate; label: string }
  | { kind: "idle" }

interface SelectedTableProps {
  pinned: PinnedProvider[]
  ranks?: Record<string, number>
  proofDays: number
  catalogReady: boolean
  declineByKey: Map<string, string>
  fates?: Map<string, ProviderFate>
  copied: string | null
  warnOf?: (pubkey: string) => CheckWarn | undefined
  reasonOf?: (pubkey: string) => string
  onCopy: (value: string) => void
  onOpen: (pubkey: string) => void
  onRemove?: (pubkey: string) => void
}

export const SelectedTable = ({
  pinned,
  ranks,
  proofDays,
  catalogReady,
  declineByKey,
  fates,
  copied,
  warnOf,
  reasonOf,
  onCopy,
  onOpen,
  onRemove,
}: SelectedTableProps) => {
  const { t } = useTranslation()

  const fateOf = (pubkey: string) => fates?.get(pubkey.toLowerCase())
  const picked = pinned.filter(({ pubkey }) => fateOf(pubkey) !== "removed").length

  const stateOf = ({ pubkey, provider }: PinnedProvider): RowState => {
    const fate = fateOf(pubkey)
    if (fate === "removed") return { kind: "fate", fate, label: reasonOf?.(pubkey) ?? t(FATE_KEYS[fate]) }

    const decline = declineByKey.get(pubkey.toLowerCase())
    if (decline) {
      const known = declineKeyOf(decline)
      return { kind: "declined", label: known ? t(known) : t("catalog.noOffer"), raw: decline }
    }

    if (fate === "new" || fate === "recreated") return { kind: "fate", fate, label: t(FATE_KEYS[fate]) }

    if (provider && (provider.maxSpan ?? 0) > 0 && !spanAllows(provider, proofDays)) {
      return {
        kind: "warn",
        label: t("catalog.spanShort", { days: daysLabel(t, proofDays) }),
        title: t("catalog.spanConflict", { days: daysLabel(t, proofDays) }),
      }
    }

    const warn = warnOf?.(pubkey)
    if (warn) return { kind: "failed", label: warn.short, title: warn.full, tone: warn.tone }

    if (fate === "unknown") return { kind: "fate", fate, label: t(FATE_KEYS[fate]) }

    if (!provider && catalogReady) {
      return { kind: "warn", label: t("catalog.offCatalog"), title: t("catalog.offCatalogFull") }
    }
    return { kind: "idle" }
  }

  const ringOf = (state: RowState): RowRing | undefined =>
    state.kind === "declined" ? "red" : state.kind === "failed" ? CHECK_RINGS[state.tone] : state.kind === "warn" ? "yellow" : undefined

  const stateLine = (state: RowState) => {
    if (state.kind === "idle") return null
    const tone = state.kind === "fate" ? FATE_TONES[state.fate] : state.kind === "failed" ? state.tone : ringOf(state)
    const hint = state.kind === "warn" || state.kind === "failed" ? state.title : state.kind === "declined" ? state.raw : undefined
    return (
      <span data-tone={tone} className={styles.selState}>
        {hint ? <Hint text={hint}>{state.label}</Hint> : state.label}
      </span>
    )
  }

  return (
    <Card striped>
      <DataTable columns={tableColumns(onRemove !== undefined)}>
        <ProviderHeader pickable={onRemove !== undefined} />
        <DataTableRows className={styles.selRows}>
          {pinned.map(({ pubkey, provider }) => {
            const state = stateOf({ pubkey, provider })
            const fate = fateOf(pubkey)

            return (
              <ProviderRow
                key={pubkey}
                provider={provider ?? stubOf(pubkey)}
                rank={provider ? ranks?.[provider.pubkey] : undefined}
                selected={fate !== "removed"}
                full={picked >= MAX_SELECTED}
                quiet
                unlisted={!provider}
                ring={ringOf(state)}
                fate={fate === "new" || fate === "removed" ? fate : undefined}
                note={stateLine(state)}
                proofDays={proofDays}
                copied={copied === pubkey}
                onToggle={onRemove}
                onOpen={onOpen}
                onCopy={onCopy}
              />
            )
          })}
        </DataTableRows>
      </DataTable>
    </Card>
  )
}
