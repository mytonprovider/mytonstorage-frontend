import { Globe, ShieldCheck, Tag, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import type { Diversity, PickCriterion } from "@/lib/providers"
import styles from "./providers-step.module.css"

export type Strategy = "reliable" | "cheap" | "countries"

const ICONS: Record<Strategy, LucideIcon> = {
  reliable: ShieldCheck,
  cheap: Tag,
  countries: Globe,
}

export const RECIPES: Record<Strategy, { criterion: PickCriterion; diversity: Diversity }> = {
  reliable: { criterion: "score", diversity: "any" },
  cheap: { criterion: "price", diversity: "any" },
  countries: { criterion: "score", diversity: "differentCountries" },
}

export const STRATEGIES: Strategy[] = ["reliable", "cheap", "countries"]

interface StrategyCardsProps {
  strategy: Strategy | null
  onPick: (next: Strategy) => void
}

export const StrategyCards = ({ strategy, onPick }: StrategyCardsProps) => {
  const { t } = useTranslation()

  return (
    <div role="radiogroup" aria-label={t("catalog.stepTitle")} className={styles.group}>
      {STRATEGIES.map((option) => {
        const active = strategy === option
        const Icon = ICONS[option]
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            title={active ? t("catalog.reshuffle") : undefined}
            onClick={() => onPick(option)}
            className={cx(styles.card, active && styles.cardOn)}
          >
            <span className={styles.cardIcon}>
              <Icon className={styles.cardGlyph} aria-hidden="true" />
            </span>
            <span className={styles.cardTitle}>{t(`strategy.${option}`)}</span>
            <span className={styles.cardNote}>{t(`strategy.${option}Note`)}</span>
          </button>
        )
      })}
    </div>
  )
}
