import { useRef, useState, type ChangeEvent } from "react"
import { File as FileIcon, Files, FileText, Folder, Loader, Upload, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { onScrollNearBottom } from "@/lib/dom"
import { formatBytes, formatBytesFloor, splitFileName } from "@/lib/format"
import { MAX_BAG_BYTES, MAX_BAG_FILES, MAX_DESCRIPTION } from "@/lib/pricing"
import { hasFolder, mergeFiles, pickedFrom, rootsOf, totalSize, validatePicked } from "@/lib/upload"
import type { PickedFile } from "@/types/bag"
import { IconButton } from "../icon-button"
import { Notice } from "../notice"
import { Sheet, SheetFooter } from "../sheet"
import shared from "../shared.module.css"
import styles from "./upload-step.module.css"

const ROWS_PER_PAGE = 100
const NEAR_BOTTOM_PX = 120

const filesFromDrop = async (transfer: DataTransfer): Promise<File[]> => {
  const entries = Array.from(transfer.items)
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null)

  if (!entries.length) return Array.from(transfer.files)

  const found: File[] = []

  const collect = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      Object.defineProperty(file, "webkitRelativePath", { value: entry.fullPath.replace(/^\//, "") })
      found.push(file)
      return
    }

    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const read = () => new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))

    for (let batch = await read(); batch.length; batch = await read()) {
      await Promise.all(batch.map(collect))
    }
  }

  await Promise.all(entries.map(collect))
  return found
}

interface DropZoneProps {
  folderMode: boolean
  uploading: boolean
  onFiles: (picked: PickedFile[]) => void
  onReadError: () => void
}

const DropZone = ({ folderMode, uploading, onFiles, onReadError }: DropZoneProps) => {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const pickFromInput = (event: ChangeEvent<HTMLInputElement>) => {
    onFiles(pickedFrom(event.target.files))
    event.target.value = ""
  }

  const endDrag = () => {
    depth.current = 0
    setDragging(false)
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault()
        depth.current += 1
        setDragging(!uploading)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        depth.current -= 1
        if (depth.current <= 0) endDrag()
      }}
      onDrop={(event) => {
        event.preventDefault()
        endDrag()
        void filesFromDrop(event.dataTransfer)
          .then((dropped) => onFiles(pickedFrom(dropped)))
          .catch(() => onReadError())
      }}
      className={cx(styles.drop, dragging && styles.dragging)}
    >
      <p className={styles.hint}>{t("upload.hint")}</p>
      <div className={styles.actions}>
        <label
          className={cx(shared.primary, styles.pick, (folderMode || uploading) && cx(styles.pickBlocked, styles.pickBlockedFilled))}
          title={folderMode ? t("upload.oneFolder") : undefined}
        >
          <Upload className={styles.pickIcon} aria-hidden="true" />
          <span>{t("upload.files")}</span>
          <input type="file" multiple disabled={folderMode || uploading} onChange={pickFromInput} className={styles.srInput} />
        </label>
        <label className={cx(shared.secondary, styles.pick, uploading && cx(styles.pickBlocked, styles.pickBlockedOutline))}>
          <Folder className={styles.pickIcon} aria-hidden="true" />
          <span>{t("upload.folder")}</span>
          <input
            type="file"
            multiple
            disabled={uploading}
            onChange={pickFromInput}
            ref={(element) => {
              if (element) element.setAttribute("webkitdirectory", "")
            }}
            className={styles.srInput}
          />
        </label>
      </div>
      <p className={styles.max}>{t("upload.max", { size: formatBytesFloor(MAX_BAG_BYTES) })}</p>
    </div>
  )
}

interface PickedFilesProps {
  files: PickedFile[]
  uploading: boolean
  onRemove: (index: number) => void
  onClear: () => void
}

