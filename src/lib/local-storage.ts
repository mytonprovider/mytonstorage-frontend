export const THEME_KEY = "mts_theme"
export const LANGUAGE_KEY = "mts_lang"
export const PENDING_KEY = "mts_contracts_pending"
export const CONTRACTS_KEY = "mts_contracts_owned"
export const STATES_KEY = "mts_contracts_states"
export const LIST_KEY = "mts_contracts_list"

export const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export const writeStored = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export const removeStored = (key: string): void => {
  try {
    localStorage.removeItem(key)
  } catch {
    return
  }
}

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
    const parsed = JSON.parse(readStored(LIST_KEY) ?? "{}") as Partial<ListState>
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
  writeStored(LIST_KEY, JSON.stringify({ ...readListView(), ...patch }))
}

const SCHEMA_KEY = "mts_schema"
const SCHEMA = "2"
const LEGACY_PENDING_KEY = "mts_pending_paid"
const LEGACY_HIDE_CLOSED_KEY = "mts_hide_closed"

export const migrateStored = (): void => {
  if (readStored(SCHEMA_KEY) === SCHEMA) return

  const pending = readStored(PENDING_KEY) ?? readStored(LEGACY_PENDING_KEY)
  const hideClosed = readStored(LEGACY_HIDE_CLOSED_KEY) === "1" || readListView().hideClosed

  wipeStored([THEME_KEY, LANGUAGE_KEY])

  if (pending !== null) writeStored(PENDING_KEY, pending)
  if (hideClosed) writeListView({ hideClosed: true })
  writeStored(SCHEMA_KEY, SCHEMA)
}
