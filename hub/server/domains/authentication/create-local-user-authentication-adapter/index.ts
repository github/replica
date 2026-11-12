import type { AuthenticationProviderAdapter } from "../types.ts"
import { localDeveloperIdentity } from "./constants.ts"

/**
 * Signs in one fixed local developer without contacting an outside provider. Sending the
 * browser straight back to Hub's own callback keeps the normal attempt, admission,
 * session, and audit checks in place, so local testing exercises the real sign-in path.
 */
export function createLocalUserAuthenticationAdapter(input: { callbackUri: string }) {
  return {
    providerKey: localDeveloperIdentity.provider,
    canonicalPublicConfiguration: JSON.stringify({ callbackUri: input.callbackUri }),
    createAuthorizationUrl({ callbackUri, state }) {
      if (callbackUri !== input.callbackUri) {
        throw new Error("Local callback URI does not match the configured callback URI.")
      }
      const url = new URL(callbackUri)
      url.search = new URLSearchParams({ code: "local", state }).toString()
      return url
    },
    completeAuthenticationProof() {
      return Promise.resolve({
        identity: { ...localDeveloperIdentity },
        profile: { login: "local-developer", name: "Local developer" },
        // Provider-assigned administrator access lets the first local sign-in manage Hub
        // without the bootstrap enrollment step.
        providerAssignment: {
          assignmentSubject: localDeveloperIdentity.subject,
          issuedAt: new Date(),
          role: "ADMINISTRATOR" as const,
        },
      })
    },
  } satisfies AuthenticationProviderAdapter & { canonicalPublicConfiguration: string }
}
