import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { THEME, TonConnect, useIsConnectionRestored, useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react"
import { pickLang } from "@myton/ui/i18n"
import { clearWalletCaches } from "./contracts-cache"
import { fetchTonProofPayload, login } from "./api"

const STORED_CONNECTION_KEY = "ton-connect-storage_bridge-connection"

// TON Connect makes its own rgba() of a colour and reads only hex (hexToRgb in @tonconnect/ui), so it gets the tokens
// that resolve to hex in both themes; the rest keep its defaults.
const walletColors = () => {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(name).trim()
  return {
    accent: token("--accent"),
    telegramButton: token("--btn"),
    background: { primary: token("--surface"), secondary: token("--bg"), segment: token("--field-fill") },
    text: { primary: token("--text"), secondary: token("--text-2") },
    icon: {
      primary: token("--text"),
      secondary: token("--text-2"),
      success: token("--tone-green"),
      error: token("--btn-danger"),
    },
  }
}

const readStoredConnection = (): boolean => {
  try {
    const stored = window.localStorage.getItem(STORED_CONNECTION_KEY)
    if (!stored) return false
    const connection = JSON.parse(stored) as { type?: string; jsBridgeKey?: string; connectEvent?: unknown }
    if (connection.type === "injected") return TonConnect.isWalletInjected(connection.jsBridgeKey ?? "")
    return "connectEvent" in connection
  } catch {
    return false
  }
}

export const walletExpected = readStoredConnection()

interface Session {
  restored: boolean
  address: string
  authorized: boolean
  authError: string | null
  signOut: () => void
}

export const useSession = (dark: boolean): Session => {
  const { i18n } = useTranslation()
  const [tonConnectUI] = useTonConnectUI()
  const wallet = useTonWallet()
  const restored = useIsConnectionRestored()
  const address = useTonAddress()

  useEffect(() => {
    tonConnectUI.uiOptions = {
      language: pickLang(i18n.language),
      uiPreferences: {
        theme: dark ? THEME.DARK : THEME.LIGHT,
        borderRadius: "m",
        colorsSet: { [dark ? THEME.DARK : THEME.LIGHT]: walletColors() },
      },
    }
  }, [tonConnectUI, i18n.language, dark])

  useEffect(() => {
    tonConnectUI.setConnectRequestParameters({ state: "loading" })
    fetchTonProofPayload()
      .then((payload) => tonConnectUI.setConnectRequestParameters({ state: "ready", value: { tonProof: payload } }))
      .catch(() => tonConnectUI.setConnectRequestParameters(null))
  }, [tonConnectUI])

  const knownOwner = useRef("")

  useEffect(() => {
    if (knownOwner.current && !address) clearWalletCaches()
    knownOwner.current = address
  }, [address])

  const [authorized, setAuthorized] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    if (!wallet) {
      setAuthorized(false)
      return
    }

    setAuthError(null)

    const proof = wallet.connectItems?.tonProof
    if (!proof || !("proof" in proof)) {
      setAuthorized(true)
      return
    }

    login({ address: wallet.account.address, proof: proof.proof, state_init: wallet.account.walletStateInit ?? "" })
      .then(() => setAuthorized(true))
      .catch(() => {
        setAuthError("errors.loginFailed")
        void tonConnectUI.disconnect()
      })
  }, [wallet, tonConnectUI])

  const signOut = useCallback(() => void tonConnectUI.disconnect(), [tonConnectUI])

  return { restored, address, authorized, authError, signOut }
}
