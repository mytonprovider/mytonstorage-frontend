import { useState } from "react"
import { Check, ChevronDown, Copy, LogOut, Wallet } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useIsConnectionRestored, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react"
import { cx } from "@/lib/cx"
import { useDismiss } from "@/lib/dismiss"
import { useCopyFeedback } from "@/lib/dom"
import { walletExpected } from "@/lib/session"
import { shortenMiddle } from "@/lib/format"
import shared from "./shared.module.css"
import styles from "./wallet-button.module.css"

export const WalletButton = () => {
  const { t } = useTranslation()
  const [tonConnectUI] = useTonConnectUI()
  const restored = useIsConnectionRestored()
  const address = useTonAddress()
  const [open, setOpen] = useState(false)
  const { copied, copy } = useCopyFeedback()

  useDismiss(open, () => setOpen(false))

  if (!restored && walletExpected) {
    return (
      <div className={styles.root}>
        <span aria-hidden="true" className={cx(styles.button, shared.ghost)}>
          <Wallet className={styles.buttonIcon} aria-hidden="true" />
          <span className={styles.label}>{t("ui.connect")}</span>
        </span>
      </div>
    )
  }

  if (!address) {
    return (
      <div className={styles.root}>
        <button type="button" onClick={() => void tonConnectUI.openModal()} className={styles.button}>
          <Wallet className={styles.buttonIcon} aria-hidden="true" />
          <span className={styles.label}>{t("ui.connect")}</span>
        </button>
      </div>
    )
  }

  return (
    <div data-menuroot="1" className={styles.root}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={styles.button}>
        <Wallet className={styles.buttonIcon} aria-hidden="true" />
        <span className={cx(styles.label, styles.address)}>{shortenMiddle(address, 4, 4)}</span>
        <ChevronDown className={cx(styles.chevron, open && styles.open)} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu}>
          <button type="button" onClick={() => copy(address)} className={styles.item}>
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
        </div>
      )}
    </div>
  )
}
