import { useRef, useState } from "react"
import { Check, ChevronDown, Copy, LogOut, Wallet } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useIsConnectionRestored, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react"
import { buttonClass, cx, Popover, ShortId, skeletonClass, useCopyFeedback } from "@myton/ui"
import { walletExpected } from "@/lib/session"
import styles from "./wallet-button.module.css"

export const WalletButton = () => {
  const { t } = useTranslation()
  const [tonConnectUI] = useTonConnectUI()
  const restored = useIsConnectionRestored()
  const address = useTonAddress()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { copied, copy } = useCopyFeedback()

  if (!restored && walletExpected) {
    return (
      <div className={styles.root}>
        <span aria-hidden="true" className={skeletonClass(buttonClass({ variant: "primary" }, styles.button))}>
          <Wallet className={styles.buttonIcon} aria-hidden="true" />
          <span className={styles.label}>{t("ui.connect")}</span>
        </span>
      </div>
    )
  }

  if (!address) {
    return (
      <div className={styles.root}>
        <button type="button" onClick={() => void tonConnectUI.openModal()} className={buttonClass({ variant: "primary" }, styles.button)}>
          <Wallet className={styles.buttonIcon} aria-hidden="true" />
          <span className={styles.label}>{t("ui.connect")}</span>
        </button>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={buttonClass({ variant: "primary" }, styles.button)}
      >
        <Wallet className={styles.buttonIcon} aria-hidden="true" />
        <ShortId value={address} upper={false} className={styles.label} />
        <ChevronDown className={cx(styles.chevron, open && styles.open)} aria-hidden="true" />
      </button>

      {open && (
        <Popover anchor={triggerRef} align="end" fit="content" onDismiss={() => setOpen(false)}>
          <button type="button" onClick={() => void copy(address)} className={styles.item}>
            {copied === address ? (
              <Check className={cx(styles.icon, styles.done)} aria-hidden="true" />
            ) : (
              <Copy className={styles.icon} aria-hidden="true" />
            )}
            <span>{t("ui.copyAddress")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void tonConnectUI.disconnect()
            }}
            className={cx(styles.item, styles.danger)}
          >
            <LogOut className={styles.dangerIcon} aria-hidden="true" />
            <span>{t("ui.disconnect")}</span>
          </button>
        </Popover>
      )}
    </div>
  )
}
