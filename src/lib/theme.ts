import { useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { THEME_KEY, readStored, writeStored } from "./local-storage"
import { reducedMotion } from "./dom"

type Theme = "dark" | "light"

const currentTheme = (): Theme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light")

const apply = (theme: Theme): void => {
  const root = document.documentElement
  root.setAttribute("data-theme-switching", "")
  root.setAttribute("data-theme", theme)
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")))

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta instanceof HTMLMetaElement) {
    meta.content = getComputedStyle(root).getPropertyValue("--bg").trim()
  }
}

const crossfade = (change: () => void): void => {
  if (reducedMotion() || typeof document.startViewTransition !== "function") {
    change()
    return
  }

  document.startViewTransition(change)
}

export const useTheme = (): { dark: boolean; toggle: () => void } => {
  const [theme, setTheme] = useState<Theme>(currentTheme)

  useEffect(() => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)")

    const onScheme = () => {
      if (readStored(THEME_KEY)) return
      const next: Theme = scheme.matches ? "dark" : "light"
      apply(next)
      setTheme(next)
    }

    scheme.addEventListener("change", onScheme)
    return () => scheme.removeEventListener("change", onScheme)
  }, [])

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark"

    writeStored(THEME_KEY, next)
    crossfade(() =>
      flushSync(() => {
        apply(next)
        setTheme(next)
      }),
    )
  }

  return { dark: theme === "dark", toggle }
}