const PickedFiles = ({ files, uploading, onRemove, onClear }: PickedFilesProps) => {
  const { t } = useTranslation()
  const [shownLimit, setShownLimit] = useState(ROWS_PER_PAGE)

  return (
    <section className={styles.list}>
      <div className={styles.listHead}>
        <h2 className={shared.tableTitle}>
          <Files className={shared.titleIcon} aria-hidden="true" />
          <span>{t("upload.picked")}</span>
        </h2>
        <span className={shared.spacer} />
        <button type="button" onClick={onClear} disabled={uploading} className={shared.textDanger}>
          {t("ui.clear")}
        </button>
      </div>

      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={shared.tableHeadCell}>{t("upload.colFile")}</span>
          <span className={shared.tableHeadCell}>{t("upload.colSize")}</span>
          <span />
        </div>

        <div
          className={styles.scroll}
          onScroll={onScrollNearBottom(NEAR_BOTTOM_PX, () => {
            if (shownLimit < files.length) setShownLimit((current) => current + ROWS_PER_PAGE)
          })}
        >
          {files.slice(0, shownLimit).map((file, index) => {
            const [stem, extension] = splitFileName(file.name)

            return (
              <div key={`${file.name}-${index}`} className={styles.row}>
                <span className={shared.tableLead}>
                  {file.name.includes("/") ? (
                    <Folder className={styles.rowIcon} aria-hidden="true" />
                  ) : (
                    <FileIcon className={styles.rowIcon} aria-hidden="true" />
                  )}
                  <span title={file.name} className={cx(shared.tableValue, styles.fileName)}>
                    <span className={shared.ellipsis}>{stem}</span>
                    <span className={styles.fileExt}>{extension}</span>
                  </span>
                </span>
                <span className={shared.tableCell}>
                  <span className={shared.tableLabel}>{t("upload.colSize")}</span>
                  <span className={shared.tableValue}>{formatBytes(file.size)}</span>
                </span>
                <IconButton size="xs" danger label={t("upload.removeFile")} onClick={() => onRemove(index)} disabled={uploading}>
                  <X className={styles.removeIcon} aria-hidden="true" />
                </IconButton>
              </div>
            )
          })}
        </div>

        <p className={styles.foot}>
          {t("upload.total", { files: files.length, size: formatBytes(totalSize(files)) })}
        </p>
      </div>
    </section>
  )
}

interface ReplaceFolderSheetProps {
  folder: PickedFile[] | null
  pickedCount: number
  onCancel: () => void
  onConfirm: () => void
}

const ReplaceFolderSheet = ({ folder, pickedCount, onCancel, onConfirm }: ReplaceFolderSheetProps) => {
  const { t } = useTranslation()

  return (
    <Sheet
      size="auto"
      open={folder !== null}
      title={t("upload.replaceTitle")}
      onClose={onCancel}
    >
      <p className={shared.sheetNote}>{t("upload.replaceNote", { count: pickedCount })}</p>
      <SheetFooter className={shared.sheetActions}>
        <button type="button" onClick={onConfirm} className={shared.danger}>
          {t("upload.replace")}
        </button>
      </SheetFooter>
    </Sheet>
  )
}

