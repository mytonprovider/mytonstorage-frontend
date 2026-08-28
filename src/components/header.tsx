import type { MouseEvent } from "react"
import { Moon, Sun } from "lucide-react"
import { useTranslation } from "react-i18next"
import { scrollToTop } from "@/lib/dom"
import { IconButton } from "./icon-button"
import { WalletButton } from "./wallet-button"
import logo from "./logo.svg"
import shared from "./shared.module.css"
import styles from "./header.module.css"

interface HeaderProps {
  dark: boolean
  onToggleTheme: (origin: DOMRect) => void
}

export const Header = ({ dark, onToggleTheme }: HeaderProps) => {
  const { t, i18n } = useTranslation()

  const nextLanguage = i18n.language === "ru" ? "en" : "ru"

  const brandClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    scrollToTop()
  }

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a href="#top" onClick={brandClick} aria-label={t("siteTitle")} className={styles.brand}>
          <img src={logo} alt="" width={36} height={36} className={styles.logo} />
          <span className={styles.title}>{t("siteTitle")}</span>
        </a>

        <span className={shared.spacer} />

        <WalletButton />

        <IconButton
          label={t("ui.language")}
          size="lg"
          className={styles.language}
          onClick={() => void i18n.changeLanguage(nextLanguage)}
        >
          {nextLanguage.toUpperCase()}
        </IconButton>

        <IconButton label={t("ui.theme")} size="lg" onClick={(event) => onToggleTheme(event.currentTarget.getBoundingClientRect())}>
          {dark ? <Sun className={styles.icon} aria-hidden="true" /> : <Moon className={styles.icon} aria-hidden="true" />}
        </IconButton>
      </div>
    </header>
  )
}
