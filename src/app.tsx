import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useContracts } from "@/lib/contracts"
import { useCopyFeedback } from "@/lib/dom"
import { stubOf, useProviderCatalog } from "@/lib/providers"
import { useSession, walletExpected } from "@/lib/session"
import { useTheme } from "@/lib/theme"
import { useUnpaidBags } from "@/lib/unpaid-bags"
import { useWizardFlow } from "@/lib/wizard"
import { BackToTop } from "@/components/back-to-top"
import { visibleContracts } from "@/components/contracts/contracts-list"
import { FilesStage } from "@/components/files/files-stage"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { Notice } from "@/components/notice"
import { ProviderDetails } from "@/components/providers/provider-details"
import { Sheet } from "@/components/sheet"
import { Tabs, tabId, tabPanelId } from "@/components/tabs"
import { UploadGateSheet } from "@/components/wizard/upload-gate-sheet"
import { WizardStage } from "@/components/wizard/wizard-stage"
import shared from "@/components/shared.module.css"
import styles from "./app.module.css"

type Tab = "upload" | "files"

export const App = () => {
  const { t } = useTranslation()
  const { dark, toggle } = useTheme()
  const { restored, address, authorized, authError, signOut } = useSession(dark)
  const connected = restored && address !== ""
  const pendingWallet = !restored && walletExpected

  const [tab, setTab] = useState<Tab>("upload")
  const [openProviderKey, setOpenProviderKey] = useState<string | null>(null)

  const catalog = useProviderCatalog()
  const { copied, copy } = useCopyFeedback()
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

  const filesShown = unpaid.bags.length + visibleContracts(contracts.list, contracts.hideClosed).length

  const openProvider = useMemo(() => {
    if (openProviderKey === null) return null
    const needle = openProviderKey.toLowerCase()
    return catalog.providers.find((provider) => provider.pubkey.toLowerCase() === needle) ?? null
  }, [catalog.providers, openProviderKey])

  const walletGate = (
    <div role="status" className={styles.gate}>
      {authError && (
        <Notice tone="red" className={styles.authError}>
          {t(authError)}
        </Notice>
      )}
      <p>{t("errors.walletNotConnected")}</p>
      <p className={shared.emptyHint}>{t("errors.connectWallet")}</p>
    </div>
  )

  return (
    <div className={styles.shell}>
      <Header dark={dark} onToggleTheme={toggle} />

      <main id="top" tabIndex={-1} className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.heroTitle}>{t("hero.title")}</h1>
          <p className={styles.heroSub}>{t("hero.sub")}</p>
        </div>

        {pendingWallet && <div aria-hidden="true" className={styles.tabs} />}

        {connected && (
          <nav className={styles.tabs}>
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                { value: "upload", label: t("nav.upload") },
                { value: "files", label: t("nav.files"), badge: filesShown > 0 ? String(filesShown) : undefined },
              ]}
            />
          </nav>
        )}

        {connected ? (
          <div id={tabPanelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)} className={styles.stage}>
            {tab === "upload" ? (
              <WizardStage
                wizard={wizard}
                catalog={catalog}
                copied={copied}
                onCopy={copy}
                onOpenProvider={setOpenProviderKey}
                onFinish={() => {
                  wizard.reset()
                  setTab("files")
                }}
              />
            ) : (
              <FilesStage
                key={address}
                unpaid={unpaid}
                contracts={contracts}
                catalog={catalog}
                copied={copied}
                onCopy={copy}
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
            )}
          </div>
        ) : pendingWallet ? (
          <div className={styles.gate} />
        ) : (
          walletGate
        )}
      </main>

      <BackToTop />

      <Footer />

      <Sheet open={openProviderKey !== null} title={t("provider.title")} onClose={() => setOpenProviderKey(null)}>
        {openProviderKey !== null && (
          <ProviderDetails
            provider={openProvider ?? stubOf(openProviderKey)}
            unlisted={openProvider === null}
            catalogReady={!catalog.loading && !catalog.failed}
            fetchedAt={catalog.fetchedAt}
            copied={copied}
            onCopy={copy}
          />
        )}
      </Sheet>

      <UploadGateSheet
        bag={wizard.gateBag}
        freeStorageSeconds={unpaid.freeStorageSeconds}
        onClose={wizard.closeGate}
        onReplace={wizard.replaceGateBag}
        onResume={wizard.resumeGateBag}
      />
    </div>
  )
}
