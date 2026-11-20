import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TonConnectUIError, UserRejectsError } from "@tonconnect/ui-react"
import en from "@/i18n/en.json"
import { ApiError } from "./api"
import { writePendingPaid, type DeployCheck } from "./paid-link"
import { UNAUTHORIZED, checkErrorKey, deployFailureKey, payErrorKey, payErrorTone, uploadErrorKey, uploadFailure } from "./errors"
import {
  EMPTY_WIZARD,
  allAccepted,
  clampStep,
  contractAfterFailure,
  deployAction,
  deployInFlight,
  reachedStep,
  resumedContract,
} from "./wizard"
import type { WizardData } from "./wizard"

const BAG = "a".repeat(64)

const withData = (patch: Partial<WizardData>): WizardData => ({ ...EMPTY_WIZARD, ...patch })

const line = (key: string): string | undefined => {
  const [section, name] = key.split(".")
  return (en as unknown as Record<string, Record<string, string>>)[section]?.[name]
}

describe("reachedStep", () => {
  it.each([
    { on: "with nothing uploaded", data: EMPTY_WIZARD, quoted: false, step: 1 },
    { on: "with a description but no bag id", data: withData({ description: "backup" }), quoted: false, step: 1 },
    { on: "on a bag id that is not 64 characters", data: withData({ bagId: "abc" }), quoted: false, step: 1 },
    { on: "once the bag exists", data: withData({ bagId: BAG }), quoted: false, step: 2 },
    { on: "once the selected providers have quoted the bag", data: withData({ bagId: BAG, selected: ["key"] }), quoted: true, step: 3 },
    { on: "while the selected providers have not quoted", data: withData({ bagId: BAG, selected: ["key"] }), quoted: false, step: 2 },
    { on: "with a deployed contract that is not paid", data: withData({ bagId: BAG, selected: ["key"], contractAddress: "EQ" }), quoted: true, step: 3 },
    { on: "with the paid flag but no contract", data: withData({ bagId: BAG, selected: ["key"], paid: true }), quoted: true, step: 3 },
    { on: "with both the contract and the paid flag", data: withData({ bagId: BAG, selected: ["key"], contractAddress: "EQ", paid: true }), quoted: false, step: 4 },
    { on: "when the bag is dropped, whatever else is set", data: withData({ selected: ["key"], contractAddress: "EQ", paid: true }), quoted: true, step: 1 },
  ])("stands on step $step $on", ({ data, quoted, step }) => {
    expect(reachedStep(data, quoted)).toBe(step)
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
  it.each<[DeployCheck, string, string]>([
    ["deployed", "link", "the bag instead of paying again"],
    ["missing", "send", "the payment anew"],
    ["unknown", "wait", "instead of paying on a guess"],
  ])("answers a chain that says %s with %s: %s", (check, action) => {
    expect(deployAction(check)).toBe(action)
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
  it("says the transaction was not confirmed only when the chain answered that no contract is there, and claims nothing when it could not be asked", () => {
    expect(checkErrorKey("missing")).toBe("errors.paymentFailed")
    expect(checkErrorKey("unknown")).toBe("errors.paymentUnchecked")
  })
})

describe("payErrorTone", () => {
  it.each([
    [checkErrorKey("unknown"), "gray", "the chain has not answered, so nothing failed yet"],
    [checkErrorKey("missing"), "red", "the chain reported no contract, a real failed payment"],
    ["errors.notLinked", "red", "the money went out and the bag is not linked"],
    ["errors.linkNotSaved", "red", "the money went out and the browser refused the mark"],
    ["errors.confirmTimeout", "gray", "the signed transaction may still land"],
  ])("paints %s %s: %s", (key, tone) => {
    expect(payErrorTone(key)).toBe(tone)
  })
})

describe("UNAUTHORIZED", () => {
  it("hands the end of the session over as a key, so the message follows a language switch", () => {
    expect(line(UNAUTHORIZED)).toBe(en.errors.unauthorized)
  })
})

describe("uploadErrorKey", () => {
  it.each([
    [429, "too many requests", "errors.rateLimited"],
    [502, "", "errors.uploadNoResponse"],
    [504, "", "errors.uploadNoResponse"],
    [500, "", "errors.serverError"],
    [400, "invalid multipart", "errors.requestRejected"],
    [400, "you have unpaid bags", "errors.hasUnpaid"],
    [400, "invalid filename", "errors.badNames"],
    [418, "", "errors.uploadFailed"],
  ])("names a %i upload answered %j with the dictionary key %s", (status, detail, key) => {
    const refused = new ApiError(status, "POST", "/api/v1/files", detail)

    expect(uploadErrorKey(refused)).toBe(key)
    expect(line(key)).toBeDefined()
  })

  it("carries the status and adds the server's own words only where our line names no reason", () => {
    const rejected = new ApiError(400, "POST", "/api/v1/files", "invalid multipart")
    const limited = new ApiError(429, "POST", "/api/v1/files", "too many requests, please try again later")
    const dropped = new ApiError(0, "POST", "/api/v1/files")

    expect(uploadFailure(uploadErrorKey(rejected), rejected)).toEqual({ key: "errors.requestRejected", status: 400, detail: "invalid multipart" })
    expect(uploadFailure(uploadErrorKey(limited), limited)).toEqual({ key: "errors.rateLimited", status: 429, detail: "" })
    expect(uploadFailure(uploadErrorKey(dropped), dropped)).toEqual({ key: "errors.offline", status: null, detail: "" })
    expect(uploadFailure(UNAUTHORIZED)).toEqual({ key: UNAUTHORIZED, status: null, detail: "" })
  })
})

describe("clampStep", () => {
  it("keeps the view between the first step and what the data supports, allowing steps back", () => {
    expect(clampStep(4, 2)).toBe(2)
    expect(clampStep(1, 3)).toBe(1)
    expect(clampStep(0, 3)).toBe(1)
  })
})
