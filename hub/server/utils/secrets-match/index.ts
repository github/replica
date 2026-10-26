import { timingSafeEqual } from "node:crypto"

import { digestSecret } from "#server/utils/digest-secret"

export function secretsMatch(actual: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(digestSecret(actual)), Buffer.from(digestSecret(expected)))
}
