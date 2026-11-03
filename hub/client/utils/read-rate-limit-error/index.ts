import { z } from "zod"

const RATE_LIMIT_RESPONSE = z.object({
  code: z.literal("rate_limited"),
  errors: z.array(z.string().min(1).max(512)).min(1).max(1),
  retryAfter: z.number().int().min(1).max(600),
})

/** Reads Hub's localized retry guidance without retrying the rejected mutation. */
export async function readRateLimitError(response: Response): Promise<string | null> {
  if (response.status !== 429) return null

  const result = RATE_LIMIT_RESPONSE.safeParse(await response.json().catch(() => null))
  return result.success ? (result.data.errors[0] ?? null) : null
}
