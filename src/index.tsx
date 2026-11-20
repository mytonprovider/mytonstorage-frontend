import "@myton/ui/fonts.css"
import "@myton/ui/styles.css"
import "@myton/ui/site.css"
import "@/styles/tokens.css"

import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { TonConnectUIProvider } from "@tonconnect/ui-react"
import { initI18n } from "@/i18n"
import { migrateStored } from "@/lib/local-storage"
import { App } from "@/app"

initI18n()
migrateStored()

const manifestUrl =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL ||
  `${import.meta.env.VITE_SITE_URL || window.location.origin}/tonconnect-manifest.json`

const root = document.getElementById("root")
if (root) {
  ReactDOM.createRoot(root).render(
    <StrictMode>
      <TonConnectUIProvider manifestUrl={manifestUrl}>
        <App />
      </TonConnectUIProvider>
    </StrictMode>,
  )
}
