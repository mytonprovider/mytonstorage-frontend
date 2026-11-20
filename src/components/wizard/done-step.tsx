import { FileText, Package } from "lucide-react"
import { useTranslation } from "react-i18next"
import { ActionRow, Button, buttonClass, FieldList, Notice, SectionTitle } from "@myton/ui"
import { EMPTY, explorerUrl, fmt } from "@myton/ui/domain"
import { gatewayUrl } from "@/lib/api"
import { txUrl } from "@/lib/contracts"
import { SheetField } from "../sheet-fields"
import styles from "./done-step.module.css"

interface DoneStepProps {
  bagId: string
  description: string
  filesCount: number
  size: number
  contractAddress?: string
  paymentHash?: string
  copied: string | null
  onCopy: (value: string) => void
  onFinish: () => void
}

export const DoneStep = ({
  bagId,
  description,
  filesCount,
  size,
  contractAddress,
  paymentHash,
  copied,
  onCopy,
  onFinish,
}: DoneStepProps) => {
  const { t } = useTranslation()

  return (
    <div className={styles.step}>
      <Notice tone="green" className={styles.lead}>
        <strong className={styles.leadTitle}>{t("done.title")}</strong>
        <ul className={styles.leadList}>
          <li>{t("done.nextStored")}</li>
          <li>{t("done.nextProviders")}</li>
          <li>{t("done.nextTrack")}</li>
          <li>{t("done.nextPublic")}</li>
        </ul>
      </Notice>

      <div className={styles.heading}>
        <SectionTitle size="lg" icon={Package}>
          <span>{t("done.bag")}</span>
        </SectionTitle>
      </div>

      <FieldList card className={styles.box}>
        <SheetField
          label={t("files.bagId")}
          id={bagId}
          upper
          copy={bagId}
          copied={copied}
          onCopy={onCopy}
        />
        <SheetField
          label={t("files.desc")}
          value={description || EMPTY}
          title={description || undefined}
          copy={description || undefined}
          copied={copied}
          onCopy={onCopy}
        />
        <SheetField label={t("done.filesCount")} value={String(filesCount)} />
        <SheetField label={t("files.size")} value={fmt.bytes(size)} />
      </FieldList>

      {(contractAddress || paymentHash) && (
        <>
          <div className={styles.heading}>
            <SectionTitle size="lg" icon={FileText}>
              <span>{t("details.contract")}</span>
            </SectionTitle>
          </div>

          <FieldList card className={styles.box}>
            {contractAddress && (
              <SheetField
                label={t("files.contract")}
                id={contractAddress}
                href={explorerUrl(contractAddress)}
                copy={contractAddress}
                copied={copied}
                onCopy={onCopy}
              />
            )}
            {paymentHash && (
              <SheetField
                label={t("done.tx")}
                id={paymentHash}
                href={txUrl(paymentHash)}
                copy={paymentHash}
                copied={copied}
                onCopy={onCopy}
              />
            )}
          </FieldList>
        </>
      )}

      <ActionRow className={styles.footer}>
        <a href={gatewayUrl(bagId)} target="_blank" rel="noopener noreferrer" className={buttonClass({ size: "xl" })}>
          {t("done.gateway")}
        </a>
        <Button variant="primary" size="xl" onClick={onFinish}>
          {t("done.finish")}
        </Button>
      </ActionRow>
    </div>
  )
}
