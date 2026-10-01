import { useRef } from "react"
import { Search, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cx } from "@/lib/cx"
import { IconButton } from "./icon-button"
import shared from "./shared.module.css"

interface SearchFieldProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}

export const SearchField = ({ value, onChange, placeholder, className }: SearchFieldProps) => {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const label = placeholder ?? t("ui.search")

  return (
    <div className={cx(shared.searchField, className)}>
      <Search aria-hidden="true" className={shared.searchFieldIcon} />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        value={value}
        placeholder={label}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className={shared.searchFieldInput}
      />
      {value && (
        <IconButton
          size="sm"
          label={t("ui.clear")}
          onClick={() => {
            onChange("")
            inputRef.current?.focus()
          }}
          className={shared.searchFieldClear}
        >
          <X aria-hidden="true" className={shared.searchFieldClearIcon} />
        </IconButton>
      )}
    </div>
  )
}
