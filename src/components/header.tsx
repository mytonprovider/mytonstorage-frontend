import { useTranslation } from "react-i18next"
import { SiteHeader } from "@myton/ui"
import { pickLang } from "@myton/ui/i18n"
import { chooseLanguage } from "@/i18n"
import { WalletButton } from "./wallet-button"
import logo from "./logo.svg"

interface HeaderProps {
  dark: boolean
  onToggleTheme: () => void
}

export const Header = ({ dark, onToggleTheme }: HeaderProps) => {
  const { t, i18n } = useTranslation()

  return (
    <SiteHeader
      title={t("siteTitle")}
      logo={logo}
      language={pickLang(i18n.language)}
      onLanguage={chooseLanguage}
      dark={dark}
      onToggleTheme={onToggleTheme}
      actions={<WalletButton />}
    />
  )
}
