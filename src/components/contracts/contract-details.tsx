import { useTranslation } from "react-i18next"
import {
  Badge,
  Button,
  Card,
  CheckRatio,
  cx,
  DataCell,
  DataHeadCell,
  DataLead,
  DataRow,
  DataTable,
  DataTableHead,
  DataTableRows,
  Hint,
  Notice,
  StatusBar,
  StatusLine,
} from "@myton/ui"
import { DAY, EMPTY, explorerUrl, fmt } from "@myton/ui/domain"
import { pickLang } from "@myton/ui/i18n"
import { gatewayUrl } from "@/lib/api"
import { checksTone, useCheckLabel } from "@/lib/check-label"
import { contractProblem, contractStatus, countChecks, paymentTone, shownChecks, silentProviders, type ContractRow } from "@/lib/contracts"
import { useContractData, type ContractState } from "@/lib/contracts-cache"
import { GHOST_TON, formatDate, formatDateTime, formatDuration, nowSeconds, tonLabel } from "@/lib/format"
import { PROOF_STEPS, dailyCost, paidDaysLeft, payoutDays } from "@/lib/pricing"
import type { EditorKind } from "./contract-row"
import { SheetField, SheetSection } from "../sheet-fields"
import shared from "../shared.module.css"
import styles from "./contract-details.module.css"

const MIDDLE_PROOF_DAYS = PROOF_STEPS[Math.floor(PROOF_STEPS.length / 2)]

const HEAD_KEYS = ["table.key", "details.priceDay", "details.span", "details.check", "details.checked", "details.lastProof", "details.nextProof"]

interface ContractDetailsProps {
  contract: ContractRow
  copied: string | null
  onCopy: (value: string) => void
  onOpenProvider: (pubkey: string) => void
  onAction: (kind: EditorKind) => void
  onAskWithdraw: () => void
}

