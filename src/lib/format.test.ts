import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ceilShown,
  formatBytes,
  formatBytesFloor,
  formatDiskSpeed,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatDuration,
  share,
  shortenMiddle,
  shownNano,
  splitFileName,
  splitSpace,
} from "./format"
import { translate } from "./fixtures"

describe("shortenMiddle", () => {
  it("collapses the middle of a long value into a single ellipsis", () => {
    expect(shortenMiddle("abcdefghijklmnop", 4, 4)).toBe("abcd…mnop")
  })

  it("leaves a short value alone and blanks a missing one", () => {
    expect(shortenMiddle("abcdefghi", 4, 4)).toBe("abcdefghi")
    expect(shortenMiddle(null, 4, 4)).toBe("")
  })
})

describe("formatDiskSpeed", () => {
  it("normalises raw telemetry speeds to binary MiB/s and hides garbage", () => {
    expect(formatDiskSpeed("1152KiB/s")).toBe("1.13 MiB/s")
    expect(formatDiskSpeed("101MiB/s")).toBe("101 MiB/s")
    expect(formatDiskSpeed("fast")).toBe("")
    expect(formatDiskSpeed(null)).toBe("")
  })
})

describe("formatBytesFloor", () => {
  it("rounds the bag cap down so it never claims the impossible 4 GB", () => {
    expect(formatBytesFloor(4 * 1024 ** 3 - 4 * 1024 ** 2)).toBe("3.99 GB")
    expect(formatBytesFloor(4 * 1024 ** 3)).toBe("4 GB")
  })
})

describe("formatBytes", () => {
  it("steps by 1024 and keeps the plain unit names, the way Windows and the agent report sizes", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1024)).toBe("1 KB")
    expect(formatBytes(96 * 1024 ** 2)).toBe("96 MB")
    expect(formatBytes(4 * 1024 ** 3)).toBe("4 GB")
    expect(formatBytes(4284481536)).toBe("3.99 GB")
    expect(formatBytes(4 * 1024 ** 4)).toBe("4 TB")
    expect(formatBytes(2700 * 1024 ** 3)).toBe("2.64 TB")
    expect(formatBytes(14000 * 1024 ** 3)).toBe("13.67 TB")
    expect(formatBytes(1234.56 * 1024 ** 4)).toBe("1235 TB")
    expect(formatBytes(17.18e9)).toBe("16 GB")
    expect(formatBytes(null)).toBe("")
  })
})

describe("share", () => {
  it("takes one step for both halves, so they never drift apart", () => {
    expect(share(500 * 1024 ** 3, 2000 * 1024 ** 3)).toBe("500 / 2000 GB")
  })

  it("keeps hardware in gigabytes the way the provider quotes them", () => {
    expect(share(3689.28 * 1024 ** 3, 14000 * 1024 ** 3)).toBe("3689 / 14000 GB")
  })

  it("shows memory the way the server reports it", () => {
    expect(share(8 * 1024 ** 3, 16 * 1024 ** 3)).toBe("8 / 16 GB")
    expect(share(null, 17.18e9)).toBe("0 / 16 GB")
  })
})

describe("splitSpace", () => {
  it("hands the value and its unit apart for the table cell", () => {
    expect(splitSpace(1500 * 1024 ** 3)).toEqual({ value: "1500", unit: "GB" })
    expect(splitSpace(14000 * 1024 ** 3)).toEqual({ value: "14000", unit: "GB" })
    expect(splitSpace(512.5 * 1024 ** 3)).toEqual({ value: "512.5", unit: "GB" })
    expect(splitSpace(null)).toEqual({ value: "", unit: "" })
  })
})

describe("formatDuration", () => {
  it("names the two largest units that fit and drops an empty smaller one", () => {
    expect(formatDuration(400 * 86400, translate)).toBe("1.year 35.days")
    expect(formatDuration(3 * 86400 + 7200, translate)).toBe("3.days 2.hr")
    expect(formatDuration(7320, translate)).toBe("2.hr 2.min")
    expect(formatDuration(365 * 86400, translate)).toBe("1.year")
    expect(formatDuration(3 * 86400, translate)).toBe("3.days")
    expect(formatDuration(7200, translate)).toBe("2.hr")
    expect(formatDuration(120, translate)).toBe("2.min")
  })

  it("clamps a negative duration to zero seconds", () => {
    expect(formatDuration(-50, translate)).toBe("0.sec")
  })
})

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
  it("lifts a sum to the thousandth of a GRAM it will be printed as, never down to it", () => {
    expect(ceilShown(12_732_160)).toBe(13_000_000)
    expect(ceilShown(1)).toBe(1_000_000)
    expect(ceilShown(0)).toBe(0)
  })

  it("leaves a sum the screen already prints whole alone", () => {
    expect(ceilShown(13_000_000)).toBe(13_000_000)
    expect(ceilShown(2e7)).toBe(2e7)
  })

  it("prints back exactly what the wallet is asked for", () => {
    for (const nanotons of [1, 999, 3_183_040, 60_477_760, 122_760_000, 4_035_640_001]) {
      expect(shownNano(ceilShown(nanotons))).toBe(ceilShown(nanotons))
      expect(ceilShown(nanotons)).toBeGreaterThanOrEqual(nanotons)
    }
  })
})
