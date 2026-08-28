import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TonConnectUIError, UserRejectsError } from "@tonconnect/ui-react"
import en from "@/i18n/en.json"
import { ApiError } from "./api"
import { writePendingPaid } from "./paid-link"
import {
  EMPTY_WIZARD,
  UNAUTHORIZED,
  allAccepted,
  checkErrorKey,
  clampStep,
  contractAfterFailure,
  deployAction,
  deployFailureKey,
  deployInFlight,
  payErrorKey,
  payErrorTone,
  reachedStep,
  resumedContract,
  uploadErrorKey,
} from "./wizard"
import type { WizardData } from "./wizard"

const BAG = "a".repeat(64)

const withData = (patch: Partial<WizardData>): WizardData => ({ ...EMPTY_WIZARD, ...patch })

const line = (key: string): string | undefined => {
  const [section, name] = key.split(".")
  return (en as unknown as Record<string, Record<string, string>>)[section]?.[name]
}

describe("reachedStep", () => {
  it("stays on upload until a bag id comes back from the backend", () => {
    expect(reachedStep(EMPTY_WIZARD, false)).toBe(1)
    expect(reachedStep(withData({ description: "backup" }), false)).toBe(1)
  })

  it("rejects a bag id that is not 64 characters", () => {
    expect(reachedStep(withData({ bagId: "abc" }), false)).toBe(1)
  })

  it("opens provider selection once the bag exists", () => {
    expect(reachedStep(withData({ bagId: BAG }), false)).toBe(2)
  })

  it("opens the period step only once the selected providers have quoted the bag", () => {
    expect(reachedStep(withData({ bagId: BAG, selected: ["key"] }), true)).toBe(3)
    expect(reachedStep(withData({ bagId: BAG, selected: ["key"] }), false)).toBe(2)
  })

  it("requires both the deployed contract and the paid flag to finish", () => {
    expect(reachedStep(withData({ bagId: BAG, selected: ["key"], contractAddress: "EQ" }), true)).toBe(3)
    expect(reachedStep(withData({ bagId: BAG, selected: ["key"], paid: true }), true)).toBe(3)
    expect(reachedStep(withData({ bagId: BAG, selected: ["key"], contractAddress: "EQ", paid: true }), false)).toBe(4)
  })

  it("falls back to upload when the bag is dropped, whatever else is set", () => {
    expect(reachedStep(withData({ selected: ["key"], contractAddress: "EQ", paid: true }), true)).toBe(1)
  })
})

describe("allAccepted", () => {
  const quoted = (key: string) => ({ price_per_proof: 120_000_000, price_per_mb: 0, provider: { key, price_per_mb_day: 0 } })
  const refused = (key: string) => ({ provider_key: key, reason: "not enough space" })

  it("carries the whole set forward, the same verdict that opens the period step", () => {
    const accepted = allAccepted([quoted("a"), quoted("b")], [], ["a", "b"])

    expect(accepted).toBe(true)
    expect(reachedStep(withData({ bagId: BAG, selected: ["a", "b"] }), accepted)).toBe(3)
  })

  it("holds the step when one refused, however many of the others quoted", () => {
    const accepted = allAccepted([quoted("a")], [refused("b")], ["a", "b"])

    expect(accepted).toBe(false)
    expect(reachedStep(withData({ bagId: BAG, selected: ["a", "b"] }), accepted)).toBe(2)
  })

  it("holds the step on a short answer nobody refused, since a missing quote is not a price", () => {
    expect(allAccepted([quoted("a")], [], ["a", "b"])).toBe(false)
  })

  it("treats an empty answer as no quote at all, so nothing is sent for zero offers", () => {
    expect(allAccepted([], [], [])).toBe(false)
    expect(allAccepted([], [], ["a"])).toBe(false)
  })
})

describe("deployInFlight", () => {
  it("hands back the contract of a deploy already sent, so a retry checks it instead of paying again", () => {
    expect(deployInFlight(withData({ bagId: BAG, contractAddress: "EQCONTRACT" }))).toBe("EQCONTRACT")
  })

  it("has nothing to check before the first deploy and after the bag is linked", () => {
    expect(deployInFlight(withData({ bagId: BAG }))).toBe(null)
    expect(deployInFlight(withData({ bagId: BAG, contractAddress: "EQCONTRACT", paid: true }))).toBe(null)
  })
})

