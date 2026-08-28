import type { ReactNode } from "react"
import { CircleAlert, CircleCheck, TriangleAlert, type LucideIcon } from "lucide-react"
import { cx } from "@/lib/cx"
import styles from "./notice.module.css"

type Tone = "red" | "yellow" | "green" | "neutral"

const ICONS: Record<Tone, LucideIcon> = {
  red: CircleAlert,
  yellow: TriangleAlert,
  green: CircleCheck,
  neutral: CircleAlert,
}

interface NoticeProps {
  tone: Tone
  children: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  className?: string
}

export const Notice = ({ tone, children, icon, action, className }: NoticeProps) => {
  const Icon = icon ?? ICONS[tone]

  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      data-tone={tone === "neutral" ? undefined : tone}
      className={cx(styles.notice, tone === "neutral" && styles.neutral, className)}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.text}>{children}</span>
      {action && <span className={styles.action}>{action}</span>}
    </div>
  )
}
