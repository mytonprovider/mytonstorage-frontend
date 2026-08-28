import { useEffect, useState } from "react"
import { topupContract, updateContract, withdrawContract } from "@/lib/api"
import type { ContractsState } from "@/lib/contracts"
import type { ProviderCatalog } from "@/lib/providers"
import type { UnpaidBagsState } from "@/lib/unpaid-bags"
import type { UserBag } from "@/types/bag"
import { ContractProviders } from "../contracts/contract-providers"
import { ContractsList, type OpenEditor } from "../contracts/contracts-list"
import { ExtendForm } from "../contracts/extend-form"
import { UnpaidList } from "./unpaid-list"
import styles from "@/app.module.css"

interface FilesStageProps {
  unpaid: UnpaidBagsState
  contracts: ContractsState
  catalog: ProviderCatalog
  copied: string | null
  onCopy: (value: string) => void
  onOpenProvider: (pubkey: string) => void
  onResumeBag: (bag: UserBag) => void
  onRemoveBag: (bagId: string) => void
}

export const FilesStage = ({
  unpaid,
  contracts,
  catalog,
  copied,
  onCopy,
  onOpenProvider,
  onResumeBag,
  onRemoveBag,
}: FilesStageProps) => {
  const [editing, setEditing] = useState<OpenEditor | null>(null)
  const { reload } = contracts

  useEffect(() => reload(), [reload])

  return (
    <div className={styles.files}>
      <UnpaidList
        bags={unpaid.bags}
        freeStorageSeconds={unpaid.freeStorageSeconds}
        busy={unpaid.busy}
        error={unpaid.error}
        status={unpaid.status}
        errorKind={unpaid.errorKind}
        copied={copied}
        onRetry={unpaid.refresh}
        onCopy={onCopy}
        onContinue={onResumeBag}
        onRemove={onRemoveBag}
      />
      <ContractsList
        contracts={contracts.list}
        loading={contracts.loading}
        error={contracts.error}
        status={contracts.status}
        errorKind={contracts.errorKind}
        hideClosed={contracts.hideClosed}
        hasMore={contracts.hasMore}
        hasUnpaid={unpaid.bags.length > 0}
        busy={contracts.busy}
        copied={copied}
        editing={editing}
        renderEditor={(contract, kind) =>
          kind === "extend" ? (
            <ExtendForm
              address={contract.address}
              onSubmit={(nanotons) => {
                void contracts.run(contract.address, () => topupContract(contract.address, nanotons))
                setEditing(null)
              }}
            />
          ) : (
            <ContractProviders
              contract={contract}
              providers={catalog.providers}
              loading={catalog.loading}
              failed={catalog.failed}
              status={catalog.status}
              busy={contracts.busy !== null}
              active={contracts.busy === contract.address}
              copied={copied}
              onRetry={catalog.reload}
              onCopy={onCopy}
              onOpen={onOpenProvider}
              onAddManual={catalog.addManual}
              onSubmit={(pubkeys, span, fileSize, amount) => {
                void contracts
                  .run(contract.address, () =>
                    updateContract({
                      address: contract.address,
                      providers: pubkeys,
                      bag_size: fileSize,
                      amount,
                      span,
                    }),
                  )
                  .finally(() => setEditing(null))
              }}
            />
          )
        }
        onRetry={contracts.reload}
        onHideClosed={contracts.onHideClosed}
        onCopy={onCopy}
        onEditingChange={setEditing}
        onWithdraw={(contract) => void contracts.run(contract, () => withdrawContract(contract))}
      />
    </div>
  )
}
