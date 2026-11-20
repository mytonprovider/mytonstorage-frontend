import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Folder, Upload } from "lucide-react"
import {
  EmptyState,
  Globe,
  Notice,
  SectionTabs,
  SectionTabsRoom,
  Sheet,
  ShortId,
  SitePage,
  TabPanel,
  UiProvider,
  useCopyFeedback,
  useSiteTheme,
} from "@myton/ui"
import { pickLang } from "@myton/ui/i18n"
import { globeWords, locales } from "@myton/ui/locale"
import { useContracts } from "@/lib/contracts"
import { openContracts } from "@/lib/contracts-view"
import { stubOf, useProviderCatalog } from "@/lib/providers"
import { useSession, walletExpected } from "@/lib/session"
import { useUnpaidBags } from "@/lib/unpaid-bags"
import { useWizardFlow } from "@/lib/wizard"
import { THEME_KEY } from "@/lib/local-storage"
import { FilesStage } from "@/components/files/files-stage"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { HowItWorks } from "@/components/how-it-works"
import { ProviderDetails } from "@/components/providers/provider-details"
import { UploadGateSheet } from "@/components/wizard/upload-gate-sheet"
import { WizardStage } from "@/components/wizard/wizard-stage"
import styles from "./app.module.css"

type Tab = "upload" | "files"

const TABS = "main"
const TAB_ORDER: readonly Tab[] = ["upload", "files"]

export const App = () => {
  const { t, i18n } = useTranslation()
  const { dark, toggle } = useSiteTheme(THEME_KEY)
  const lang = pickLang(i18n.language)
  const { restored, address, authorized, authError, signOut } = useSession(dark)
  const connected = restored && address !== ""
  const pendingWallet = !restored && walletExpected

  const [tab, setTab] = useState<Tab>("upload")
  const [openProviderKey, setOpenProviderKey] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)

  const catalog = useProviderCatalog()
  const { copied, copy } = useCopyFeedback()
  const onCopy = (value: string) => void copy(value)
  const unpaid = useUnpaidBags(authorized ? address : "", signOut)
  const wizard = useWizardFlow({
    restored,
    address,
    signOut,
    unpaidBags: unpaid.bags,
    unpaidKnown: unpaid.listRead,
    freeStorageSeconds: unpaid.freeStorageSeconds,
    refreshUnpaid: unpaid.refresh,
  })
  const contracts = useContracts({ owner: authorized ? address : "", onUnauthorized: wizard.onUnauthorized })

  const filesShown = unpaid.bags.length + openContracts(contracts.list, contracts.hideClosed).length

  const openProvider = useMemo(() => {
    if (openProviderKey === null) return null
    const needle = openProviderKey.toLowerCase()
    return catalog.providers.find((provider) => provider.pubkey.toLowerCase() === needle) ?? null
  }, [catalog.providers, openProviderKey])

  const walletGate = (
    <>
      {authError && (
        <Notice tone="red" className={styles.authError}>
          {t(authError)}
        </Notice>
      )}
      <EmptyState
        role="status"
        title={t("errors.walletNotConnected")}
        hint={t("errors.connectWallet")}
        className={styles.gate}
      />
    </>
  )

  const choosing = connected && tab === "upload" && wizard.step === 2
  const globeProviders = useMemo(() => {
    if (!choosing) return catalog.providers
    const picked = new Set(wizard.data.selected.map((key) => key.toLowerCase()))
    return catalog.providers.filter((provider) => picked.has(provider.pubkey.toLowerCase()))
  }, [choosing, catalog.providers, wizard.data.selected])

  return (
    <UiProvider labels={locales[lang].ui}>
      <SitePage
        header={<Header dark={dark} onToggleTheme={toggle} />}
        footer={<Footer />}
        title={t("hero.title")}
        subtitle={
          <>
            {t("hero.sub")}{" "}
            <span className={styles.heroSubPlace}>
              {t("hero.place")}.{" "}
              <button type="button" onClick={() => setAboutOpen(true)} className={styles.heroMore}>
                {t("hero.more")}
              </button>
            </span>
          </>
        }
      >
        {pendingWallet && <SectionTabsRoom />}

        {connected && (
          <SectionTabs
            tabs={TABS}
            items={[
              { key: "upload", label: t("nav.upload"), icon: Upload, open: true },
              { key: "files", label: t("nav.files"), icon: Folder, badge: filesShown > 0 ? String(filesShown) : undefined },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}

        <Globe providers={globeProviders} ready={!catalog.loading} words={globeWords[lang]} />

        {connected ? (
          <TabPanel tabs={TABS} value={tab} order={TAB_ORDER} className={styles.stage}>
            <div hidden={tab !== "upload"}>
              <WizardStage
                wizard={wizard}
                catalog={catalog}
                copied={copied}
                onCopy={onCopy}
                onOpenProvider={setOpenProviderKey}
                onFinish={() => {
                  wizard.reset()
                  setTab("files")
                }}
              />
            </div>
            <div hidden={tab !== "files"}>
              <FilesStage
                key={address}
                unpaid={unpaid}
                contracts={contracts}
                catalog={catalog}
                copied={copied}
                onCopy={onCopy}
                onOpenProvider={setOpenProviderKey}
                onResumeBag={(bag) => {
                  wizard.resumeBag(bag)
                  setTab("upload")
                }}
                onRemoveBag={(bagId) =>
                  void unpaid.remove(bagId).then((removed) => {
                    if (removed) wizard.forgetBag(bagId)
                  })
                }
              />
            </div>
          </TabPanel>
        ) : pendingWallet ? null : (
          walletGate
        )}

        <Sheet
          open={openProviderKey !== null}
          title={t("provider.title")}
          lead={openProviderKey !== null && <ShortId value={openProviderKey} />}
          onClose={() => setOpenProviderKey(null)}
        >
          {openProviderKey !== null && (
            <ProviderDetails
              provider={openProvider ?? stubOf(openProviderKey)}
              unlisted={openProvider === null}
              catalogReady={!catalog.loading && !catalog.failed}
              fetchedAt={catalog.fetchedAt}
              copied={copied}
              onCopy={onCopy}
            />
          )}
        </Sheet>

        <Sheet open={aboutOpen} prose title={t("about.title")} onClose={() => setAboutOpen(false)}>
          <HowItWorks />
        </Sheet>

        <UploadGateSheet
          bag={wizard.gateBag}
          freeStorageSeconds={unpaid.freeStorageSeconds}
          onClose={wizard.closeGate}
          onReplace={wizard.replaceGateBag}
          onResume={wizard.resumeGateBag}
        />
      </SitePage>
    </UiProvider>
  )
}
