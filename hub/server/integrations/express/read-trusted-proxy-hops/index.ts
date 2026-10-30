import { z } from "zod"

const trustedProxyHopsSchema = z.coerce.number().int().min(0).max(10)

export function readTrustedProxyHops(value: string | undefined): number {
  if (value === undefined || value === "") return 0
  return trustedProxyHopsSchema.parse(value)
}
