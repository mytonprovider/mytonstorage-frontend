import "./buffer"
import { Cell, Dictionary, type DictionaryValue } from "@ton/core"

export interface StorageProvider {
  pubkey: string
  ratePerMbDay: number
  maxSpan: number
  lastProofTime: number
}

interface StorageData {
  torrentHash: string
  owner: string
  fileSize: number
  providers: StorageProvider[]
}

const hex64 = (value: bigint): string => value.toString(16).padStart(64, "0")

const providerValue: DictionaryValue<Omit<StorageProvider, "pubkey">> = {
  serialize: () => {
    throw new Error("read-only")
  },
  parse: (slice) => {
    slice.loadUintBig(64)
    const lastProofTime = slice.loadUint(32)
    slice.loadUintBig(64)
    const info = slice.loadRef().beginParse()
    const maxSpan = info.loadUint(32)
    const ratePerMbDay = Number(info.loadCoins())
    return { ratePerMbDay, maxSpan, lastProofTime }
  },
}

export const parseStorageData = (dataBoc: string): StorageData => {
  const slice = Cell.fromBase64(dataBoc).beginParse()
  const torrentHash = hex64(slice.loadUintBig(256))
  const dict = slice.loadDict(Dictionary.Keys.BigUint(256), providerValue)
  const owner = slice.loadAddress().toString()
  const fileSize = Number(slice.loadUintBig(64))
  slice.loadUint(32)
  slice.loadUintBig(256)
  slice.loadUint(8)
  slice.endParse()

  const providers = [...dict].map(([key, value]) => ({ pubkey: hex64(key), ...value }))

  return { torrentHash, owner, fileSize, providers }
}
