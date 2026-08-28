import { describe, expect, it } from "vitest"
import { toNonBounceable } from "./ton-address"

const BOUNCEABLE = "EQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljMwB"
const NON_BOUNCEABLE = "UQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljJHE"

describe("toNonBounceable", () => {
  it("rewrites a bounceable address into the user-friendly form", () => {
    expect(toNonBounceable(BOUNCEABLE)).toBe(NON_BOUNCEABLE)
  })

  it("keeps an address that is already non-bounceable", () => {
    expect(toNonBounceable(NON_BOUNCEABLE)).toBe(NON_BOUNCEABLE)
  })

  it("keeps the testnet flag while swapping the tag", () => {
    expect(toNonBounceable("kQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljHeL")).toBe(
      "0QAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljCpO",
    )
  })

  it("leaves anything that is not a user-friendly address untouched", () => {
    const raw = "0:2346133cda82f6663a6ee14db18c182397aa6fe96cabeb03e719374b7eb0e58c"
    expect(toNonBounceable(raw)).toBe(raw)
    expect(toNonBounceable("")).toBe("")
    expect(toNonBounceable("EQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljAAA")).toBe(
      "EQAjRhPNqC9mY2muFNsYwYI5eqb-lsq-sD5xk3SLfrDljAAA",
    )
  })
})
