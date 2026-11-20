import { useTranslation } from "react-i18next"
import { Button, Card, cx, Sheet, SheetFooter } from "@myton/ui"
import { fmt } from "@myton/ui/domain"
import { countdownTone, useCountdown } from "@/lib/countdown"
import { formatCountdown } from "@/lib/format"
import type { UserBag } from "@/types/bag"
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
    <Sheet open={bag !== null} title={t("files.finishTitle")} onClose={onClose}>
      {bag && (
        <div className={styles.body}>
          <Card pad="row" className={styles.bag}>
            <span className={styles.name}>{bag.description || bag.bag_id.slice(0, 8)}</span>
            <span className={styles.meta}>
              {fmt.bytes(bag.bag_size)}
              {" · "}
              {tone !== "over" ? (
                <span className={cx(tone === "soon" && styles.soon)}>
                  {`${t("files.timeLeft")} ${formatCountdown(left)}`}
                </span>
              ) : (
                <span className={styles.over}>{t("files.expired")}</span>
              )}
            </span>
          </Card>
          <p className={styles.note}>{t("files.finishNote")}</p>

          <SheetFooter>
            <Button size="xl" onClick={onResume}>
              {t("files.goPay")}
            </Button>
            <Button variant="danger" size="xl" onClick={onReplace}>
              {t("files.deleteAndUpload")}
            </Button>
          </SheetFooter>
        </div>
      )}
    </Sheet>
  )
}
