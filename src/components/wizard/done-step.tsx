import { CircleCheck, FileText, Package } from "lucide-react"
import { useTranslation } from "react-i18next"
import { gatewayUrl } from "@/lib/api"
import { scanUrl, txUrl } from "@/lib/contracts"
import { formatBytes, shortenMiddle } from "@/lib/format"
import { Notice } from "../notice"
import { SheetField } from "../sheet-fields"
import shared from "../shared.module.css"
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
      <Notice tone="green" icon={CircleCheck} className={styles.deployed}>
        {t("done.deployed")}
      </Notice>

      {(contractAddress || paymentHash) && (
        <>
          <div className={styles.heading}>
            <h2 className={shared.tableTitle}>
              <FileText className={shared.titleIcon} aria-hidden="true" />
              <span>{t("details.contract")}</span>
            </h2>
          </div>

          <div className={styles.box}>
            {contractAddress && (
              <SheetField
                label={t("files.contract")}
                value={shortenMiddle(contractAddress, 6, 6)}
                title={contractAddress}
                href={scanUrl(contractAddress)}
                mono
                copy={contractAddress}
                copied={copied}
                onCopy={onCopy}
              />
            )}
            {paymentHash && (
              <SheetField
                label={t("done.tx")}
                value={shortenMiddle(paymentHash, 6, 6)}
                title={paymentHash}
                href={txUrl(paymentHash)}
                mono
                copy={paymentHash}
                copied={copied}
                onCopy={onCopy}
              />
            )}
          </div>
        </>
      )}

      <div className={styles.heading}>
        <h2 className={shared.tableTitle}>
          <Package className={shared.titleIcon} aria-hidden="true" />
          <span>{t("done.bag")}</span>
        </h2>
      </div>

      <div className={styles.box}>
        <SheetField
          label={t("files.bagId")}
          value={shortenMiddle(bagId.toUpperCase(), 6, 6)}
          title={bagId.toUpperCase()}
          mono
          copy={bagId}
          copied={copied}
          onCopy={onCopy}
        />
        <SheetField
          label={t("files.desc")}
          value={description}
          title={description || undefined}
          copy={description || undefined}
          copied={copied}
          onCopy={onCopy}
        />
        <SheetField label={t("done.filesCount")} value={String(filesCount)} />
        <SheetField label={t("files.size")} value={formatBytes(size)} />
      </div>

      <div className={styles.footer}>
        <a href={gatewayUrl(bagId)} target="_blank" rel="noopener noreferrer" className={shared.secondary}>
          {t("done.gateway")}
        </a>
        <button type="button" onClick={onFinish} className={shared.primary}>
          {t("done.finish")}
        </button>
      </div>
    </div>
  )
}