describe("resumedContract", () => {
  const fakeStorage = () => {
    const bag = new Map<string, string>()
    return {
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => void bag.set(key, value),
      removeItem: (key: string) => void bag.delete(key),
    }
  }

  beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it("recalls the contract the pending mark wrote for this bag, so the first click after a reload asks the chain", () => {
    writePendingPaid(BAG, "EQCONTRACT")

    expect(resumedContract(BAG)).toBe("EQCONTRACT")
    expect(deployInFlight(withData({ bagId: BAG, contractAddress: resumedContract(BAG) }))).toBe("EQCONTRACT")
  })

  it("leaves only the silent chain unresolved after a reload: missing resends, deployed relinks, unknown sends nothing", () => {
    writePendingPaid(BAG, "EQCONTRACT")
    const started = deployInFlight(withData({ bagId: BAG, contractAddress: resumedContract(BAG) }))

    expect(started).toBe("EQCONTRACT")
    expect(deployAction("missing")).toBe("send")
    expect(deployAction("deployed")).toBe("link")
    expect(deployAction("unknown")).toBe("wait")
    expect(checkErrorKey("unknown")).toBe("errors.paymentUnchecked")
    expect(payErrorTone(checkErrorKey("unknown"))).toBe("neutral")
  })

  it("leaves the reload with nothing to check when the browser refused the mark, the loss the unsaved warning is about", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError")
      },
      removeItem: () => undefined,
    })

    expect(writePendingPaid(BAG, "EQCONTRACT", "EQOWNER", "backup", 42)).toBe(false)
    expect(resumedContract(BAG)).toBe(null)
    expect(deployInFlight(withData({ bagId: BAG, contractAddress: resumedContract(BAG) }))).toBe(null)
    expect(payErrorTone("errors.linkNotSaved")).toBe("red")
  })

  it("keeps the relink the backend refused after a reload as loud as a fresh one, since the money is already spent", () => {
    writePendingPaid(BAG, "EQCONTRACT")
    const started = deployInFlight(withData({ bagId: BAG, contractAddress: resumedContract(BAG) }))

    expect(started).toBe("EQCONTRACT")
    expect(deployAction("deployed")).toBe("link")
    expect(deployFailureKey(true, new ApiError(500, "POST", "/api/v1/files/paid", "server error"))).toBe("errors.notLinked")
  })

  it("resumes a bag the mark does not point at with no contract, whatever an older payment left behind", () => {
    writePendingPaid("b".repeat(64), "EQOTHER")

    expect(resumedContract(BAG)).toBe(null)
  })

  it("starts clean when nothing was marked", () => {
    expect(resumedContract(BAG)).toBe(null)
  })
})

describe("contractAfterFailure", () => {
  it("drops the contract the wallet refused to pay for: nothing was signed, the next click deploys again", () => {
    expect(contractAfterFailure("EQCONTRACT", new UserRejectsError())).toBe(null)
    expect(deployInFlight(withData({ bagId: BAG, contractAddress: null }))).toBe(null)
  })

  it("keeps the contract when the ui layer failed without the user refusing anything", () => {
    const kept = contractAfterFailure("EQCONTRACT", new TonConnectUIError("modal closed"))

    expect(kept).toBe("EQCONTRACT")
    expect(deployInFlight(withData({ bagId: BAG, contractAddress: kept }))).toBe("EQCONTRACT")
  })

  it("keeps the contract of a deploy that merely went unconfirmed, so no second one is created", () => {
    expect(contractAfterFailure("EQCONTRACT", new Error("not confirmed"))).toBe("EQCONTRACT")
    expect(contractAfterFailure("EQCONTRACT", new TypeError("Failed to fetch"))).toBe("EQCONTRACT")
    expect(deployInFlight(withData({ bagId: BAG, contractAddress: "EQCONTRACT" }))).toBe("EQCONTRACT")
  })
})

