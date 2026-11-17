import { z } from "zod"

const maximumDaysSchema = z.enum(["1", "7", "30"])

export function parseShareLinkMaximumDays(value: string | undefined): 1 | 7 | 30 {
  if (value === undefined) return 7
  const parsed = maximumDaysSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error("HUB_SHARE_LINK_MAX_DAYS must be 1, 7, or 30.")
  }
  return Number(parsed.data) as 1 | 7 | 30
}
