import { Check, Copy } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { IconButton } from "./icon-button"
import styles from "./copy-button.module.css"

interface CopyButtonProps {
  value: string
  copied: boolean
  onCopy: (value: string) => void
  label?: string
  className?: string
}

export const CopyButton = ({ value, copied, onCopy, label, className }: CopyButtonProps) => {
  const { t } = useTranslation()

  return (
    <IconButton
      size="xs"
      label={label ?? t("ui.copy")}
      className={cx(copied && styles.copied, className)}
      onClick={(event) => {
        event.stopPropagation()
        onCopy(value)
      }}
    >
      {copied ? <Check className={styles.icon} aria-hidden="true" /> : <Copy className={styles.icon} aria-hidden="true" />}
    </IconButton>
  )
}
