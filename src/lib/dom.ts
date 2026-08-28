import { useCallback, useEffect, useRef, useState, type UIEvent } from "react"

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches

export const scrollToTop = (): void => {
  window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" })
}

const copyText = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const host = document.querySelector("dialog[open]") ?? document.body
    const area = document.createElement("textarea")
    area.value = value
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.opacity = "0"
    host.append(area)
    area.select()

    let done = false
    try {
      done = document.execCommand("copy")
    } catch {
      done = false
    }

    area.remove()
    return done
  }
}

export const VIEWPORT_EDGE = 8

export const clampToViewport = (left: number, width: number): number =>
  Math.min(Math.max(left, VIEWPORT_EDGE), window.innerWidth - width - VIEWPORT_EDGE)

export const nearBottom = (box: Element, ahead: number): boolean =>
  box.scrollTop + box.clientHeight >= box.scrollHeight - ahead

export const onScrollNearBottom = (ahead: number, action: () => void) => (event: UIEvent<HTMLElement>) => {
  if (nearBottom(event.currentTarget, ahead)) action()
}

const FEEDBACK_MS = 1200

interface CopyFeedback {
  copied: string | null
  copy: (value: string) => void
}

export const useCopyFeedback = (): CopyFeedback => {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const copy = useCallback((value: string) => {
    void copyText(value)
    setCopied(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(null), FEEDBACK_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return { copied, copy }
}
