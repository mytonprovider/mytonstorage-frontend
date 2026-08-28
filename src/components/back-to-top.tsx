import { useEffect, useState } from "react"
import { ArrowUp } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { scrollToTop } from "@/lib/dom"
import styles from "./back-to-top.module.css"

const SHOW_AFTER_PX = 320
const TAIL_PX = 240

export const BackToTop = () => {
  const { t } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const [tailNear, setTailNear] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SHOW_AFTER_PX)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const footer = document.querySelector("footer")
    if (!footer) return

    const observer = new IntersectionObserver(([entry]) => setTailNear(entry?.isIntersecting ?? false), {
      rootMargin: `0px 0px ${TAIL_PX}px`,
    })
    observer.observe(footer)
    return () => observer.disconnect()
  }, [])

  const shown = scrolled && !tailNear

  return (
    <button
      type="button"
      onClick={() => {
        scrollToTop()
        document.getElementById("top")?.focus()
      }}
      title={t("ui.goUp")}
      aria-label={t("ui.goUp")}
      aria-hidden={shown ? undefined : true}
      tabIndex={shown ? undefined : -1}
      className={cx(styles.button, shown && styles.shown)}
    >
      <ArrowUp className={styles.icon} aria-hidden="true" />
    </button>
  )
}