export const ContractDetails = ({ contract, copied, onCopy, onOpenProvider, onAction, onAskWithdraw }: ContractDetailsProps) => {
  const { t, i18n } = useTranslation()
  const lang = pickLang(i18n.language)
  const { state, statuses, unreadable, offline, retry } = useContractData(contract.address, true)

  const now = nowSeconds()
  const checkLabel = useCheckLabel(now)

  const checks = countChecks(statuses, contract.address)
  const shown = shownChecks({ ...checks, state })
  const statusByKey = new Map(statuses.map((status) => [status.provider_pubkey, status]))
  const bagId = contract.bagId || state?.torrentHash || ""

  const perDay = state ? dailyCost(state.fileSize, state.providers) : 0
  const paidDays = state ? paidDaysLeft(state.fileSize, state.providers, state.balance, now) : null
  const payTone = state ? paymentTone(paidDays, payoutDays(state.fileSize, state.providers)) : null

  const spanRange = (providers: ContractState["providers"]): string => {
    const spans = providers.map(({ maxSpan }) => maxSpan)
    const low = formatDuration(Math.min(...spans), lang)
    const high = formatDuration(Math.max(...spans), lang)
    return low === high ? low : `${low} – ${high}`
  }

  const shaped = { ...contract, ...checks, state }
  const status = contractStatus(shaped)
  const stateWord = t(status?.word ?? "ui:status.noData")
  const row = { ...contract, state }
  const problem = contractProblem(row, now)
  const paidUntil = formatDate(now + (paidDays ?? 0) * DAY, i18n.language)
  const problemNote =
    problem === "lost"
      ? t(row.state?.providers.length === 0 ? "fix.emptyConfirm" : "fix.lostConfirm")
      : problem === "balance"
        ? t((paidDays ?? 0) > 0 ? "fix.noteBalance" : "fix.noteBalanceOut", { date: paidUntil })
        : t("fix.noteReplace", { count: silentProviders(row, now).length, total: row.state?.providers.length ?? 0 })

  return (
    <div className={styles.body}>
      <Card frame data-tone={status?.tone}>
        <StatusBar parts={[{ key: "stored", count: shown?.valid ?? 0 }]} total={shown?.total ?? 0} />
        <div className={styles.statusBody}>
          <StatusLine
            label={stateWord}
            trailing={
              !contract.closed &&
              shown !== null &&
              shown.ran > 0 && (
                <span className={styles.checksRow}>
                  <span className={styles.checksLabel}>{t("details.checksOf")}</span>
                  <CheckRatio passed={shown.valid} total={shown.total} tone={checksTone(shown.valid, shown.total)} />
                </span>
              )
            }
          />
        </div>
      </Card>

      {problem && (
        <Notice
          tone={problem === "lost" || (problem === "balance" && payTone === "red") ? "red" : "yellow"}
          action={
            <Button size="sm" onClick={problem === "lost" ? onAskWithdraw : () => onAction(problem === "balance" ? "extend" : "fix")}>
              {t(problem === "lost" ? "files.withdrawTitle" : problem === "balance" ? "files.topup" : "fix.replace")}
            </Button>
          }
        >
          {problemNote}
        </Notice>
      )}

      <div className={styles.groups}>
        <SheetSection title={t("details.contract")}>
          <SheetField
            label={t("files.contract")}
            id={contract.address}
            href={explorerUrl(contract.address)}
            copy={contract.address}
            copied={copied}
            onCopy={onCopy}
          />
          <SheetField
            label={t("files.bagId")}
            id={bagId || undefined}
            href={bagId ? gatewayUrl(bagId) : undefined}
            upper
            copy={bagId}
            copied={copied}
            onCopy={onCopy}
          />
          {contract.description && (
            <SheetField label={t("files.desc")} value={contract.description} title={contract.description} />
          )}
          <SheetField label={t("files.size")} value={fmt.bytes(contract.size || state?.fileSize || 0)} />
          {contract.createdAt > 0 && (
            <SheetField label={t("details.created")} value={formatDate(contract.createdAt, i18n.language)} />
          )}
        </SheetSection>

        <SheetSection title={t("details.payment")}>
          {unreadable ? (
            <Notice tone="red" className={styles.paymentAlert}>
              {t("providers.unreadable")}
            </Notice>
          ) : offline && !state ? (
            <Notice
              tone="red"
              className={styles.paymentAlert}
              action={
                <Button size="sm" onClick={retry}>
                  {t("ui:ui.retry")}
                </Button>
              }
            >
              {t("files.topupOffline")}
            </Notice>
          ) : !state ? (
            <>
              <SheetField ghost label={t("details.balance")} value={tonLabel(GHOST_TON)} />
              <SheetField ghost label={t("details.perDay")} value={tonLabel(GHOST_TON, 6)} />
              <SheetField ghost label={t("files.paidUntil")} value={formatDate(now, i18n.language)} />
              <SheetField ghost label={t("details.span")} value={formatDuration(MIDDLE_PROOF_DAYS * DAY, lang)} />
            </>
          ) : (
            <>
              <SheetField label={t("details.balance")} value={tonLabel(state.balance)} />
              <SheetField label={t("details.perDay")} value={tonLabel(perDay, 6)} />
              <SheetField
                label={t("files.paidUntil")}
                value={paidDays === null ? EMPTY : formatDate(now + paidDays * DAY, i18n.language)}
                alert={payTone === "red"}
                warn={payTone === "yellow"}
              />
              <SheetField label={t("details.span")} value={spanRange(state.providers)} />
            </>
          )}
        </SheetSection>
      </div>

      {state && state.providers.length > 0 && (
        <SheetSection title={t("files.providers")}>
          <Card striped>
            <DataTable columns={`repeat(${HEAD_KEYS.length}, max-content)`}>
              <DataTableHead>
                {HEAD_KEYS.map((key) => (
                  <DataHeadCell key={key}>
                    <span title={t(key)} className={shared.ellipsis}>
                      {t(key)}
                    </span>
                    {key === "details.check" && <Hint text={t("details.checkHint")} />}
                  </DataHeadCell>
                ))}
              </DataTableHead>
              <DataTableRows>
                {state.providers.map((provider) => {
                  const { pubkey, lastProofTime: lastProof, maxSpan } = provider
                  const check = checkLabel(statusByKey.get(pubkey))
                  const nextProof = lastProof ? lastProof + maxSpan : null
                  const perDayLabel = tonLabel(dailyCost(state.fileSize, [provider]), 6)
                  const spanLabel = formatDuration(maxSpan, lang)
                  const keyShort = fmt.shortKey(pubkey)
                  const open = () => onOpenProvider(pubkey)

                  return (
                    <DataRow
                      key={pubkey}
                      onOpen={open}
                      label={`${t("catalog.providerDetails")} ${keyShort}`}
                    >
                      <DataLead value={keyShort} title={pubkey} upper copy={pubkey} copied={copied} onCopy={onCopy} />
                      <DataCell label={t("details.priceDay")} value={perDayLabel} />
                      <DataCell label={t("details.span")} value={spanLabel} />
                      <DataCell label={t("details.check")} className={styles.checkColumn}>
                        {check ? (
                          <span data-tone={check.tone} className={styles.checkCell}>
                            {check.kind === "stored" ? (
                              <Badge tone={check.tone} size="sm" dot>
                                {check.short}
                              </Badge>
                            ) : (
                              <Hint text={check.long}>
                                <Badge tone={check.tone} size="sm" dot>
                                  {check.short}
                                </Badge>
                              </Hint>
                            )}
                          </span>
                        ) : (
                          <span data-tone="gray" className={styles.checkCell}>
                            <Badge tone="gray" size="sm" dot>
                              {t("details.checkNotRun")}
                            </Badge>
                          </span>
                        )}
                      </DataCell>
                      <DataCell
                        label={t("details.checked")}
                        value={check?.agoShort || EMPTY}
                        title={check?.agoShort ? formatDateTime(check.at, i18n.language) : undefined}
                      />
                      <DataCell
                        label={t("details.lastProof")}
                        value={lastProof ? formatDate(lastProof, i18n.language) : EMPTY}
                      />
                      <DataCell
                        label={t("details.nextProof")}
                        value={nextProof === null ? EMPTY : formatDate(nextProof, i18n.language)}
                        valueClassName={cx(nextProof !== null && nextProof < now && shared.inkDanger)}
                      />
                    </DataRow>
                  )
                })}
              </DataTableRows>
            </DataTable>
          </Card>
        </SheetSection>
      )}
    </div>
  )
}
