export interface UserBag {
  bag_id: string
  created_at: number
  description: string
  files_count: number
  bag_size: number
}

export interface UnpaidBags {
  free_storage: number
  bags: UserBag[]
}

export interface ProviderContractData {
  key: string
  price_per_mb_day: number
}

export interface ProviderOffer {
  price_per_proof: number
  price_per_mb: number
  provider: ProviderContractData
}

export interface ProviderDecline {
  provider_key: string
  reason: string
}

export interface Offers {
  offers: ProviderOffer[]
  declines: ProviderDecline[]
}

export interface PickedFile {
  name: string
  size: number
  file: File
}
