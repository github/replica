import { routeIdentifierSchema } from "@application/hub/contracts"

import { MockStoreError } from "../store-error"

export function parseMockIdentifier(
  value: unknown,
  message = "Invalid record identifier.",
): number {
  const parsed = routeIdentifierSchema.safeParse(value)
  if (!parsed.success) throw new MockStoreError(400, message)
  return parsed.data
}
