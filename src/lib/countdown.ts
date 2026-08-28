import { useEffect, useState } from "react"
import { nowSeconds } from "./format"

const WARN_SECONDS = 300

type CountdownTone = "calm" | "soon" | "over"

export const countdownTone = (left: number): CountdownTone =>
  left === 0 ? "over" : left < WARN_SECONDS ? "soon" : "calm"

const secondsLeft = (deadline: number): number => Math.max(0, deadline - nowSeconds())

export const useCountdown = (deadline: number): number => {
  const [left, setLeft] = useState(() => secondsLeft(deadline))

  useEffect(() => {
    const start = secondsLeft(deadline)
    setLeft(start)
    if (start === 0) return

    const timer = setInterval(() => {
      const next = secondsLeft(deadline)
      setLeft(next)
      if (next === 0) clearInterval(timer)
    }, 1000)

    return () => clearInterval(timer)
  }, [deadline])

  return left
}
