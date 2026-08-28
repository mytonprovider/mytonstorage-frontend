import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { THEME, TonConnect, useIsConnectionRestored, useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react"
import { clearWalletCaches } from "./contracts-cache"
import { fetchTonProofPayload, login } from "./api"

const STORED_CONNECTION_KEY = "ton-connect-storage_bridge-connection"

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
      language: i18n.language === "ru" ? "ru" : "en",
      uiPreferences: {
        theme: dark ? THEME.DARK : THEME.LIGHT,
        borderRadius: "s",
        colorsSet: {
          [THEME.LIGHT]: { connectButton: { background: "#0072b3", foreground: "#ffffff" }, accent: "#0098ea" },
          [THEME.DARK]: { connectButton: { background: "#0072b3", foreground: "#ffffff" }, accent: "#5cc4f7" },
        },
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
