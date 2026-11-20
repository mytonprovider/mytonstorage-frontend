import { useEffect, useState } from "react"

export const nearBottom = (box: Element, ahead: number): boolean =>
  box.scrollTop + box.clientHeight >= box.scrollHeight - ahead

export const useScrollbarGutter = (): [string | undefined, (box: HTMLElement | null) => void] => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const [gutter, setGutter] = useState<string>()

  useEffect(() => {
    if (!box) return
    const measure = () => setGutter(`${box.offsetWidth - box.clientWidth}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [box])

  return [gutter, setBox]
}
