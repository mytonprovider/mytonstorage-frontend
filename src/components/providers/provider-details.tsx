import { useState, type ComponentType } from "react"
import { BarChart2, Cpu, Globe, Info, Server } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { scanUrl } from "@/lib/contracts"
import {
  GRAM,
  MBIT_PER_SECOND,
  MILLISECONDS,
  formatBytes,
  formatDiskSpeed,
  formatDuration,
  formatNumber,
  formatPercent,
  share,
  shortenMiddle,
} from "@/lib/format"
import { priceInTon, statusOf } from "@/lib/providers"
import { toNonBounceable } from "@/lib/ton/ton-address"
import type { Provider } from "@/types/provider"
import { Notice } from "../notice"
import { SheetField, SheetSection, type SheetFieldProps } from "../sheet-fields"
import { Ratio } from "../table"
import shared from "../shared.module.css"
import styles from "./provider-details.module.css"

const STALE_TELEMETRY_SECONDS = 600
const JUST_NOW_SECONDS = 60
const DOMINANT_SHARE = 0.8

type FieldSpec = Omit<SheetFieldProps, "copied" | "onCopy">

interface Section {
  title: string
  icon: ComponentType<{ className?: string; "aria-hidden"?: "true" }>
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
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(false)

  const stats = [...(provider.statuses_reason_stats ?? [])]
    .filter((stat) => Number.isFinite(stat?.cnt) && Number.isFinite(stat.reason) && stat.cnt > 0)
    .sort((a, b) => b.cnt - a.cnt)
  const total = stats.reduce((sum, stat) => sum + stat.cnt, 0)
  const valid = stats.find((stat) => stat.reason === 0)?.cnt ?? 0
  const status = statusOf(provider)

  const describe = (reason: number) =>
    reason === 0 ? t("provider.allChecksPassed") : t([`reason.${reason}`, "status.unknownReason"], { value: String(reason) })

  const toneOf = (reason: number) => statusOf({ ...provider, status: reason, status_ratio: 0 }).tone

  const dominantReason = (): number | null => {
    const top = stats[0]
    if (!top) return null
    if (top.reason !== 0) return top.reason
    if (stats.length === 1 || top.cnt >= total * DOMINANT_SHARE) return 0
    return stats[1].reason
  }

  const dominant = dominantReason()

  const now = Math.floor(fetchedAt / 1000)
  const telemetry = provider.telemetry
  const address = provider.address ? toNonBounceable(provider.address) : null

  const ageField = (label: string, seenAt: number | null | undefined): FieldSpec => {
    if (seenAt == null) return { label, value: "" }

    const age = now - seenAt
    return {
      label,
      value: age < JUST_NOW_SECONDS ? t("provider.justNow") : t("provider.ago", { time: formatDuration(age, t) }),
      alert: age > STALE_TELEMETRY_SECONDS,
    }
  }

  const sections: Section[] = [
    {
      title: t("provider.title"),
      icon: Info,
      fields: [
        {
          label: t("table.key"),
          value: shortenMiddle(provider.pubkey, 6, 6),
          mono: true,
          upper: true,
          title: provider.pubkey,
          copy: provider.pubkey,
        },
        {
          label: t("provider.address"),
          value: shortenMiddle(address, 6, 6),
          mono: true,
          title: address ?? "",
          copy: address ?? undefined,
          href: address ? scanUrl(address) : undefined,
        },
        {
          label: t("details.span"),
          value: unlisted ? "" : `${formatDuration(provider.min_span, t)} – ${formatDuration(provider.max_span, t)}`,
        },
        { label: t("provider.maxBag"), value: formatBytes(provider.max_bag_size_bytes) },
        { label: t("table.workingTime"), value: unlisted ? "" : formatDuration(provider.working_time, t) },
        ageField(t("provider.lastOnline"), provider.last_online_check_time),
        ageField(t("provider.lastTelemetry"), provider.is_send_telemetry ? telemetry?.updated_at : null),
        {
          label: t("table.location"),
          value: provider.location?.country
            ? [provider.location.country, provider.location.city].filter(Boolean).join(", ")
            : t("unknown"),
        },
        { label: t("table.uptime"), value: unlisted ? "" : formatPercent(provider.uptime || 0) },
        { label: t("table.rating"), value: unlisted ? "" : formatNumber(provider.rating || 0, 2) },
        { label: t("table.price"), value: unlisted ? "" : `${formatNumber(priceInTon(provider), 2)} ${GRAM}` },
      ],
    },
  ]

