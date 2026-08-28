import { useTranslation } from "react-i18next"
import { countdownTone, useCountdown } from "@/lib/countdown"
import { cx } from "@/lib/cx"
import { formatBytes, formatCountdown } from "@/lib/format"
import type { UserBag } from "@/types/bag"
import { Sheet, SheetFooter } from "../sheet"
import shared from "../shared.module.css"
import styles from "./upload-gate-sheet.module.css"

interface UploadGateSheetProps {
  bag: UserBag | null
  freeStorageSeconds: number
  onClose: () => void
  onReplace: () => void
  onResume: () => void
}

export const UploadGateSheet = ({ bag, freeStorageSeconds, onClose, onReplace, onResume }: UploadGateSheetProps) => {
  const { t } = useTranslation()
  const left = useCountdown(bag ? bag.created_at + freeStorageSeconds : 0)
  const tone = countdownTone(left)

  return (
    <Sheet size="auto" open={bag !== null} title={t("files.finishTitle")} onClose={onClose}>
      {bag && (
        <div className={styles.body}>
          <div className={styles.bag}>
            <span className={styles.name}>{bag.description || bag.bag_id.slice(0, 8)}</span>
            <span className={styles.meta}>
              {formatBytes(bag.bag_size)}
              {" · "}
              {tone !== "over" ? (
                <span className={cx(tone === "soon" && styles.soon)}>
                  {`${t("files.timeLeft")} ${formatCountdown(left)}`}
                </span>
              ) : (
                <span className={styles.over}>{t("files.expired")}</span>
              )}
            </span>
          </div>
          <p className={styles.note}>{t("files.finishNote")}</p>

          <SheetFooter className={shared.sheetActions}>
            <button type="button" onClick={onResume} className={shared.secondary}>
              {t("files.goPay")}
            </button>
            <button type="button" onClick={onReplace} className={shared.danger}>
              {t("files.deleteAndUpload")}
            </button>
          </SheetFooter>
        </div>
      )}
    </Sheet>
  )
}
