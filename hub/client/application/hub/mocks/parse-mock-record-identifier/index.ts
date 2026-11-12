import { recordIdentifierSchema } from "@application/hub/contracts"

import { MockStoreError } from "../store-error"

export function parseMockRecordIdentifier(
  value: unknown,
  message = "Invalid record identifier.",
): string {
  const parsed = recordIdentifierSchema.safeParse(value)
  if (!parsed.success) throw new MockStoreError(400, message)
  return parsed.data
}
