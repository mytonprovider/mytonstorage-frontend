import { useTranslation } from "react-i18next"
import { GithubIcon, ProviderIcon, SiteFooter, TelegramIcon } from "@myton/ui"

export const Footer = () => {
  const { t, i18n } = useTranslation()

  return (
    <SiteFooter
      links={[
        { label: t("footer.providers"), href: "https://mytonprovider.org", icon: ProviderIcon },
        {
          label: t("footer.chat"),
          href: i18n.language === "ru" ? "https://t.me/tondev" : "https://t.me/tondev_eng",
          icon: TelegramIcon,
        },
        { label: t("footer.github"), href: "https://github.com/mytonprovider", icon: GithubIcon },
      ]}
    />
  )
}
