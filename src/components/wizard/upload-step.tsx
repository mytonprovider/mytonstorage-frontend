import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react"
import { File as FileIcon, Files, FileText, Folder, Upload, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  ActionRow,
  Button,
  buttonClass,
  Card,
  cx,
  DataCell,
  DataHeadCell,
  DataRow,
  DataTable,
  DataTableHead,
  DataTableRows,
  glyphClass,
  IconButton,
  Notice,
  SectionTitle,
  TextField,
} from "@myton/ui"
import { fmt } from "@myton/ui/domain"
import { pickLang } from "@myton/ui/i18n"
import { nearBottom, useScrollbarGutter } from "@/lib/dom"
import { formatBytesOrZero, formatCountdown, formatDuration, splitFileName } from "@/lib/format"
import { MAX_BAG_BYTES, MAX_BAG_FILES, MAX_DESCRIPTION } from "@/lib/pricing"
import { hasFolder, mergeFiles, pickedFrom, rootsOf, roundedLeft, totalSize, validatePicked, type UploadStats } from "@/lib/upload"
import type { PickedFile } from "@/types/bag"
import { ConfirmSheet } from "../confirm-sheet"
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
          className={buttonClass({ variant: "primary", size: "xl" }, cx(shared.wide, styles.pick))}
          aria-disabled={folderMode || uploading || undefined}
          title={folderMode ? t("upload.oneFolder") : undefined}
        >
          <Upload className={styles.pickIcon} aria-hidden="true" />
          <span>{t("upload.files")}</span>
          <input type="file" multiple disabled={folderMode || uploading} onChange={pickFromInput} className={styles.srInput} />
        </label>
        <label className={buttonClass({ size: "xl" }, cx(shared.wide, styles.pick))} aria-disabled={uploading || undefined}>
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
      <p className={styles.max}>{t("upload.max", { size: fmt.bytes(MAX_BAG_BYTES, "down") })}</p>
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
  const [gutter, gutterRef] = useScrollbarGutter()

  return (
    <section className={styles.list}>
      <div className={styles.listHead}>
        <SectionTitle size="lg" icon={Files}>
          <span>{t("upload.picked")}</span>
        </SectionTitle>
        <span className={shared.spacer} />
        <Button variant="text" tone="red" onClick={onClear} disabled={uploading}>
          {t("ui:ui.clear")}
        </Button>
      </div>

      <Card striped>
        <DataTable
          columns="minmax(0, 1fr) max-content max-content"
          style={{ "--list-gutter": gutter } as CSSProperties}
          className={styles.grid}
        >
          <DataTableHead className={styles.head}>
            <DataHeadCell>{t("upload.colFile")}</DataHeadCell>
            <DataHeadCell>{t("upload.colSize")}</DataHeadCell>
            <span />
          </DataTableHead>

          <div
            ref={gutterRef}
            className={styles.scroll}
            onScroll={(event) => {
              if (shownLimit < files.length && nearBottom(event.currentTarget, NEAR_BOTTOM_PX)) {
                setShownLimit((current) => current + ROWS_PER_PAGE)
              }
            }}
          >
            <DataTableRows>
              {files.slice(0, shownLimit).map((file, index) => {
                const [stem, extension] = splitFileName(file.name)

                return (
                  <DataRow key={`${file.name}-${index}`}>
                    <div className={styles.lead}>
                      {file.name.includes("/") ? (
                        <Folder className={styles.rowIcon} aria-hidden="true" />
                      ) : (
                        <FileIcon className={styles.rowIcon} aria-hidden="true" />
                      )}
                      <DataCell
                        label={t("upload.colFile")}
                        title={file.name}
                        valueClassName={styles.fileName}
                        value={
                          <>
                            <span className={shared.ellipsis}>{stem}</span>
                            <span className={styles.fileExt}>{extension}</span>
                          </>
                        }
                      />
                    </div>
                    <DataCell label={t("upload.colSize")} value={fmt.bytes(file.size)} />
                    <IconButton size="xs" tone="red" label={t("upload.removeFile")} onClick={() => onRemove(index)} disabled={uploading}>
                      <X className={glyphClass("xs")} aria-hidden="true" />
                    </IconButton>
                  </DataRow>
                )
              })}
            </DataTableRows>
          </div>

          <p className={styles.foot}>
            {t("upload.total", { files: files.length, size: fmt.bytes(totalSize(files)) })}
          </p>
        </DataTable>
      </Card>
    </section>
  )
}

