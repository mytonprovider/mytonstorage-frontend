import { FileText, Server, Wallet } from "lucide-react"
import { useTranslation } from "react-i18next"
import { gatewayUrl } from "@/lib/api"
import { useCheckLabel } from "@/lib/check-label"
import { LOW_BALANCE_DAYS, contractTone, countChecks, scanUrl } from "@/lib/contracts"
import { useContractData } from "@/lib/contracts-cache"
import { GHOST_TON, SECONDS_IN_DAY, formatBytes, formatDate, formatDateTime, formatDuration, nowSeconds, shortenMiddle, tonLabel } from "@/lib/format"
import { PROOF_STEPS, dailyCost, paidDaysLeft, proofDelays } from "@/lib/pricing"
import type { StorageContract } from "@/types/contract"
import { cx } from "@/lib/cx"
import { Hint } from "../hint"
import { Notice } from "../notice"
import { SheetField, SheetSection } from "../sheet-fields"
import { GhostCopy, Ratio, TableCell, TableLead } from "../table"
import shared from "../shared.module.css"
import styles from "./contract-details.module.css"

const MIDDLE_PROOF_DAYS = PROOF_STEPS[Math.floor(PROOF_STEPS.length / 2)]

const HEAD_KEYS = ["table.key", "details.priceDay", "details.span", "files.status", "details.check", "details.lastProof", "details.nextProof"]

interface ContractDetailsProps {
  contract: StorageContract
  copied: string | null
  onCopy: (value: string) => void
}

