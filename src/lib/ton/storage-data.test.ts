import { describe, expect, it } from "vitest"
import { beginCell, Address } from "@ton/core"
import { parseStorageData } from "./storage-data"

const OWNER = "EQCDrgGaI6gWK-qlyw69xWZosurGxrpRgIgSkVsgahUtxcmx"

const FIVE_PROVIDERS = "te6ccgECCwEAAakAAd1Be8JgKL0b32eMOp45AgqpjkBAF7dFv3UUQYc1C/HposAIOuAZojqBYr6qXLDr3FZmiy6sbGulGAiBKRWyBqFS3FAAAAAAZAADgAAgAAJNJLRSAdEaiNVn3pZq7UWrm4LPHarrocIbC3Ai30pBAKgBAgEgAgMCASAEBQFrv8JeC1x2n78I+XjGYLNGOXxVM5crkej2ZlMJMHff1AFJgAAAAAA/fyM1WUm9B73lRnJ4/BFACgIBbgYHAWq/jU8BpCNNg5yrvoH5f83o90QIyPFkseSgfaPX8IulaagAAAAAADOXZmqzssYwSYVZ1HNY6AoBab7Hiz0Z5t28d6zL24ml9HvoI0uhEibgY3+lW4EKdENqQAAAAAAsPM8bVZ2WWVpR1yMuk/XMCgIBIAgJAWm+qI/bX2wtl3x7CfLmm1Gh4d6M1l7+hring/zT3uGV/wAAAAAAICGBtqspGY87Pcu6rMzO2AoBab6RHECh/lTStpzx+CgM5ylK5MHHyY3cxzZTo881obZa8AAAAABRtdZmqy0CCKuGNJssJBy4CgAPAAk6gDARcFg="

const ONE_PROVIDER = "te6ccgEBAwEAtAAB3fqTpD6+sri6w1C2mrZ/+vRPD50sLs1Fa5u1jVXQu9TmwAg64BmiOoFivqpcsOvcVmaLLqxsa6UYCIEpFbIGoVLcUAAAABAAAAPQAIAAAa7Se4nSjFbVJ2Ot3oRRnVF/A3172ZWTie0UmdNHDwKQ6AEBa6AHUR+2vthbLvj2E+XNNqNDw70ZrL39DXFPB/mnvcMr/gAAAAAZjOcmgAAAAAXkKtIuXlfjkAIADQAnjQAgZcg="

describe("parseStorageData", () => {
  it("reads a five-provider contract the way get_providers and acton do", () => {
    const data = parseStorageData(FIVE_PROVIDERS)

    expect(data.owner).toBe(OWNER)
    expect(data.fileSize).toBe(104857656)
    expect(data.torrentHash).toBe("417bc26028bd1bdf678c3a9e39020aa98e404017b745bf75144187350bf1e9a2")
    expect(data.providers.map(({ pubkey, ...rest }) => ({ pubkey: pubkey.slice(0, 8), ...rest }))).toEqual([
      { pubkey: "30f167a3", ratePerMbDay: 71429, maxSpan: 604800, lastProofTime: 1790161611 },
      { pubkey: "3a88fdb5", ratePerMbDay: 71429, maxSpan: 604800, lastProofTime: 1790087576 },
      { pubkey: "3d11c40a", ratePerMbDay: 71429, maxSpan: 604800, lastProofTime: 1790103584 },
      { pubkey: "4d4f01a4", ratePerMbDay: 71429, maxSpan: 604800, lastProofTime: 1790161606 },
      { pubkey: "84bc16b8", ratePerMbDay: 71429, maxSpan: 604800, lastProofTime: 1790088058 },
    ])
  })

  it("reads a one-provider contract with a fresh record", () => {
    const data = parseStorageData(ONE_PROVIDER)

    expect(data.owner).toBe(OWNER)
    expect(data.fileSize).toBe(4294967357)
    expect(data.torrentHash).toBe("fa93a43ebeb2b8bac350b69ab67ffaf44f0f9d2c2ecd456b9bb58d55d0bbd4e6")
    expect(data.providers).toEqual([
      { pubkey: "3a88fdb5f6c2d977c7b09f2e69b51a1e1de8cd65efe86b8a783fcd3dee195ff0", ratePerMbDay: 1628, maxSpan: 2592000, lastProofTime: 0 },
    ])
  })

  it("survives an empty provider set", () => {
    const cell = beginCell()
      .storeUint(1n, 256)
      .storeBit(0)
      .storeAddress(Address.parse(OWNER))
      .storeUint(17294, 64)
      .storeUint(131072, 32)
      .storeUint(2n, 256)
      .storeUint(0, 8)
      .endCell()

    const data = parseStorageData(cell.toBoc().toString("base64"))

    expect(data.providers).toEqual([])
    expect(data.fileSize).toBe(17294)
  })

  it("refuses a cell with data left over", () => {
    const cell = beginCell().storeUint(1n, 256).storeBit(0).storeAddress(Address.parse(OWNER)).storeUint(1, 64).storeUint(1, 32).storeUint(1n, 256).storeUint(0, 8).storeBit(1).endCell()

    expect(() => parseStorageData(cell.toBoc().toString("base64"))).toThrow()
  })
})
