import { useTranslation } from "react-i18next"
import { MAX_SELECTED, type ProviderFate } from "@/lib/pricing"
import { declineKeyOf, spanAllows, stubOf, type PinnedProvider } from "@/lib/providers"
import { daysLabel } from "./catalog-toolbar"
import { ProviderHeader, ProviderRow } from "./provider-row"
import styles from "./providers-step.module.css"

type ShownFate = Exclude<ProviderFate, "kept">

const FATE_KEYS: Record<ShownFate, string> = {
  new: "providers.rowNew",
  removed: "providers.rowRemoved",
  recreated: "providers.rowRecreated",
  unknown: "providers.rowOnContract",
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
  | { kind: "failed"; label: string; title?: string }
  | { kind: "fate"; fate: ShownFate; label: string }
  | { kind: "idle" }

interface SelectedTableProps {
  pinned: PinnedProvider[]
  proofDays: number
  catalogReady: boolean
  declineByKey: Map<string, string>
  fates?: Map<string, ProviderFate>
  copied: string | null
  warnOf?: (pubkey: string) => { short: string; full: string } | undefined
  onCopy: (value: string) => void
  onOpen: (pubkey: string) => void
  onRemove: (pubkey: string) => void
}

export const SelectedTable = ({
  pinned,
  proofDays,
  catalogReady,
  declineByKey,
  fates,
  copied,
  warnOf,
  onCopy,
  onOpen,
  onRemove,
}: SelectedTableProps) => {
  const { t } = useTranslation()

  const fateOf = (pubkey: string) => fates?.get(pubkey.toLowerCase())
  const picked = pinned.filter(({ pubkey }) => fateOf(pubkey) !== "removed").length

  const stateOf = ({ pubkey, provider }: PinnedProvider): RowState => {
    const fate = fateOf(pubkey)
    if (fate === "removed") return { kind: "fate", fate, label: t(FATE_KEYS[fate]) }

    const decline = declineByKey.get(pubkey.toLowerCase())
    if (decline) {
      const known = declineKeyOf(decline)
      return { kind: "declined", label: known ? t(known) : t("catalog.noOffer"), raw: decline }
    }

    if (fate === "new" || fate === "recreated") return { kind: "fate", fate, label: t(FATE_KEYS[fate]) }

    if (provider && provider.max_span > 0 && !spanAllows(provider, proofDays)) {
      return {
        kind: "warn",
        label: t("catalog.spanShort", { days: daysLabel(t, proofDays) }),
        title: t("catalog.spanConflict", { days: daysLabel(t, proofDays) }),
      }
    }

    const warn = warnOf?.(pubkey)
    if (warn) return { kind: "failed", label: warn.short, title: warn.full }

    if (fate === "unknown") return { kind: "fate", fate, label: t(FATE_KEYS[fate]) }

    if (!provider && catalogReady) {
      return { kind: "warn", label: t("catalog.offCatalog"), title: t("catalog.offCatalogFull") }
    }
    return { kind: "idle" }
  }

  const stateLine = (state: RowState) => {
    if (state.kind === "idle") return null
    const tone = state.kind === "declined" || state.kind === "failed" ? "red" : state.kind === "warn" ? "yellow" : FATE_TONES[state.fate]
    return (
      <span
        data-tone={tone}
        title={state.kind === "warn" || state.kind === "failed" ? state.title : state.kind === "declined" ? state.raw : undefined}
        className={styles.selState}
      >
        {state.label}
      </span>
    )
  }

  return (
    <div className={styles.selPanel}>
      <div className={styles.scrollX}>
        <ProviderHeader />
        {pinned.map(({ pubkey, provider }) => {
          const state = stateOf({ pubkey, provider })
          const fate = fateOf(pubkey)

          return (
            <ProviderRow
              key={pubkey}
              provider={provider ?? stubOf(pubkey)}
              selected={fate !== "removed"}
              full={picked >= MAX_SELECTED}
              quiet
              unlisted={!provider}
              declined={state.kind === "declined"}
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
      </div>
    </div>
  )
}
