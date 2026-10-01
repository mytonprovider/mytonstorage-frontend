import { describe, expect, it } from "vitest"
import type { ContractRow } from "./contracts"
import { PROOF_GRACE_SECONDS } from "./contracts"
import {
  STATUS_FILTERS,
  isSortField,
  matchesQuery,
  matchesStatus,
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
  return {
    address: "EQ" + name,
    createdAt: HIRED,
    closed: false,
    bagId: BAG,
    description: "backup.tar",
    size: BYTES_IN_GIB,
    valid: 1,
    total: 1,
    state: {
      torrentHash: BAG,
      fileSize: BYTES_IN_GIB,
      balance,
      providers: proofs.map((at, index) => provider(at, index === 0 ? KEY : "b".repeat(64))),
    },
    ...rest,
  }
}

const stored = row()
const partial = row({ name: "Bbb", proofs: [NOW - 3600, NOW - 2 * WEEK] })
const unpaid = row({ name: "Ccc", proofs: [NOW - WEEK - PROOF_GRACE_SECONDS - 60], balance: MIN_BOUNTY - 1 })
const lost = row({ name: "Ddd", proofs: [NOW - 3 * WEEK], balance: 400 * MIN_BOUNTY })
const starting = row({ name: "Eee", proofs: [0], createdAt: NOW - 3600, valid: 0, total: 1 })
const noData = row({ name: "Fff", state: null })
const notHired = row({ name: "Ggg", proofs: [] })

const rows = [stored, partial, unpaid, lost, starting, noData, notHired]

describe("matchesStatus", () => {
  it("names each row by the same verdict the badge shows", () => {
    expect(matchesStatus(stored, "stored", NOW)).toBe(true)
    expect(matchesStatus(partial, "partial", NOW)).toBe(true)
    expect(matchesStatus(unpaid, "unpaid", NOW)).toBe(true)
    expect(matchesStatus(lost, "lost", NOW)).toBe(true)
    expect(matchesStatus(starting, "starting", NOW)).toBe(true)
    expect(matchesStatus(noData, "noData", NOW)).toBe(true)
    expect(matchesStatus(notHired, "notHired", NOW)).toBe(true)
  })
})

describe("statusCounts", () => {
  it("counts every verdict once and covers the whole list", () => {
    const counts = statusCounts(rows, NOW)
    expect(counts).toEqual({ stored: 1, partial: 1, starting: 1, lost: 1, unpaid: 1, notHired: 1, noData: 1 })
    expect(STATUS_FILTERS.reduce((sum, status) => sum + counts[status], 0)).toBe(rows.length)
  })

  it("leaves closed rows and rows whose state was never read out of the counts", () => {
    const counts = statusCounts([...rows, { ...lost, closed: true }, { ...unpaid, state: undefined }], NOW)
    expect(counts).toEqual(statusCounts(rows, NOW))
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
    expect(["createdAt", "address", "desc", "paidUntil", "size", "checks", "status"].every(isSortField)).toBe(true)
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

  it("orders the statuses by how bad they are", () => {
    expect(names(sortContracts([stored, starting, partial, notHired, unpaid, lost], "status", "asc", NOW))).toEqual([
      unpaid.address,
      lost.address,
      notHired.address,
      partial.address,
      starting.address,
      stored.address,
    ])
  })

  it("orders the checks ratio and keeps contracts the catalogue never asked about at the end", () => {
    const half = row({ name: "Hlf", valid: 1, total: 2 })
    const full = row({ name: "Ful", valid: 2, total: 2 })
    const unchecked = row({ name: "Unc", valid: 0, total: 0 })
    expect(names(sortContracts([full, unchecked, half], "checks", "asc", NOW))).toEqual([
      half.address,
      full.address,
      unchecked.address,
    ])
  })

  it("compares the address and the description as words in both directions", () => {
    const named = row({ name: "Bbb", description: "archive.zip" })
    expect(names(sortContracts([named, stored], "address", "asc", NOW))).toEqual([stored.address, named.address])
    expect(names(sortContracts([stored, named], "address", "desc", NOW))).toEqual([named.address, stored.address])
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
  const view: ListView = { status: null, query: "", field: "createdAt", direction: "desc", hideClosed: true }

  it("applies the status, the query and the order in one pass", () => {
    const rows = [stored, partial, unpaid, { ...lost, closed: true }]
    expect(visibleContracts(rows, view, NOW)).toHaveLength(3)
    expect(visibleContracts(rows, { ...view, status: "partial" }, NOW).map((row) => row.address)).toEqual([
      partial.address,
    ])
    expect(visibleContracts(rows, { ...view, query: "eqccc" }, NOW).map((row) => row.address)).toEqual([unpaid.address])
  })

  it("narrows by the status and the query together", () => {
    const rows = [stored, partial, unpaid]
    expect(visibleContracts(rows, { ...view, status: "partial", query: "eqaaa" }, NOW)).toHaveLength(0)
    expect(visibleContracts(rows, { ...view, status: "partial", query: "eqbbb" }, NOW)).toHaveLength(1)
  })

  it("shows closed rows once the owner asks for them", () => {
    const rows = [stored, { ...lost, closed: true }]
    expect(visibleContracts(rows, { ...view, hideClosed: false }, NOW)).toHaveLength(2)
  })
})
