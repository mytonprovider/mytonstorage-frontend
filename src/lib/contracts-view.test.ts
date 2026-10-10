import { describe, expect, it } from "vitest"
import type { ContractRow } from "./contracts"
import {
  STATUS_FILTERS,
  isSortField,
  matchesQuery,
  matchesStatuses,
  sortContracts,
  statusCounts,
  visibleContracts,
  type ListView,
} from "./contracts-view"
import { BYTES_IN_GIB } from "./format"
import { MIN_BOUNTY } from "./pricing"

const NOW = 1_790_200_000
const WEEK = 7 * 86400
const RATE = 8797
const HIRED = NOW - 30 * 86400
const KEY = "a".repeat(64)
const BAG = "f".repeat(64)

const provider = (lastProofTime: number, pubkey = KEY) => ({ pubkey, ratePerMbDay: RATE, maxSpan: WEEK, lastProofTime })

const row = (over: Partial<ContractRow> & { proofs?: number[]; balance?: number; name?: string } = {}): ContractRow => {
  const { proofs = [NOW - 3600], balance = 40 * MIN_BOUNTY, name = "Aaa", ...rest } = over
  const keys = proofs.map((_, index) => (index === 0 ? KEY : "b".repeat(64)))
  return {
    address: "EQ" + name,
    createdAt: HIRED,
    closed: false,
    bagId: BAG,
    description: "backup.tar",
    size: BYTES_IN_GIB,
    valid: keys.length,
    total: keys.length,
    checked: keys,
    stored: keys,
    state: {
      torrentHash: BAG,
      fileSize: BYTES_IN_GIB,
      balance,
      providers: proofs.map((at, index) => provider(at, keys[index])),
    },
    ...rest,
  }
}

const stored = row()
const partial = row({ name: "Bbb", proofs: [NOW - 3600, NOW - 2 * WEEK], stored: [KEY] })
const lost = row({ name: "Ddd", proofs: [NOW - 3 * WEEK], balance: 400 * MIN_BOUNTY, stored: [] })
const unchecked = row({ name: "Eee", proofs: [0], createdAt: NOW - 3600, checked: [], stored: [] })
const notHired = row({ name: "Ggg", proofs: [] })

const rows = [stored, partial, lost, unchecked, notHired]

describe("matchesStatuses", () => {
  it("names each row by the same verdict the status cell shows", () => {
    expect(matchesStatuses(stored, ["stored"])).toBe(true)
    expect(matchesStatuses(partial, ["partial"])).toBe(true)
    expect(matchesStatuses(lost, ["lost"])).toBe(true)
    expect(matchesStatuses(unchecked, ["noPeers"])).toBe(true)
    expect(matchesStatuses(notHired, ["noPeers"])).toBe(true)
    expect(matchesStatuses({ ...lost, closed: true }, ["closed"])).toBe(true)
  })

  it("keeps a row matching any of the chosen verdicts, and every row when none is chosen", () => {
    expect(matchesStatuses(partial, ["lost", "partial"])).toBe(true)
    expect(matchesStatuses(stored, ["lost", "partial"])).toBe(false)
    expect(matchesStatuses(stored, [])).toBe(true)
  })

  it("keeps a row whose state was never read out of every chosen verdict", () => {
    const unread = { ...row({ name: "Hhh" }), state: undefined }
    expect(matchesStatuses(unread, ["noPeers"])).toBe(false)
    expect(matchesStatuses(unread, [])).toBe(true)
  })
})

describe("statusCounts", () => {
  it("counts every verdict once and covers the whole list", () => {
    const counts = statusCounts(rows)
    expect(counts).toEqual({ stored: 1, partial: 1, lost: 1, noPeers: 2, closed: 0 })
    expect(STATUS_FILTERS.reduce((sum, status) => sum + counts[status], 0)).toBe(rows.length)
  })

  it("counts a closed row under its own word and leaves a row whose state was never read out", () => {
    const counts = statusCounts([...rows, { ...lost, closed: true }, { ...partial, state: undefined }])
    expect(counts).toEqual({ ...statusCounts(rows), closed: 1 })
  })
})

describe("matchesQuery", () => {
  it("takes a substring of the address, the bag id or the description", () => {
    expect(matchesQuery(stored, "eqaaa")).toBe(true)
    expect(matchesQuery(stored, "ffff")).toBe(true)
    expect(matchesQuery(stored, "backup")).toBe(true)
    expect(matchesQuery(stored, "photos")).toBe(false)
  })

  it("takes a full bag id, letter case aside", () => {
    expect(matchesQuery(stored, BAG)).toBe(true)
    expect(matchesQuery(stored, BAG.toUpperCase())).toBe(true)
    expect(matchesQuery(stored, "c".repeat(64))).toBe(false)
  })

  it("keeps everything when the query is empty", () => {
    expect(matchesQuery(stored, "   ")).toBe(true)
  })
})

