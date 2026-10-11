import { Globe, ShieldCheck, Tag, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { Diversity, PickCriterion } from "@/lib/providers"
import { PickCard } from "../pick-card"
import styles from "./providers-step.module.css"

export type Strategy = "reliable" | "cheap" | "countries"

const ICONS: Record<Strategy, LucideIcon> = {
  reliable: ShieldCheck,
  cheap: Tag,
  countries: Globe,
}

export const RECIPES: Record<Strategy, { criterion: PickCriterion; diversity: Diversity; proven?: boolean }> = {
  reliable: { criterion: "uptime", diversity: "any", proven: true },
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
      {STRATEGIES.map((option) => (
        <PickCard
          key={option}
          icon={ICONS[option]}
          title={t(`strategy.${option}`)}
          note={t(`strategy.${option}Note`)}
          hint={t(`strategy.${option}Hint`)}
          active={strategy === option}
          onPick={() => onPick(option)}
        />
      ))}
    </div>
  )
}
