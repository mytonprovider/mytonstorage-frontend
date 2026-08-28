import type { ComponentType } from "react"
import { useTranslation } from "react-i18next"
import { GithubIcon, ProviderIcon, TelegramIcon } from "./brand-icons"
import styles from "./footer.module.css"

interface FooterLink {
  key: string
  href: string
  ruHref?: string
  Icon: ComponentType<{ className?: string }>
}

const LINKS: FooterLink[] = [
  { key: "footer.providers", href: "https://mytonprovider.org", Icon: ProviderIcon },
  { key: "footer.chat", href: "https://t.me/tondev_eng", ruHref: "https://t.me/tondev", Icon: TelegramIcon },
  { key: "footer.github", href: "https://github.com/mytonprovider", Icon: GithubIcon },
]

export const Footer = () => {
  const { t, i18n } = useTranslation()

  return (
    <footer className={styles.footer}>
      <nav className={styles.inner}>
        {LINKS.map(({ key, href, ruHref, Icon }) => (
          <a
            key={key}
            href={i18n.language === "ru" ? (ruHref ?? href) : href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t(key)}
            className={styles.link}
          >
            <Icon className={styles.icon} aria-hidden="true" />
            <span className={styles.label}>{t(key)}</span>
          </a>
        ))}
      </nav>
    </footer>
  )
}