describe("isSortField", () => {
  it("accepts every column the list can order by and refuses anything else", () => {
    expect(["createdAt", "address", "bagId", "desc", "paidUntil", "size", "checks"].every(isSortField)).toBe(true)
    expect(isSortField("status")).toBe(false)
    expect(isSortField("")).toBe(false)
    expect(isSortField("bogus")).toBe(false)
  })
})

describe("sortContracts", () => {
  const names = (rows: ContractRow[]) => rows.map((contract) => contract.address)

  it("puts the contract that runs out first on top", () => {
    const lowFunds = row({ name: "Low", proofs: [NOW - WEEK + 2 * 86400], balance: MIN_BOUNTY })
    expect(names(sortContracts([stored, lowFunds], "paidUntil", "asc", NOW))[0]).toBe(lowFunds.address)
  })

  it("treats a contract nobody is paid for as burning, not as paid forever", () => {
    const orphan = row({ name: "Orp", proofs: [] })
    expect(names(sortContracts([stored, orphan], "paidUntil", "asc", NOW))[0]).toBe(orphan.address)
  })

  it("orders the checks ratio and keeps contracts the catalogue never asked about at the end", () => {
    const half = row({ name: "Hlf", proofs: [NOW - 3600, NOW - 3600], stored: [KEY] })
    const full = row({ name: "Ful" })
    const never = row({ name: "Unc", checked: [], stored: [] })
    expect(names(sortContracts([full, never, half], "checks", "asc", NOW))).toEqual([
      half.address,
      full.address,
      never.address,
    ])
  })

  it("compares the address, the bag id and the description as words in both directions", () => {
    const named = row({ name: "Bbb", description: "archive.zip", bagId: "a".repeat(64) })
    expect(names(sortContracts([named, stored], "address", "asc", NOW))).toEqual([stored.address, named.address])
    expect(names(sortContracts([stored, named], "address", "desc", NOW))).toEqual([named.address, stored.address])
    expect(names(sortContracts([stored, named], "bagId", "asc", NOW))).toEqual([named.address, stored.address])
    expect(names(sortContracts([named, stored], "bagId", "desc", NOW))).toEqual([stored.address, named.address])
    expect(sortContracts([stored, named], "desc", "asc", NOW).map((contract) => contract.description)).toEqual([
      "archive.zip",
      "backup.tar",
    ])
  })

  it("falls back to the size read from the chain when the row has none", () => {
    const thin = row({ name: "Thn", size: 0 })
    const fat = row({ name: "Fat", size: 4 * BYTES_IN_GIB })
    expect(names(sortContracts([thin, fat], "size", "desc", NOW))).toEqual([fat.address, thin.address])
  })

  it("keeps a contract whose state was never read at the end", () => {
    const unread = { ...row({ name: "Zzz" }), state: undefined }
    expect(names(sortContracts([unread, stored], "paidUntil", "asc", NOW))).toEqual([stored.address, unread.address])
  })
})

describe("visibleContracts", () => {
  const view: ListView = { statuses: [], query: "", field: "createdAt", direction: "desc", hideClosed: true }

  it("applies the status, the query and the order in one pass", () => {
    const rows = [stored, partial, lost, { ...unchecked, closed: true }]
    expect(visibleContracts(rows, view, NOW)).toHaveLength(3)
    expect(visibleContracts(rows, { ...view, statuses: ["partial"] }, NOW).map((row) => row.address)).toEqual([
      partial.address,
    ])
    expect(visibleContracts(rows, { ...view, query: "eqddd" }, NOW).map((row) => row.address)).toEqual([lost.address])
    expect(visibleContracts(rows, { ...view, statuses: ["partial", "lost"] }, NOW).map((row) => row.address)).toEqual([
      partial.address,
      lost.address,
    ])
  })

  it("narrows by the status and the query together", () => {
    const rows = [stored, partial, lost]
    expect(visibleContracts(rows, { ...view, statuses: ["partial"], query: "eqaaa" }, NOW)).toHaveLength(0)
    expect(visibleContracts(rows, { ...view, statuses: ["partial"], query: "eqbbb" }, NOW)).toHaveLength(1)
  })

  it("shows only the closed rows when asked for them, even with the closed ones hidden", () => {
    const shut = { ...lost, closed: true }
    const picked = visibleContracts([stored, partial, shut], { ...view, statuses: ["closed"] }, NOW)
    expect(picked.map((row) => row.address)).toEqual([shut.address])
  })

  it("shows closed rows once the owner asks for them", () => {
    const rows = [stored, { ...lost, closed: true }]
    expect(visibleContracts(rows, { ...view, hideClosed: false }, NOW)).toHaveLength(2)
  })
})
