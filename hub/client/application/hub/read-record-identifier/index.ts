import { recordIdentifierSchema } from "../contracts"

export function readRecordIdentifier(value: string | undefined, label: string): string {
  const parsed = recordIdentifierSchema.safeParse(value)
  if (!parsed.success) {
    throw new Response(`The ${label} identifier is not valid.`, { status: 400 })
  }
  return parsed.data
}
