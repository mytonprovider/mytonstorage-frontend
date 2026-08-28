import { useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { THEME_KEY, readStored, writeStored } from "./local-storage"
import { reducedMotion } from "./dom"

type Theme = "dark" | "light"

const SPREAD_MS = 320

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

const spreadFrom = (origin: DOMRect, change: () => void): void => {
  if (reducedMotion() || typeof document.startViewTransition !== "function") {
    change()
    return
  }

  const x = origin.left + origin.width / 2
  const y = origin.top + origin.height / 2
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))

  document
    .startViewTransition(change)
    .ready.then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: SPREAD_MS, easing: "ease-out", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => undefined)
}

export const useTheme = (): { dark: boolean; toggle: (origin: DOMRect) => void } => {
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

  const toggle = (origin: DOMRect) => {
    const next: Theme = theme === "dark" ? "light" : "dark"

    writeStored(THEME_KEY, next)
    spreadFrom(origin, () =>
      flushSync(() => {
        apply(next)
        setTheme(next)
      }),
    )
  }

  return { dark: theme === "dark", toggle }
}
