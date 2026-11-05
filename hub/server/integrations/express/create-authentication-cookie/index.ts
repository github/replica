import { z } from "zod"

const inputSchema = z
  .object({
    expiresAt: z.date(),
    name: z.string().regex(/^[A-Za-z0-9_-]+$/),
    secure: z.boolean(),
    value: z.string().min(1).max(500),
  })
  .strict()

export function createAuthenticationCookie(rawInput: z.input<typeof inputSchema>): string {
  const input = inputSchema.parse(rawInput)
  return [
    `${input.name}=${encodeURIComponent(input.value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    input.secure ? "Secure" : null,
    `Expires=${input.expiresAt.toUTCString()}`,
  ]
    .filter(Boolean)
    .join("; ")
}
