import { readLocal, writeLocal } from "@myton/ui"

export const THEME_KEY = "mts_theme"
export const LANGUAGE_KEY = "mts_lang"
export const PENDING_KEY = "mts_contracts_pending"
export const CONTRACTS_KEY = "mts_contracts_owned"
export const STATES_KEY = "mts_contracts_states"
export const LIST_KEY = "mts_contracts_list"

export const wipeStored = (keep: string[]): void => {
  try {
    const known = Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at))
    known.forEach((key) => {
      if (key !== null && key.startsWith("mts_") && !keep.includes(key)) localStorage.removeItem(key)
    })
  } catch {
    return
  }
}

interface ListState {
  shown: number
  hideClosed: boolean
  sort: string
  dir: string
}

export const readListView = (): ListState => {
  try {
    const parsed = JSON.parse(readLocal(LIST_KEY) ?? "{}") as Partial<ListState>
    return {
      shown: Number(parsed.shown) || 0,
      hideClosed: parsed.hideClosed === true,
      sort: typeof parsed.sort === "string" ? parsed.sort : "",
      dir: typeof parsed.dir === "string" ? parsed.dir : "",
    }
  } catch {
    return { shown: 0, hideClosed: false, sort: "", dir: "" }
  }
}

export const writeListView = (patch: Partial<ListState>): void => {
  writeLocal(LIST_KEY, JSON.stringify({ ...readListView(), ...patch }))
}

const SCHEMA_KEY = "mts_schema"
const SCHEMA = "2"
const LEGACY_PENDING_KEY = "mts_pending_paid"
const LEGACY_HIDE_CLOSED_KEY = "mts_hide_closed"

export const migrateStored = (): void => {
  if (readLocal(SCHEMA_KEY) === SCHEMA) return

  const pending = readLocal(PENDING_KEY) ?? readLocal(LEGACY_PENDING_KEY)
  const hideClosed = readLocal(LEGACY_HIDE_CLOSED_KEY) === "1" || readListView().hideClosed

  wipeStored([THEME_KEY, LANGUAGE_KEY])

  if (pending !== null) writeLocal(PENDING_KEY, pending)
  if (hideClosed) writeListView({ hideClosed: true })
  writeLocal(SCHEMA_KEY, SCHEMA)
}
