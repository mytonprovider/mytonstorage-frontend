import { Globe, Package, Server, Wallet, type LucideIcon } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { SectionTitle } from "@myton/ui"
import styles from "./how-it-works.module.css"

const DOCS_URL = "https://docs.ton.org/foundations/web3/ton-storage"

const SECTIONS: { key: string; icon: LucideIcon }[] = [
  { key: "bag", icon: Package },
  { key: "public", icon: Globe },
  { key: "providers", icon: Server },
  { key: "contract", icon: Wallet },
]

export const HowItWorks = () => {
  const { t } = useTranslation()

  return (
    <div className={styles.body}>
      {SECTIONS.map(({ key, icon: Icon }) => (
        <section key={key} className={styles.section}>
          <SectionTitle size="md" icon={Icon}>
            <span>{t(`about.${key}Title`)}</span>
          </SectionTitle>
          <p className={styles.text}>
            <Trans i18nKey={`about.${key}Text`} components={{ a: <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" /> }} />
          </p>
        </section>
      ))}
    </div>
  )
}
