import { FileText, Loader, Server, Wallet } from "lucide-react"
import { useTranslation } from "react-i18next"
import { gatewayUrl } from "@/lib/api"
import { useCheckLabel } from "@/lib/check-label"
import { contractStatus, contractVerdict, countChecks, hiredAt, paymentTone, proofDue, scanUrl, shownChecks, type ContractRow, type NotifyState } from "@/lib/contracts"
import { useContractData, type ContractState } from "@/lib/contracts-cache"
import { cx } from "@/lib/cx"
import { GHOST_TON, SECONDS_IN_DAY, formatBytes, formatDate, formatDateTime, formatDuration, nowSeconds, shortenMiddle, tonLabel } from "@/lib/format"
import { PROOF_STEPS, dailyCost, paidDaysLeft } from "@/lib/pricing"
import type { StorageContract } from "@/types/contract"
import { Hint } from "../hint"
import { Notice } from "../notice"
import { SheetField, SheetSection } from "../sheet-fields"
import { Ratio, TableCell, TableFrame, TableHead, TableLead, TableRows, TableScroll } from "../table"
import shared from "../shared.module.css"
import styles from "./contract-details.module.css"

const MIDDLE_PROOF_DAYS = PROOF_STEPS[Math.floor(PROOF_STEPS.length / 2)]

const HEAD_KEYS = ["table.key", "details.priceDay", "details.span", "files.status", "details.check", "details.lastProof", "details.nextProof"]

interface ContractDetailsProps {
  contract: StorageContract & Pick<ContractRow, "lastEventAt" | "pending" | "stored">
  copied: string | null
  onCopy: (value: string) => void
  notifyState: NotifyState | null
  onNotify: (providers: string[]) => void
}

