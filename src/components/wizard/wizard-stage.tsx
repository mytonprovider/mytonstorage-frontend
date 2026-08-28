import { useTranslation } from "react-i18next"
import type { ProviderCatalog } from "@/lib/providers"
import { deployInFlight, type WizardFlow } from "@/lib/wizard"
import { Deadline } from "./deadline"
import { DoneStep } from "./done-step"
import { PeriodStep } from "./period-step"
import { ProvidersStep } from "../providers/providers-step"
import { Stepper } from "./stepper"
import { UploadStep } from "./upload-step"

interface WizardStageProps {
  wizard: WizardFlow
  catalog: ProviderCatalog
  copied: string | null
  onCopy: (value: string) => void
  onOpenProvider: (pubkey: string) => void
  onFinish: () => void
}

export const WizardStage = ({ wizard, catalog, copied, onCopy, onOpenProvider, onFinish }: WizardStageProps) => {
  const { t } = useTranslation()
  const { step, data } = wizard

  return (
    <>
      <Stepper current={step} reached={wizard.reached} onPick={wizard.goStep} />

      {(step === 2 || step === 3) && wizard.deadline !== null && (
        <Deadline deadline={wizard.deadline} onRestart={wizard.reset} />
      )}

      {step === 1 && (
        <UploadStep
          files={data.files}
          description={data.description}
          progress={wizard.progress}
          error={wizard.uploadError}
          onPick={wizard.addFiles}
          onReplace={wizard.replaceFiles}
          onRemove={wizard.removeFile}
          onClear={wizard.clearFiles}
          onDescription={wizard.setDescription}
          onSubmit={wizard.submitUpload}
          onCancel={wizard.cancelUpload}
        />
      )}

      {step === 2 && (
        <ProvidersStep
          providers={catalog.providers}
          loading={catalog.loading}
          failed={catalog.failed}
          status={catalog.status}
          onRetry={catalog.reload}
          selected={data.selected}
          proofDays={wizard.proofDays}
          bagSize={wizard.bagSize}
          autoPick
          checking={wizard.checking}
          declines={wizard.declines}
          copied={copied}
          error={wizard.payError}
          onSelected={wizard.selectProviders}
          onAddManual={catalog.addManual}
          onProofDays={wizard.setProofDays}
          onCopy={onCopy}
          onOpen={onOpenProvider}
          submitDisabled={wizard.expired}
          submitReason={wizard.expired ? t("wizard.expired") : undefined}
          onBack={() => wizard.goStep(1)}
          onContinue={wizard.verified ? () => wizard.goStep(3) : wizard.requestOffers}
        />
      )}

      {step === 3 && (
        <PeriodStep
          days={wizard.storageDays}
          proofDays={wizard.proofDays}
          offers={wizard.offers}
          sending={wizard.sending}
          sent={deployInFlight(data) !== null}
          submitDisabled={wizard.expired}
          error={wizard.payError}
          onDays={wizard.setStorageDays}
          onBack={() => wizard.goStep(2)}
          onSend={wizard.deploy}
        />
      )}

      {step === 4 && (
        <DoneStep
          bagId={data.bagId ?? ""}
          description={data.description}
          filesCount={wizard.filesCount}
          size={wizard.bagSize}
          contractAddress={data.contractAddress ?? undefined}
          paymentHash={wizard.paymentHash ?? undefined}
          copied={copied}
          onCopy={onCopy}
          onFinish={onFinish}
        />
      )}
    </>
  )
}
