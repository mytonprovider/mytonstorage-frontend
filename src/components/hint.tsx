import { useCallback, useEffect, useId, useRef } from "react"
import type { MouseEvent, ReactNode } from "react"
import { CircleHelp } from "lucide-react"
import { cx } from "@/lib/cx"
import { clampToViewport } from "@/lib/dom"
import shared from "./shared.module.css"

const GAP = 9

interface HintProps {
  text: string
  focusable?: boolean
  open?: boolean
  className?: string
  children?: ReactNode
}

export const Hint = ({ text, focusable = true, open, className, children }: HintProps) => {
  const id = useId()
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
      aria-label={focusable && !children ? text : undefined}
      aria-describedby={children ? id : undefined}
      aria-hidden={focusable ? undefined : true}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={tap}
      className={cx(children ? shared.hintLabel : shared.hint, className)}
    >
      {children ?? <CircleHelp aria-hidden="true" className={shared.hintIcon} />}
      <span id={children ? id : undefined} ref={popRef} role="tooltip" popover="auto" className={shared.hintPop}>
        {text}
      </span>
    </span>
  )
}
