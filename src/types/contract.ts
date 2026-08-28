export interface WalletTransaction {
  body: string
  state_init: string
  address: string
  amount: number
}

export interface InitStorageContract {
  bag_id: string
  providers: string[]
  amount: number
  owner_address: string
  span: number
}

export interface UpdateStorageContract {
  address: string
  providers: string[]
  bag_size: number
  amount: number
  span: number
}

export interface BagInfoShort {
  contract_address: string
  bag_id: string
  description: string
  size: number
}

export interface ContractStatus {
  address: string
  provider_pubkey: string
  reason: number | null
  reason_timestamp: number | null
}

export interface StorageContract {
  address: string
  createdAt: number
  closed: boolean
  bagId: string
  description: string
  size: number
  valid: number
  total: number
}