interface UploadStepProps {
  files: PickedFile[]
  description: string
  progress: number | null
  error: string | null
  onPick: (files: PickedFile[]) => void
  onReplace: (files: PickedFile[]) => void
  onRemove: (index: number) => void
  onClear: () => void
  onDescription: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export const UploadStep = ({
  files,
  description,
  progress,
  error,
  onPick,
  onReplace,
  onRemove,
  onClear,
  onDescription,
  onSubmit,
  onCancel,
}: UploadStepProps) => {
  const { t } = useTranslation()
  const [pendingFolder, setPendingFolder] = useState<PickedFile[] | null>(null)
  const [pickError, setPickError] = useState<{ errorKey: string, names?: string[] } | null>(null)

  const descriptionLength = [...description].length
  const tooLarge = totalSize(files) > MAX_BAG_BYTES
  const tooMany = files.length > MAX_BAG_FILES
  const folderMode = hasFolder(files)
  const uploading = progress !== null

  const acceptPicked = (picked: PickedFile[]) => {
    if (uploading) return
    setPickError(null)
    if (!picked.length) {
      setPickError({ errorKey: "upload.nothingToUpload" })
      return
    }

    if (hasFolder(picked)) {
      if (rootsOf(picked).length > 1 || picked.some((file) => !file.name.includes("/"))) {
        setPickError({ errorKey: "upload.oneFolder" })
        return
      }
      const failure = validatePicked(picked)
      if (failure) {
        setPickError(failure)
        return
      }
      if (files.length) setPendingFolder(picked)
      else onReplace(picked)
      return
    }

    if (folderMode) {
      setPickError({ errorKey: "upload.oneFolder" })
      return
    }
    const failure = validatePicked(mergeFiles(files, picked))
    if (failure) {
      setPickError(failure)
      return
    }
    onPick(picked)
  }

  return (
    <div className={styles.step}>
      <div className={styles.dropHead}>
        <h2 className={shared.tableTitle}>
          <Upload className={shared.titleIcon} aria-hidden="true" />
          <span>{t("steps.upload")}</span>
        </h2>
      </div>

      <DropZone
        folderMode={folderMode}
        uploading={uploading}
        onFiles={acceptPicked}
        onReadError={() => {
          if (!uploading) setPickError({ errorKey: "upload.folderReadFailed" })
        }}
      />

      {tooLarge && (
        <Notice
          className={styles.notice}
          tone="red"
          action={
            <a href="https://github.com/xssnick/TON-Torrent" target="_blank" rel="noopener noreferrer">
              {t("upload.torrent")}
            </a>
          }
        >
          {t("upload.tooLarge", { max: formatBytesFloor(MAX_BAG_BYTES) })}
        </Notice>
      )}

      {tooMany && (
        <Notice className={styles.notice} tone="red">
          {t("upload.tooMany", { count: files.length, max: MAX_BAG_FILES })}
        </Notice>
      )}

      {pickError && (
        <Notice className={styles.notice} tone="yellow">
          {t(pickError.errorKey, { names: pickError.names?.join(", ") })}
        </Notice>
      )}

      {files.length > 0 && (
        <>
          <PickedFiles files={files} uploading={uploading} onRemove={onRemove} onClear={onClear} />

          <section className={styles.form}>
            <div className={styles.formHead}>
              <h2 className={shared.tableTitle}>
                <FileText className={shared.titleIcon} aria-hidden="true" />
                <span>{t("files.desc")}</span>
              </h2>
            </div>

            <div className={styles.box}>
              <span className={styles.inputWrap}>
                <input
                  type="text"
                  value={description}
                  aria-label={t("files.desc")}
                  onChange={(event) => onDescription(event.target.value)}
                  disabled={uploading}
                  className={styles.descInput}
                />
                <span className={cx(styles.counter, descriptionLength > MAX_DESCRIPTION && styles.counterOver)}>
                  {descriptionLength} / {MAX_DESCRIPTION}
                </span>
              </span>
            </div>

            <div aria-hidden={!uploading} className={cx(styles.progress, !uploading && shared.invisible)}>
              <span className={styles.progressNote}>
                {t(progress === 100 ? "upload.assembling" : "upload.sending")}
              </span>
              <span className={styles.progressRow}>
                <span
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress ?? 0}
                  className={styles.progressTrack}
                >
                  <span style={{ width: `${progress ?? 0}%` }} className={styles.progressFill} />
                </span>
                <span className={styles.progressValue}>{progress ?? 0}%</span>
              </span>
            </div>

            <div className={styles.submit}>
              <button
                type="button"
                tabIndex={uploading ? undefined : -1}
                onClick={onCancel}
                className={cx(shared.secondary, !uploading && shared.invisible)}
              >
                {t("ui.cancel")}
              </button>
              <span className={shared.spacer} />
              <button
                type="button"
                onClick={onSubmit}
                disabled={uploading || tooLarge || tooMany || descriptionLength > MAX_DESCRIPTION}
                className={shared.primary}
              >
                {uploading && <Loader strokeWidth={2.5} aria-hidden="true" className={styles.spinner} />}
                <span>{t("upload.submit")}</span>
              </button>
            </div>
          </section>
        </>
      )}

      {error && (
        <Notice className={styles.notice} tone="red">
          {t(error, { max: MAX_BAG_FILES })}
        </Notice>
      )}

      <ReplaceFolderSheet
        folder={pendingFolder}
        pickedCount={files.length}
        onCancel={() => setPendingFolder(null)}
        onConfirm={() => {
          if (pendingFolder) onReplace(pendingFolder)
          setPendingFolder(null)
        }}
      />
    </div>
  )
}
