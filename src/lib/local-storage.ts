export const THEME_KEY = "mts_theme"
export const LANGUAGE_KEY = "mts_lang"
export const HIDE_CLOSED_KEY = "mts_hide_closed"
export const PENDING_PAID_KEY = "mts_pending_paid"
export const CONTRACTS_KEY_PREFIX = "mts_contracts_"
export const ECONOMICS_KEY = "mts_economics"

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
    for (let at = localStorage.length - 1; at >= 0; at--) {
      const key = localStorage.key(at)
      if (key?.startsWith("mts_") && !keep.includes(key)) localStorage.removeItem(key)
    }
  } catch {
    return
  }
}
