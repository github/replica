/**
 * Matches typed text literally. Prisma passes `contains` to `ILIKE` without
 * escaping, so `%` or `_` in a search would otherwise act as wildcards.
 */
export function containsText(value: string) {
  return { contains: value.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const }
}
