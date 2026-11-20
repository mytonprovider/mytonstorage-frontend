import { useTranslation } from "react-i18next"
import { Range } from "@myton/ui"
import { DAY } from "@myton/ui/domain"
import { pickLang } from "@myton/ui/i18n"
import { formatDuration } from "@/lib/format"
import { gridFloor, gridTop, PERIOD_PRESETS } from "@/lib/pricing"

interface GridRangeProps {
  label: string
  stepDays: number
  floorDays?: number
  days: number
  onChange: (days: number) => void
}

export const GridRange = ({ label, stepDays, floorDays, days, onChange }: GridRangeProps) => {
  const { t, i18n } = useTranslation()
  const lang = pickLang(i18n.language)
  const min = gridFloor(stepDays, floorDays)
  const max = gridTop(stepDays)

  return (
    <Range
      label={label}
      min={min}
      max={max}
      step={stepDays}
      value={days}
      valueText={formatDuration(days * DAY, lang)}
      ticks={PERIOD_PRESETS.filter(([preset]) => preset >= min && preset <= max).map(([preset, name]) => ({
        at: preset,
        label: t(`presets.${name}`),
      }))}
      onChange={onChange}
    />
  )
}
