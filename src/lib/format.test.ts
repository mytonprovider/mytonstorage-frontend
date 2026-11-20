import { afterEach, describe, expect, it, vi } from "vitest"
import { NANO } from "@myton/ui/domain"
import {
  ceilShown,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatTon,
  SHOWN_DIGITS,
  splitFileName,
} from "./format"

// The sum the screen prints, read back as nanotons.
const shownNano = (nanotons: number): number => Math.round(Number(formatTon(nanotons, SHOWN_DIGITS)) * NANO)

describe("formatCountdown", () => {
  it("drops the hour segment under an hour and pads the minutes once it appears", () => {
    expect(formatCountdown(59)).toBe("00:59")
    expect(formatCountdown(600)).toBe("10:00")
    expect(formatCountdown(3661)).toBe("1:01:01")
  })

  it("stops at zero instead of counting into negatives", () => {
    expect(formatCountdown(-30)).toBe("00:00")
  })
})

describe("splitFileName", () => {
  it("keeps the extension out of the shrinking stem", () => {
    expect(splitFileName("backup-2026-08.tar.zst")).toEqual(["backup-2026-08.tar", ".zst"])
    expect(splitFileName("photos/summer.2026.jpeg")).toEqual(["photos/summer.2026", ".jpeg"])
  })

  it("gives no extension to a dotless name, a leading dot or a dot above the last slash", () => {
    expect(splitFileName("README")).toEqual(["README", ""])
    expect(splitFileName(".gitignore")).toEqual([".gitignore", ""])
    expect(splitFileName("dump.d/README")).toEqual(["dump.d/README", ""])
  })
})

describe("nowSeconds", () => {
  const freshClock = async (): Promise<typeof import("./format")> => {
    vi.resetModules()
    return import("./format")
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it("counts from the server clock once the first Date header arrives", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-24T12:05:00Z"))
    const { applyServerDate, nowSeconds } = await freshClock()

    applyServerDate("Mon, 24 Aug 2026 12:00:00 GMT")

    expect(nowSeconds()).toBe(Date.UTC(2026, 7, 24, 12, 0, 0) / 1000)
  })

  it("stays on the client clock while no response carries a readable Date", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-24T12:05:00Z"))
    const { applyServerDate, nowSeconds } = await freshClock()

    applyServerDate(null)
    applyServerDate("not a date")

    expect(nowSeconds()).toBe(Date.UTC(2026, 7, 24, 12, 5, 0) / 1000)
  })

  it("keeps the first offset when later responses report other times", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-24T12:05:00Z"))
    const { applyServerDate, nowSeconds } = await freshClock()

    applyServerDate("Mon, 24 Aug 2026 12:00:00 GMT")
    applyServerDate("Mon, 24 Aug 2026 11:00:00 GMT")
    applyServerDate(null)

    expect(nowSeconds()).toBe(Date.UTC(2026, 7, 24, 12, 0, 0) / 1000)
  })
})

describe("formatDate", () => {
  const noon = (year: number, month: number, day: number): number => new Date(year, month - 1, day, 12).getTime() / 1000

  it("writes an unambiguous year-first date everywhere but Russian", () => {
    expect(formatDate(noon(2033, 5, 10), "en")).toBe("2033-05-10")
    expect(formatDate(noon(2026, 1, 5), "en")).toBe("2026-01-05")
  })

  it("keeps the day-first order in Russian", () => {
    expect(formatDate(noon(2033, 5, 10), "ru")).toBe("10.05.2033")
    expect(formatDate(noon(2026, 1, 5), "ru")).toBe("05.01.2026")
  })
})

describe("formatDateTime", () => {
  const moment = (hours: number, minutes: number): number => new Date(2033, 4, 10, hours, minutes).getTime() / 1000

  it("appends the padded local time to the locale date", () => {
    expect(formatDateTime(moment(9, 5), "en")).toBe("2033-05-10 09:05")
    expect(formatDateTime(moment(9, 5), "ru")).toBe("10.05.2033 09:05")
  })
})

describe("ceilShown", () => {
  it.each([
    [12_732_160, 13_000_000],
    [1, 1_000_000],
    [0, 0],
    [13_000_000, 13_000_000],
    [2e7, 2e7],
  ])("lifts %i to %i, the thousandth of a GRAM it prints as, never down and never past a whole one", (nanotons, shown) => {
    expect(ceilShown(nanotons)).toBe(shown)
  })

  it("prints back exactly what the wallet is asked for", () => {
    for (const nanotons of [1, 999, 3_183_040, 60_477_760, 122_760_000, 4_035_640_001]) {
      expect(shownNano(ceilShown(nanotons))).toBe(ceilShown(nanotons))
      expect(ceilShown(nanotons)).toBeGreaterThanOrEqual(nanotons)
    }
  })
})
