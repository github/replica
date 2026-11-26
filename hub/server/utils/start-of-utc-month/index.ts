/** The first moment of a date's calendar month in UTC, where monthly budgets reset. */
export function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}
