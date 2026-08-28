import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import "@/styles/global.css"

import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { TonConnectUIProvider } from "@tonconnect/ui-react"
import { initI18n } from "@/i18n"
import { App } from "@/app"

initI18n()

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