interface UploadStepProps {
  files: PickedFile[]
  description: string
  progress: number | null
  stats: UploadStats | null
  error: string | null
  errorStatus: number | null
  errorDetail: string
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
  stats,
  error,
  errorStatus,
  errorDetail,
  onPick,
  onReplace,
  onRemove,
  onClear,
  onDescription,
  onSubmit,
  onCancel,
}: UploadStepProps) => {
  const { t, i18n } = useTranslation()
  const lang = pickLang(i18n.language)
  const [pendingFolder, setPendingFolder] = useState<PickedFile[] | null>(null)
  const [pickError, setPickError] = useState<{ errorKey: string; names?: string[] } | null>(null)

  const descriptionLength = [...description].length
  const size = totalSize(files)
  const tooLarge = size > MAX_BAG_BYTES
  const tooMany = files.length > MAX_BAG_FILES
  const folderMode = hasFolder(files)
  const uploading = progress !== null
  const assembling = progress === 100
  const sentBytes = stats?.total ? (stats.loaded / stats.total) * size : 0
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (uploading) cancelRef.current?.focus({ preventScroll: true })
  }, [uploading])

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
        <SectionTitle size="lg" icon={Upload}>
          <span>{t("steps.upload")}</span>
        </SectionTitle>
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
            <a href="https://github.com/xssnick/TON-Torrent" target="_blank" rel="noopener noreferrer" className={buttonClass({ size: "sm" })}>
              {t("upload.torrent")}
            </a>
          }
        >
          {t("upload.tooLarge", { max: fmt.bytes(MAX_BAG_BYTES, "down") })}
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
              <SectionTitle size="lg" icon={FileText}>
                <span>{t("files.desc")}</span>
                <span className={styles.optional}>({t("upload.optional")})</span>
              </SectionTitle>
            </div>

            <TextField
              value={description}
              aria-label={t("files.desc")}
              onChange={onDescription}
              disabled={uploading}
              counter={`${descriptionLength} / ${MAX_DESCRIPTION}`}
              invalid={descriptionLength > MAX_DESCRIPTION}
            />

            {uploading ? (
              <>
                <div className={styles.progress}>
                  <span className={styles.progressHead}>
                    <span className={styles.progressNote}>{t(assembling ? "upload.assembling" : "upload.sending")}</span>
                    <span className={styles.progressAmount}>
                      {assembling
                        ? fmt.bytes(size)
                        : sentBytes > 0 && t("upload.amount", { loaded: fmt.bytes(sentBytes), total: fmt.bytes(size) })}
                    </span>
                  </span>
                  <span className={styles.progressRow}>
                    <span
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                      className={styles.progressTrack}
                    >
                      <span style={{ width: `${progress}%` }} className={styles.progressFill} />
                    </span>
                    <span className={styles.progressValue}>{progress}%</span>
                  </span>
                  <span className={styles.progressMeta}>
                    {[
                      !assembling && stats?.speed != null && t("upload.perSecond", { value: formatBytesOrZero(stats.speed) }),
                      !assembling && stats?.left != null && t("upload.left", { time: formatDuration(roundedLeft(stats.left), lang) }),
                      t("upload.elapsed", { time: formatCountdown(stats?.elapsed ?? 0) }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>

                <ActionRow className={styles.submit}>
                  <Button size="xl" ref={cancelRef} onClick={onCancel}>
                    {t("ui.cancel")}
                  </Button>
                </ActionRow>
              </>
            ) : (
              <ActionRow className={styles.submit}>
                <Button
                  variant="primary"
                  size="xl"
                  onClick={onSubmit}
                  disabled={tooLarge || tooMany || descriptionLength > MAX_DESCRIPTION}
                >
                  {t("upload.submit")}
                </Button>
              </ActionRow>
            )}
          </section>
        </>
      )}

      {error && (
        <Notice className={styles.notice} tone="red">
          {t(error, { max: MAX_BAG_FILES })}
          {errorStatus !== null && (
            <span className={shared.errorCode}>
              {t("errors.statusCode", { status: errorStatus })}
              {errorDetail && ` · ${errorDetail}`}
            </span>
          )}
        </Notice>
      )}

      <ConfirmSheet
        open={pendingFolder !== null}
        title={t("upload.replaceTitle")}
        note={t("upload.replaceNote", { count: files.length })}
        confirmLabel={t("upload.replace")}
        onConfirm={() => {
          if (pendingFolder) onReplace(pendingFolder)
        }}
        onClose={() => setPendingFolder(null)}
      />
    </div>
  )
}
