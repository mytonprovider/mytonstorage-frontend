import { useEffect, useRef } from "react"

const focusClaimed = (): boolean => document.activeElement instanceof HTMLElement && document.activeElement.tabIndex >= 0

export const useDismiss = (open: boolean, onDismiss: () => void): void => {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest("[data-menuroot]")) return
      dismiss.current()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss.current()
    }

    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown)
      const trigger = opener.current
      requestAnimationFrame(() => {
        if (!focusClaimed()) trigger?.focus()
      })
    }
  }, [open])
}
