export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
