import { recordIdentifierSchema } from "../contracts"

/**
 * Reads a repository or prototype ID from the URL. A malformed ID becomes a 400 response
 * before any API request is made.
 */
export function readRecordIdentifier(value: string | undefined, label: string): string {
  const parsed = recordIdentifierSchema.safeParse(value)
  if (!parsed.success) {
    throw new Response(`The ${label} identifier is not valid.`, { status: 400 })
  }
  return parsed.data
}
