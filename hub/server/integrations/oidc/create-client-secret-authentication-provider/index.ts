import { z } from "zod"

import type { OidcClientAuthenticationProvider } from "../types.ts"

const inputSchema = z
  .object({
    reference: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/),
    secret: z.string().min(1).max(4_096),
  })
  .strict()

export function createClientSecretAuthenticationProvider(
  input: z.input<typeof inputSchema>,
): OidcClientAuthenticationProvider {
  const parsed = inputSchema.parse(input)
  return {
    canonicalPublicConfiguration: {
      mode: "client_secret",
      reference: parsed.reference,
    },
    createTokenRequestFields: () => Promise.resolve({ client_secret: parsed.secret }),
  }
}
