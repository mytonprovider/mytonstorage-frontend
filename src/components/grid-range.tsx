import { useTranslation } from "react-i18next"
import { formatDuration, SECONDS_IN_DAY } from "@/lib/format"
import { gridFloor, gridTop, PERIOD_PRESETS } from "@/lib/pricing"
import { Range } from "./range"

interface GridRangeProps {
  label: string
  stepDays: number
  floorDays?: number
  days: number
  onChange: (days: number) => void
}

export const GridRange = ({ label, stepDays, floorDays, days, onChange }: GridRangeProps) => {
  const { t } = useTranslation()
  const min = gridFloor(stepDays, floorDays)
  const max = gridTop(stepDays)

  return (
    <Range
      label={label}
      min={min}
      max={max}
      step={stepDays}
      value={days}
      valueText={formatDuration(days * SECONDS_IN_DAY, t)}
      ticks={PERIOD_PRESETS.filter(([preset]) => preset >= min && preset <= max).map(([preset, name]) => ({
        at: preset,
        label: t(`presets.${name}`),
      }))}
      onChange={onChange}
    />
  )
}
