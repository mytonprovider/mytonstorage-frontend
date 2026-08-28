import { Check } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { WizardStep } from "@/lib/wizard"
import styles from "./stepper.module.css"

const STEP_KEYS = ["steps.upload", "steps.providers", "steps.period", "steps.done"]

interface StepperProps {
  current: WizardStep
  reached: WizardStep
  onPick: (step: WizardStep) => void
}

export const Stepper = ({ current, reached, onPick }: StepperProps) => {
  const { t } = useTranslation()
  const inset = `${100 / STEP_KEYS.length / 2}%`

  return (
    <div className={styles.wrap}>
      <div className={styles.line} style={{ left: inset, right: inset }} />
      <div className={styles.row}>
        {STEP_KEYS.map((key, index) => {
          const step = (index + 1) as WizardStep
          const state = current === step ? "current" : current > step ? "done" : "todo"

          return (
            <button
              key={key}
              type="button"
              disabled={step > reached}
              aria-current={current === step ? "step" : undefined}
              onClick={() => onPick(step)}
              className={styles.step}
            >
              <span data-step={state} className={styles.bullet}>
                {state === "done" ? <Check strokeWidth={3.5} className={styles.checkIcon} aria-hidden="true" /> : step}
              </span>
              <span data-steplabel={state} className={styles.label}>
                {t(key)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
