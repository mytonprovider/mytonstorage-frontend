import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

const MOBILE = "(max-width: 1119px)"
const INTERACTIVE = "button, a, input, select, textarea, summary"
const CLOSE_SHARE = 0.25
const LIFT_SHARE = 0.04
const FLING_SPEED = 0.5
const RUBBER_BAND = 0.3

interface Drag {
  pointer: number
  startY: number
  height: number
  lastY: number
  lastAt: number
  speed: number
}

interface SheetDrag {
  dragging: boolean
  offset: number | null
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  bodyRef: (node: HTMLDivElement | null) => void
}

export const useSheetDrag = (open: boolean, onClose: () => void): SheetDrag => {
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState<number | null>(null)

  const drag = useRef<Drag | null>(null)
  const body = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) return
    drag.current = null
    setDragging(false)
    setOffset(null)
  }, [open])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !window.matchMedia(MOBILE).matches) return

    const target = event.target as HTMLElement
    const sheet = event.currentTarget.closest("dialog")
    const scrolling = body.current?.contains(target) && body.current.scrollTop > 0
    if (!sheet || scrolling || target.closest(INTERACTIVE)) return

    drag.current = {
      pointer: event.pointerId,
      startY: event.clientY,
      height: sheet.getBoundingClientRect().height,
      lastY: event.clientY,
      lastAt: event.timeStamp,
      speed: 0,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const active = drag.current
      if (active?.pointer !== event.pointerId) return

      const elapsed = event.timeStamp - active.lastAt
      if (elapsed > 0) active.speed = (event.clientY - active.lastY) / elapsed
      active.lastY = event.clientY
      active.lastAt = event.timeStamp

      const moved = event.clientY - active.startY
      setOffset(moved < 0 ? Math.max(moved * RUBBER_BAND, -active.height * LIFT_SHARE) : moved)
    }

    const end = (event: globalThis.PointerEvent) => {
      const active = drag.current
      if (active?.pointer !== event.pointerId) return
      drag.current = null

      setDragging(false)
      setOffset(null)

      const moved = event.clientY - active.startY
      if (active.speed > FLING_SPEED || moved > active.height * CLOSE_SHARE) onClose()
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
  }, [onClose])

  const bodyRef = useCallback((node: HTMLDivElement | null) => {
    body.current = node
  }, [])

  return { dragging, offset, onPointerDown, bodyRef }
}