export const ContractDetails = ({ contract, copied, onCopy, notifyState, onNotify }: ContractDetailsProps) => {
  const { t, i18n } = useTranslation()
  const { state, statuses, unreadable, offline, retry } = useContractData(contract.address, true)

  const now = nowSeconds()
  const checkLabel = useCheckLabel(now)

  const checks = statuses.length > 0 ? countChecks(statuses, contract.address) : { valid: contract.valid, total: contract.total, pending: contract.pending, stored: contract.stored }
  const shown = shownChecks({ ...checks, state }) ?? { valid: checks.valid, total: checks.total }
  const statusByKey = new Map(statuses.map((status) => [status.provider_pubkey, status]))
  const hired = hiredAt(contract)
  const behind = state ? state.providers.filter((provider) => now > proofDue(provider, hired, state.fileSize)) : []
  const holding = behind.filter(({ pubkey }) => statusByKey.get(pubkey)?.reason === 0).length
  const silent = behind.filter(({ pubkey }) => statusByKey.get(pubkey)?.reason !== 0)
  const bagId = contract.bagId || state?.torrentHash || ""

  const perDay = state ? dailyCost(state.fileSize, state.providers) : 0
  const paidDays = state ? paidDaysLeft(state.fileSize, state.providers, state.balance, now) : null

  const spanRange = (providers: ContractState["providers"]): string => {
    const spans = providers.map(({ maxSpan }) => maxSpan)
    const low = formatDuration(Math.min(...spans), t)
    const high = formatDuration(Math.max(...spans), t)
    return low === high ? low : `${low} – ${high}`
  }

  const shaped = { ...contract, valid: checks.valid, total: checks.total, state }
  const status = contractStatus(shaped, now)
  const unfunded = contractVerdict(shaped, now) === "unpaid" || (paidDays !== null && paidDays <= 0)
  const stateWord = t(status?.word ?? "status.noData")

  return (
    <div className={styles.body}>
      <section data-tone={status?.tone} className={styles.statusCard}>
        <div className={styles.bar}>
          <span style={{ flexGrow: shown.valid }} className={styles.barFill} />
          <span style={{ flexGrow: shown.total - shown.valid }} />
        </div>
        <div className={styles.statusBody}>
          <span className={styles.statusWord}>
            <span className={shared.dot} aria-hidden="true" />
            {stateWord}
          </span>
          {!contract.closed && shown.total > 0 && (
            <span className={styles.checksRow}>
              <span className={styles.checksLabel}>{t("details.checksOf")}</span>
              <Ratio valid={shown.valid} total={shown.total} />
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
          value={shortenMiddle(bagId, 6, 6)}
          title={bagId || undefined}
          href={bagId ? gatewayUrl(bagId) : undefined}
          mono
          upper
          copy={bagId}
          copied={copied}
          onCopy={onCopy}
        />
        {contract.description && (
          <SheetField label={t("files.desc")} value={contract.description} title={contract.description} />
        )}
        <SheetField label={t("files.size")} value={formatBytes(contract.size || state?.fileSize || 0)} />
        {contract.createdAt > 0 && (
          <SheetField label={t("details.created")} value={formatDate(contract.createdAt, i18n.language)} />
        )}
      </SheetSection>

      <SheetSection icon={Wallet} title={t("details.payment")}>
        {unreadable ? (
          <Notice tone="red" className={styles.paymentAlert}>
            {t("providers.unreadable")}
          </Notice>
        ) : offline && !state ? (
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
        ) : !state ? (
          <>
            <SheetField ghost label={t("details.balance")} value={tonLabel(GHOST_TON)} />
            <SheetField ghost label={t("details.perDay")} value={tonLabel(GHOST_TON, 6)} />
            <SheetField ghost label={t("files.paidUntil")} value={formatDate(now, i18n.language)} />
            <SheetField ghost label={t("details.span")} value={formatDuration(MIDDLE_PROOF_DAYS * SECONDS_IN_DAY, t)} />
          </>
        ) : (
          <>
            <SheetField label={t("details.balance")} value={tonLabel(state.balance)} />
            <SheetField label={t("details.perDay")} value={tonLabel(perDay, 6)} />
            <SheetField
              label={t("files.paidUntil")}
              value={paidDays === null ? "" : formatDate(now + paidDays * SECONDS_IN_DAY, i18n.language)}
              alert={paymentTone(paidDays) === "red"}
              warn={paymentTone(paidDays) === "yellow"}
            />
            <SheetField label={t("details.span")} value={spanRange(state.providers)} />
          </>
        )}
      </SheetSection>

      {state && state.providers.length > 0 && (
        <SheetSection icon={Server} title={t("files.providers")}>
          <TableFrame className={styles.table}>
            <TableScroll className={styles.scroll}>
              <TableHead className={styles.head}>
                {HEAD_KEYS.map((key) => (
                  <span key={key} className={shared.tableHeadCell}>
                    <span title={t(key)} className={shared.ellipsis}>
                      {t(key)}
                    </span>
                  </span>
                ))}
              </TableHead>
              <TableRows className={styles.rows}>
                {state.providers.map((provider) => {
                  const { pubkey, lastProofTime: lastProof, maxSpan } = provider
                  const check = checkLabel(statusByKey.get(pubkey))
                  const nextProof = lastProof ? lastProof + maxSpan : null
                  const perDayLabel = tonLabel(dailyCost(state.fileSize, [provider]), 6)
                  const spanLabel = formatDuration(maxSpan, t)

                  return (
                    <div key={pubkey} className={styles.row}>
                      <TableLead
                        shortValue={shortenMiddle(pubkey, 6, 6)}
                        title={pubkey}
                        upper
                        copy={pubkey}
                        copied={copied}
                        onCopy={onCopy}
                      />
                      <TableCell label={t("details.priceDay")} value={perDayLabel} />
                      <TableCell label={t("details.span")} value={spanLabel} />
                      <TableCell label={t("files.status")}>
                        {check ? (
                          <span data-tone={check.tone} className={styles.checkCell}>
                            {check.kind === "stored" ? (
                              <span className={shared.badge}>
                                <span className={shared.dot} aria-hidden="true" />
                                {check.short}
                              </span>
                            ) : (
                              <Hint text={check.long} className={shared.badge}>
                                <span className={shared.dot} aria-hidden="true" />
                                {check.short}
                              </Hint>
                            )}
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
                          <span className={cx(shared.tableValue, shared.inkDanger)}>
                            {formatDate(nextProof, i18n.language)}
                          </span>
                        ) : (
                          <span className={shared.tableValue}>{formatDate(nextProof, i18n.language)}</span>
                        )}
                      </TableCell>
                    </div>
                  )
                })}
              </TableRows>
            </TableScroll>
          </TableFrame>

          {holding > 0 && (
            <Notice tone="neutral" className={styles.paymentAlert}>
              {t("files.unconfirmed", { count: holding })}
            </Notice>
          )}

          {silent.length > 0 &&
            !unfunded &&
            (notifyState === "sent" ? (
              <Notice tone="green" className={styles.paymentAlert}>
                {t("files.notified")}
              </Notice>
            ) : (
              <Notice
                tone={notifyState === "failed" ? "red" : "yellow"}
                className={styles.paymentAlert}
                action={
                  <button type="button" disabled={notifyState === "sending"} onClick={() => onNotify(state.providers.map(({ pubkey }) => pubkey))}>
                    {notifyState === "sending" && <Loader strokeWidth={2.5} aria-hidden="true" className={shared.spinner} />}
                    <span>{t("files.notify")}</span>
                  </button>
                }
              >
                {notifyState === "failed"
                  ? t("errors.notifyFailed")
                  : t(silent.some(({ lastProofTime }) => lastProofTime > 0) ? "files.stalled" : "files.unproven", { count: silent.length })}
              </Notice>
            ))}
        </SheetSection>
      )}
    </div>
  )
}