export const ContractDetails = ({ contract, copied, onCopy }: ContractDetailsProps) => {
  const { t, i18n } = useTranslation()
  const { economics, statuses, unreadable, offline, retry } = useContractData(contract.address, true)

  const now = nowSeconds()
  const checkLabel = useCheckLabel(now)

  const checks = statuses.length > 0 ? countChecks(statuses, contract.address) : { valid: contract.valid, total: contract.total }
  const statusByKey = new Map(statuses.map((status) => [status.provider_pubkey, status]))
  const bagId = contract.bagId || economics?.bagId || ""

  const perDay = economics ? dailyCost(economics.fileSize, economics.ratesPerMibDay) : 0
  const paidDays = economics
    ? paidDaysLeft(
        economics.fileSize,
        economics.ratesPerMibDay,
        economics.spans,
        economics.balance,
        proofDelays(economics.spans, economics.lastProofs, now),
      )
    : null

  const spanRange = (spans: number[]): string => {
    const low = formatDuration(Math.min(...spans), t)
    const high = formatDuration(Math.max(...spans), t)
    return low === high ? low : `${low} – ${high}`
  }

  const nextProofOf = (index: number): number | null => {
    const lastProof = economics?.lastProofs[index] ?? 0
    const span = economics?.spans[index] ?? 0
    if (!lastProof || !span) return null
    return lastProof + span
  }

  const tone = contractTone({ ...contract, ...checks })
  const stateWord = contract.closed
    ? t("files.closed")
    : checks.total === 0
      ? t("status.noChecksYet")
      : tone === "green"
        ? t("details.stateOk")
        : tone === "yellow"
          ? t("details.statePartial")
          : tone === "red"
            ? t("details.stateFail")
            : t("details.statePending")

  return (
    <div className={styles.body}>
      <section data-tone={tone} className={styles.statusCard}>
        <div className={styles.bar}>
          <span style={{ flexGrow: checks.valid }} className={styles.barFill} />
          <span style={{ flexGrow: checks.total - checks.valid }} />
        </div>
        <div className={styles.statusBody}>
          <span className={styles.statusWord}>
            <span className={shared.dotStrong} aria-hidden="true" />
            {stateWord}
          </span>
          {!contract.closed && checks.total > 0 && (
            <span className={styles.checksRow}>
              <span className={styles.checksLabel}>{t("details.checksOf")}</span>
              <Ratio valid={checks.valid} total={checks.total} />
            </span>
          )}
        </div>
      </section>

      <SheetSection icon={FileText} title={t("details.contract")}>
        <SheetField
          label={t("files.contract")}
          value={shortenMiddle(contract.address, 6, 6)}
          title={contract.address}
          href={scanUrl(contract.address)}
          mono
          copy={contract.address}
          copied={copied}
          onCopy={onCopy}
        />
        <SheetField
          label={t("files.bagId")}
          value={shortenMiddle(bagId.toUpperCase(), 6, 6)}
          title={bagId.toUpperCase() || undefined}
          href={bagId ? gatewayUrl(bagId) : undefined}
          mono
          copy={bagId.toUpperCase()}
          copied={copied}
          onCopy={onCopy}
        />
        {contract.description && (
          <SheetField label={t("files.desc")} value={contract.description} title={contract.description} />
        )}
        <SheetField label={t("files.size")} value={formatBytes(contract.size || economics?.fileSize || 0)} />
        {contract.createdAt > 0 && (
          <SheetField label={t("details.created")} value={formatDate(contract.createdAt, i18n.language)} />
        )}
      </SheetSection>

      <SheetSection icon={Wallet} title={t("details.payment")}>
        {unreadable ? (
          <Notice tone="red" className={styles.paymentAlert}>
            {t("providers.unreadable")}
          </Notice>
        ) : offline && !economics ? (
          <Notice
            tone="red"
            className={styles.paymentAlert}
            action={
              <button type="button" onClick={retry}>
                {t("ui.retry")}
              </button>
            }
          >
            {t("files.topupOffline")}
          </Notice>
        ) : !economics ? (
          <>
            <SheetField ghost label={t("details.balance")} value={tonLabel(GHOST_TON)} />
            <SheetField ghost label={t("details.perDay")} value={tonLabel(GHOST_TON, 6)} />
            <SheetField ghost label={t("files.paidUntil")} value={formatDate(now, i18n.language)} />
            <SheetField ghost label={t("details.span")} value={formatDuration(MIDDLE_PROOF_DAYS * SECONDS_IN_DAY, t)} />
          </>
        ) : (
          <>
            <SheetField label={t("details.balance")} value={tonLabel(economics.balance)} />
            <SheetField label={t("details.perDay")} value={tonLabel(perDay, 6)} />
            <SheetField
              label={t("files.paidUntil")}
              value={paidDays === null ? "" : formatDate(now + paidDays * SECONDS_IN_DAY, i18n.language)}
              alert={paidDays !== null && paidDays < LOW_BALANCE_DAYS}
            />
            <SheetField label={t("details.span")} value={spanRange(economics.spans)} />
          </>
        )}
      </SheetSection>

      {!economics && !unreadable && !offline && (
        <SheetSection icon={Server} title={t("files.providers")}>
          <div className={styles.table}>
            <div className={shared.tableWide}>
              <div className={styles.head}>
                {HEAD_KEYS.map((key) => (
                  <span key={key} className={shared.tableHeadCell}>
                    <span title={t(key)} className={shared.ellipsis}>
                      {t(key)}
                    </span>
                  </span>
                ))}
              </div>
              {[0, 1, 2].map((slot) => (
                <div key={slot} aria-hidden="true" className={styles.row}>
                  <span className={shared.tableLead}>
                    <span className={cx(shared.tableMono, shared.ghost)}>{shortenMiddle("8".repeat(64).toUpperCase(), 6, 6)}</span>
                    <GhostCopy />
                  </span>
                  <TableCell ghost label={t("details.priceDay")} value={tonLabel(GHOST_TON, 6)} />
                  <TableCell ghost label={t("details.span")} value={formatDuration(MIDDLE_PROOF_DAYS * SECONDS_IN_DAY, t)} />
                  <TableCell ghost label={t("files.status")} value={t("details.checkOk")} />
                  <TableCell ghost label={t("details.check")} value={t("provider.ago", { time: formatDuration(3600, t) })} />
                  <TableCell ghost label={t("details.lastProof")} value={formatDate(now, i18n.language)} />
                  <TableCell ghost label={t("details.nextProof")} value={formatDate(now, i18n.language)} />
                </div>
              ))}
            </div>
          </div>
        </SheetSection>
      )}

      {economics && economics.pubkeys.length > 0 && (
        <SheetSection icon={Server} title={t("files.providers")}>
          <div className={styles.table}>
            <div className={shared.tableWide}>
              <div className={styles.head}>
                {HEAD_KEYS.map((key) => (
                  <span key={key} className={shared.tableHeadCell}>
                    <span title={t(key)} className={shared.ellipsis}>
                      {t(key)}
                    </span>
                  </span>
                ))}
              </div>
              {economics.pubkeys.map((pubkey, index) => {
                const check = checkLabel(statusByKey.get(pubkey))
                const lastProof = economics.lastProofs[index] ?? 0
                const nextProof = nextProofOf(index)
                const perDayLabel = tonLabel(dailyCost(economics.fileSize, [economics.ratesPerMibDay[index]]), 6)
                const spanLabel = formatDuration(economics.spans[index], t)

                return (
                  <div key={pubkey} className={styles.row}>
                    <TableLead
                      shortValue={shortenMiddle(pubkey.toUpperCase(), 6, 6)}
                      title={pubkey}
                      copy={pubkey}
                      copied={copied}
                      onCopy={onCopy}
                    />
                    <TableCell label={t("details.priceDay")} value={perDayLabel} />
                    <TableCell label={t("details.span")} value={spanLabel} />
                    <TableCell label={t("files.status")}>
                      {check ? (
                        <span data-tone={check.failed ? "red" : "green"} className={styles.checkCell}>
                          <span className={styles.checkWord}>{check.short}</span>
                          {check.failed && <Hint text={check.long} />}
                        </span>
                      ) : (
                        <span className={shared.tableValue} />
                      )}
                    </TableCell>
                    <TableCell label={t("details.check")}>
                      {check?.ago ? (
                        <span title={formatDateTime(check.at, i18n.language)} className={shared.tableValue}>
                          {check.agoShort}
                        </span>
                      ) : (
                        <span className={shared.tableValue} />
                      )}
                    </TableCell>
                    <TableCell
                      label={t("details.lastProof")}
                      value={lastProof ? formatDate(lastProof, i18n.language) : ""}
                    />
                    <TableCell label={t("details.nextProof")}>
                      {nextProof === null ? (
                        <span className={shared.tableValue} />
                      ) : nextProof < now ? (
                        <span data-tone="red" className={styles.checkWord}>
                          {formatDate(nextProof, i18n.language)}
                        </span>
                      ) : (
                        <span className={shared.tableValue}>{formatDate(nextProof, i18n.language)}</span>
                      )}
                    </TableCell>
                  </div>
                )
              })}
            </div>
          </div>
        </SheetSection>
      )}
    </div>
  )
}
