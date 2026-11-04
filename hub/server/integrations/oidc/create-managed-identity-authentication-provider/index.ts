import { ManagedIdentityCredential } from "@azure/identity"
import { z } from "zod"

import type { OidcClientAuthenticationProvider } from "../types.ts"

const inputSchema = z
  .object({
    clientId: z.uuid(),
  })
  .strict()
const assertionScope = "api://AzureADTokenExchange/.default"
const assertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"

export function createManagedIdentityAuthenticationProvider(
  input: z.input<typeof inputSchema>,
): OidcClientAuthenticationProvider {
  const parsed = inputSchema.parse(input)
  const credential = new ManagedIdentityCredential({ clientId: parsed.clientId })
  return {
    canonicalPublicConfiguration: {
      managedIdentityClientId: parsed.clientId,
      mode: "managed_identity_client_assertion",
    },
    async createTokenRequestFields() {
      const assertion = await credential.getToken(assertionScope)
      if (!assertion?.token) {
        throw new Error("The managed identity did not return an OIDC client assertion.")
      }
      return {
        client_assertion: assertion.token,
        client_assertion_type: assertionType,
      }
    },
  }
}
