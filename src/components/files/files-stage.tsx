import { useState } from "react"
import { topupContract, updateContract, withdrawContract } from "@/lib/api"
import type { ContractsState } from "@/lib/contracts"
import type { ProviderCatalog } from "@/lib/providers"
import type { UnpaidBagsState } from "@/lib/unpaid-bags"
import type { UserBag } from "@/types/bag"
import { ContractFix } from "../contracts/contract-fix"
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

  const saveProviders = (address: string, pubkeys: string[], span: number, fileSize: number, amount: number) => {
    void contracts.run(address, () => updateContract({ address, providers: pubkeys, bag_size: fileSize, amount, span }), pubkeys)
    setEditing(null)
  }

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
        hasUnpaid={unpaid.bags.length > 0}
        busy={contracts.busy}
        copied={copied}
        editing={editing}
        renderEditor={(contract, kind) =>
          kind === "fix" ? (
            <ContractFix
              contract={contract}
              providers={catalog.providers}
              catalogLoading={catalog.loading}
              catalogFailed={catalog.failed}
              busy={contracts.busy !== null}
              onRetryCatalog={catalog.reload}
              copied={copied}
              onCopy={onCopy}
              onOpen={onOpenProvider}
              onManual={() => setEditing({ address: contract.address, kind: "edit" })}
              onGone={() => setEditing(null)}
              onSubmit={(pubkeys, span, fileSize, amount) => saveProviders(contract.address, pubkeys, span, fileSize, amount)}
            />
          ) : kind === "extend" ? (
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
              onSubmit={(pubkeys, span, fileSize, amount) => saveProviders(contract.address, pubkeys, span, fileSize, amount)}
            />
          )
        }
        onRetry={contracts.reload}
        onRefresh={contracts.refresh}
        refreshing={contracts.refreshing}
        onShown={contracts.onShown}
        onHideClosed={contracts.onHideClosed}
        onCopy={onCopy}
        onOpenProvider={onOpenProvider}
        onEditingChange={setEditing}
        onWithdraw={(contract) => void contracts.run(contract, () => withdrawContract(contract))}
      />
    </div>
  )
}