  if (provider.is_send_telemetry && telemetry) {
    sections.push(
      {
        title: t("provider.software"),
        icon: Server,
        fields: [
          {
            label: t("provider.storageHash"),
            value: shortenMiddle(telemetry.storage_git_hash, 14, 6),
            mono: true,
            title: telemetry.storage_git_hash ?? "",
            copy: telemetry.storage_git_hash ?? undefined,
          },
          {
            label: t("provider.providerHash"),
            value: shortenMiddle(telemetry.provider_git_hash, 14, 6),
            mono: true,
            title: telemetry.provider_git_hash ?? "",
            copy: telemetry.provider_git_hash ?? undefined,
          },
        ],
      },
      {
        title: t("provider.benchmarks"),
        icon: BarChart2,
        fields: [
          { label: t("provider.read"), value: formatDiskSpeed(telemetry.qd64_disk_read_speed) },
          { label: t("provider.write"), value: formatDiskSpeed(telemetry.qd64_disk_write_speed) },
        ],
      },
      {
        title: t("provider.hardware"),
        icon: Cpu,
        fields: [
          { label: t("provider.cpu"), value: shortenMiddle(telemetry.cpu_name, 14, 6), title: telemetry.cpu_name ?? "" },
          { label: t("provider.cores"), value: telemetry.cpu_number == null ? "" : String(telemetry.cpu_number) },
          {
            label: t("provider.virtual"),
            value: telemetry.cpu_is_virtual == null ? "" : telemetry.cpu_is_virtual ? t("yes") : t("no"),
          },
          {
            label: t("provider.ram"),
            value: telemetry.total_ram_bytes
              ? share(telemetry.usage_ram_bytes, telemetry.total_ram_bytes)
              : "",
          },
          {
            label: t("provider.disk"),
            value: telemetry.total_provider_space_bytes
              ? share(telemetry.used_provider_space_bytes, telemetry.total_provider_space_bytes)
              : "",
          },
        ],
      },
      {
        title: t("provider.network"),
        icon: Globe,
        fields: [
          {
            label: t("provider.down"),
            value: telemetry.speedtest_download
              ? `${formatNumber(telemetry.speedtest_download / 1e6, 0)} ${MBIT_PER_SECOND}`
              : "",
          },
          {
            label: t("provider.up"),
            value: telemetry.speedtest_upload
              ? `${formatNumber(telemetry.speedtest_upload / 1e6, 0)} ${MBIT_PER_SECOND}`
              : "",
          },
          {
            label: t("provider.ping"),
            value:
              telemetry.speedtest_ping && telemetry.speedtest_ping < 100000
                ? `${formatNumber(telemetry.speedtest_ping, 1)} ${MILLISECONDS}`
                : "",
          },
          { label: t("provider.country"), value: telemetry.country ?? "" },
          { label: t("provider.isp"), value: shortenMiddle(telemetry.isp, 14, 6), title: telemetry.isp ?? "" },
        ],
      },
    )
  }

  return (
    <div className={styles.body}>
      {unlisted && catalogReady && <Notice tone="yellow">{t("catalog.offCatalogFull")}</Notice>}
      <div data-tone={status.tone} className={styles.status}>
        {total > 0 && (
          <div className={styles.bar}>
            {stats.map((stat) => (
              <span
                key={stat.reason}
                data-tone={stat.reason === 0 ? "green" : toneOf(stat.reason)}
                style={{ flexGrow: stat.cnt }}
                title={`${describe(stat.reason)} • ${stat.cnt}`}
                className={styles.barPart}
              />
            ))}
          </div>
        )}

        <div className={styles.statusBody}>
          <div className={styles.statusMain}>
            <div className={styles.statusHead}>
              <span className={shared.dotStrong} aria-hidden="true" />
              <span className={styles.statusLabel}>{t(`status.${status.key}`)}</span>
              {total > 0 && <span className={styles.statusRatio}>{formatPercent((valid / total) * 100)}</span>}
            </div>
            <p className={styles.statusDescription}>
              {dominant === null ? t("provider.notChecked") : describe(dominant)}
            </p>
          </div>

          {total > 0 && (
            <div className={styles.checks}>
              <div className={styles.checksRow}>
                <span className={styles.checksLabel}>{t("provider.filesAvailable")}</span>
                <Ratio valid={valid} total={total} />
              </div>
              <button
                type="button"
                onClick={() => setLegendOpen(!legendOpen)}
                className={cx(shared.textAction, styles.legendToggle)}
              >
                {legendOpen ? t("provider.hideDetails") : t("provider.showDetails")}
              </button>
            </div>
          )}
        </div>

        {legendOpen && (
          <div className={styles.legend}>
            {stats.map((stat) => (
              <div key={stat.reason} data-tone={stat.reason === 0 ? "green" : toneOf(stat.reason)} className={styles.legendRow}>
                <span className={shared.dotStrong} aria-hidden="true" />
                <span className={styles.legendLabel}>{describe(stat.reason)}</span>
                <span className={shared.spacer} />
                <span className={styles.legendMeta}>
                  {stat.cnt} • {formatPercent((stat.cnt / total) * 100)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.columns}>
        {sections.map((section) => (
          <SheetSection key={section.title} icon={section.icon} title={section.title}>
            {section.fields.map((field) => (
              <SheetField key={field.label} {...field} copied={copied} onCopy={onCopy} />
            ))}
          </SheetSection>
        ))}
      </div>
    </div>
  )
}