describe("deployAction", () => {
  it("links the bag instead of paying again once the chain shows the contract", () => {
    expect(deployAction("deployed")).toBe("link")
  })

  it("builds the payment anew when the chain says no contract is there", () => {
    expect(deployAction("missing")).toBe("send")
  })

  it("sends nothing while the chain has not answered, instead of paying on a guess", () => {
    expect(deployAction("unknown")).toBe("wait")
  })

  it("checks the address of a deploy that merely went unconfirmed before any money moves again", () => {
    const kept = contractAfterFailure("EQCONTRACT", new Error("not confirmed"))
    const started = deployInFlight(withData({ bagId: BAG, contractAddress: kept }))

    expect(started).toBe("EQCONTRACT")
    expect(deployAction("deployed")).toBe("link")
  })
})

describe("payErrorKey", () => {
  it("reads the refusal over silent providers as an incomplete quote, not a failed payment", () => {
    const refused = new ApiError(400, "POST", "/api/v1/contracts/init-contract", "some providers unavailable")

    expect(payErrorKey(refused)).toBe("errors.offersIncomplete")
    expect(line(payErrorKey(refused))).toBe(en.errors.offersIncomplete)
  })

  it("has no key of its own for an ended session, the reason the payment catches it before this key is read", () => {
    expect(payErrorKey(new ApiError(401, "POST", "/api/v1/contracts/init-contract", "unauthorized"))).toBe("errors.paymentFailed")
  })

  it("keeps every other 400 a failed payment", () => {
    expect(payErrorKey(new ApiError(400, "POST", "/api/v1/contracts/init-contract", "invalid address"))).toBe("errors.paymentFailed")
  })

  it("keeps the same refusal a failed payment outside the wizard, where no quote exists to reset", () => {
    const refused = new ApiError(400, "POST", "/api/v1/contracts/update", "some providers unavailable")

    expect(payErrorKey(refused, { withBag: false })).toBe("errors.paymentFailed")
  })
})

describe("deployFailureKey", () => {
  it("stays silent when the wallet refused, recognized by the class and not the text", () => {
    expect(deployFailureKey(false, new UserRejectsError())).toBe(null)
  })

  it("keeps the unlinked bag loud once the payment already went through", () => {
    expect(deployFailureKey(true, new Error("link failed"))).toBe("errors.notLinked")
  })

  it("maps any other failure the way the payment key always travelled", () => {
    const refused = new ApiError(429, "POST", "/api/v1/contracts/init-contract", "too many requests")

    expect(deployFailureKey(false, refused)).toBe("errors.rateLimited")
    expect(deployFailureKey(false, new Error("not confirmed"))).toBe("errors.paymentFailed")
  })
})

describe("checkErrorKey", () => {
  it("says the transaction was not confirmed only when the chain answered that no contract is there", () => {
    expect(checkErrorKey("missing")).toBe("errors.paymentFailed")
  })

  it("claims nothing about the money when the chain could not be asked", () => {
    expect(checkErrorKey("unknown")).toBe("errors.paymentUnchecked")
  })
})

describe("payErrorTone", () => {
  it("stays neutral while the chain has not answered, since nothing failed yet", () => {
    expect(payErrorTone(checkErrorKey("unknown"))).toBe("neutral")
  })

  it("turns red once the chain reported no contract, which is a real failed payment", () => {
    expect(payErrorTone(checkErrorKey("missing"))).toBe("red")
    expect(payErrorTone("errors.notLinked")).toBe("red")
  })

  it("keeps the confirmation timeout neutral, since the signed transaction may still land", () => {
    expect(payErrorTone("errors.confirmTimeout")).toBe("neutral")
  })
})

describe("UNAUTHORIZED", () => {
  it("hands the end of the session over as a key, so the message follows a language switch", () => {
    expect(line(UNAUTHORIZED)).toBe(en.errors.unauthorized)
  })
})

describe("uploadErrorKey", () => {
  it("hands the upload failure over as a key the dictionary knows, the shape the payment failure already travels in", () => {
    const refused = new ApiError(429, "POST", "/api/v1/upload", "too many requests")

    expect(uploadErrorKey(refused)).toBe(payErrorKey(refused))
    expect(line(uploadErrorKey(refused))).toBe(en.errors.rateLimited)
  })
})

describe("clampStep", () => {
  it("keeps the view between the first step and what the data supports, allowing steps back", () => {
    expect(clampStep(4, 2)).toBe(2)
    expect(clampStep(1, 3)).toBe(1)
    expect(clampStep(0, 3)).toBe(1)
  })
})
