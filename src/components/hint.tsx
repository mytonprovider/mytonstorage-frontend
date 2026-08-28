import { useCallback, useEffect, useRef } from "react"
import type { MouseEvent } from "react"
import { clampToViewport } from "@/lib/dom"
import shared from "./shared.module.css"

const GAP = 9

interface HintProps {
  text: string
  focusable?: boolean
  open?: boolean
}

export const Hint = ({ text, focusable = true, open }: HintProps) => {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)

  const hide = useCallback(() => {
    const pop = popRef.current
    if (pop?.matches(":popover-open")) pop.hidePopover()
  }, [])

  const show = useCallback(() => {
    const wrap = wrapRef.current
    const pop = popRef.current
    if (!wrap || !pop) return
    if (!pop.matches(":popover-open")) pop.showPopover()
    const rect = wrap.getBoundingClientRect()
    const left = rect.left + rect.width / 2 - pop.offsetWidth / 2
    pop.style.left = `${clampToViewport(left, pop.offsetWidth)}px`
    pop.style.top = `${rect.bottom + GAP}px`
    window.addEventListener("scroll", hide, { once: true, capture: true })
  }, [hide])

  useEffect(() => {
    if (open === undefined) return
    if (open) show()
    else hide()
  }, [open, show, hide])

  useEffect(() => () => window.removeEventListener("scroll", hide, { capture: true }), [hide])

  const tap = (event: MouseEvent) => {
    event.stopPropagation()
    show()
  }

  return (
    <span
      ref={wrapRef}
      tabIndex={focusable ? 0 : undefined}
      aria-label={focusable ? text : undefined}
      aria-hidden={focusable ? undefined : true}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={tap}
      className={shared.hint}
    >
      <span aria-hidden="true" className={shared.hintGlyph}>?</span>
      <span ref={popRef} popover="auto" className={shared.hintPop}>
        {text}
      </span>
    </span>
  )
}
