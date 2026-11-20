import { useTranslation } from "react-i18next"
import { Notice, StatusCard } from "@myton/ui"
import { dominantReason, EMPTY, explorerUrl, fmt, providerStatus, staleSignals, toFriendly, type Provider } from "@myton/ui/domain"
import { pickLang } from "@myton/ui/i18n"
import { providerFields, reasonKey, statusView, type ProviderFieldId } from "@myton/ui/locale"
import { SheetField, SheetSection, type SheetFieldProps } from "../sheet-fields"
import styles from "./provider-details.module.css"

type FieldSpec = Omit<SheetFieldProps, "copied" | "onCopy">

const OFF_CATALOG_EMPTY = new Set<ProviderFieldId>(["span", "workingTime", "uptime", "rating", "price"])

interface Section {
  title: string
  fields: FieldSpec[]
}

interface ProviderDetailsProps {
  provider: Provider
  unlisted?: boolean
  catalogReady?: boolean
  fetchedAt: number
  copied: string | null
  onCopy: (value: string) => void
}

export const ProviderDetails = ({ provider, unlisted = false, catalogReady = true, fetchedAt, copied, onCopy }: ProviderDetailsProps) => {
  const { t, i18n } = useTranslation()
  const lang = pickLang(i18n.language)

  const status = statusView(providerStatus(provider), lang)

  const describe = (reason: number | null) => t(`ui:reason.${reasonKey(reason)}`, { code: reason })

  const now = fetchedAt
  const telemetry = provider.telemetry
  const address = provider.address ? (toFriendly(provider.address) ?? provider.address) : null

  const sections: Section[] = [
    {
      title: t("ui:filters.group.provider"),
      fields: [
        {
          label: t("table.key"),
          id: provider.pubkey,
          upper: true,
          copy: provider.pubkey,
        },
        {
          label: t("ui:details.address"),
          id: address ?? undefined,
          copy: address ?? undefined,
          href: address ? explorerUrl(address) : undefined,
        },
        ...providerFields(provider, now, lang).map(({ id, label, value, stale }) =>
          unlisted && OFF_CATALOG_EMPTY.has(id) ? { label, value: EMPTY } : { label, value, alert: stale },
        ),
      ],
    },
  ]

  if (provider.sendsTelemetry && telemetry) {
    sections.push(
      {
        title: t("ui:filters.group.software"),
        fields: [
          {
            label: t("ui:details.storageHash"),
            value: fmt.shortText(telemetry.storageGitHash),
            mono: true,
            title: telemetry.storageGitHash ?? "",
            copy: telemetry.storageGitHash ?? undefined,
          },
          {
            label: t("ui:details.providerHash"),
            value: fmt.shortText(telemetry.providerGitHash),
            mono: true,
            title: telemetry.providerGitHash ?? "",
            copy: telemetry.providerGitHash ?? undefined,
          },
        ],
      },
      {
        title: t("ui:filters.group.benchmarks"),
        fields: [
          { label: t("ui:details.diskRead"), value: fmt.diskSpeed(telemetry.diskRead) },
          { label: t("ui:details.diskWrite"), value: fmt.diskSpeed(telemetry.diskWrite) },
        ],
      },
      {
        title: t("ui:filters.group.hardware"),
        fields: [
          { label: t("ui:details.cpuName"), value: fmt.shortText(telemetry.cpuName), title: telemetry.cpuName ?? "" },
          { label: t("ui:details.cpuCount"), value: telemetry.cpuCount == null ? EMPTY : String(telemetry.cpuCount) },
          {
            label: t("ui:details.cpuVirtual"),
            value: telemetry.cpuVirtual == null ? EMPTY : t(telemetry.cpuVirtual ? "ui:filters.yes" : "ui:filters.no"),
          },
          {
            label: t("ui:details.ram"),
            value: fmt.spacePair(telemetry.usageRamBytes, telemetry.totalRamBytes),
          },
          {
            label: t("ui:details.space"),
            value: fmt.spacePair(telemetry.usedSpaceBytes, telemetry.totalSpaceBytes),
          },
        ],
      },
      {
        title: t("ui:filters.group.network"),
        fields: [
          {
            label: t("ui:details.download"),
            value: fmt.mbits(telemetry.downloadBits),
          },
          {
            label: t("ui:details.upload"),
            value: fmt.mbits(telemetry.uploadBits),
          },
          {
            label: t("ui:details.ping"),
            value: fmt.ping(telemetry.pingMs),
          },
          { label: t("ui:details.country"), value: telemetry.country || EMPTY },
          { label: t("ui:details.isp"), value: fmt.shortText(telemetry.isp), title: telemetry.isp ?? "" },
        ],
      },
    )
  }

  return (
    <div className={styles.body}>
      {unlisted && catalogReady && <Notice tone="yellow">{t("catalog.offCatalogFull")}</Notice>}
      {staleSignals(provider, now).map((signal) => (
        <Notice key={signal} tone="red">
          {t(`ui:stale.${signal}`)}
        </Notice>
      ))}
      <StatusCard
        tone={status.tone}
        label={status.label}
        ratio={status.ratio}
        description={describe(dominantReason(provider.reasons))}
        reasons={provider.reasons}
        describe={describe}
      />

      <div className={styles.columns}>
        {sections.map((section) => (
          <SheetSection key={section.title} title={section.title}>
            {section.fields.map((field) => (
              <SheetField key={field.label} {...field} copied={copied} onCopy={onCopy} />
            ))}
          </SheetSection>
        ))}
      </div>
    </div>
  )
}
