import { Clock } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { Button, Notice } from "@myton/ui"
import { countdownTone, useCountdown } from "@/lib/countdown"
import { formatCountdown } from "@/lib/format"
import styles from "./deadline.module.css"

interface DeadlineProps {
  deadline: number
  onRestart: () => void
}

export const Deadline = ({ deadline, onRestart }: DeadlineProps) => {
  const { t } = useTranslation()
  const left = useCountdown(deadline)
  const tone = countdownTone(left)

  if (tone === "over") {
    return (
      <Notice
        tone="red"
        className={styles.notice}
        action={
          <Button size="sm" onClick={onRestart}>
            {t("wizard.uploadAgain")}
          </Button>
        }
      >
        {t("wizard.expired")}
      </Notice>
    )
  }

  return (
    <Notice tone={tone === "soon" ? "yellow" : "gray"} icon={Clock} className={styles.notice}>
      <Trans
        i18nKey="wizard.left"
        values={{ time: formatCountdown(left) }}
        components={{ b: <b className={styles.time} /> }}
      />
    </Notice>
  )
}
