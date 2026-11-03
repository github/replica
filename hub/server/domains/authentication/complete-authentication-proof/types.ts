import type { AuthenticationProofResult, AuthenticationProviderAdapter } from "../types.ts"
import type { SelectedProviderRevision } from "../start-authentication-proof/types.ts"

export interface ConsumedAuthorizationAttempt {
  id: string
  codeVerifierCiphertext: string
  providerRevisionId: string
}

export interface CompleteAuthenticationProofDependencies {
  adapter: AuthenticationProviderAdapter
  callbackUri: string
  consumeAttempt(input: {
    browserBindingDigest: string
    stateDigest: string
  }): Promise<ConsumedAuthorizationAttempt | null>
  decryptCodeVerifier(value: string): string
  localConfigurationDigest: string
  localRevision: number
  getSelectedProviderRevision(): Promise<SelectedProviderRevision | null>
  resolveOrCreateIdentity(input: {
    issuer: string
    provider: string
    subject: string
  }): Promise<{ externalIdentityId: string; userId: string }>
  writeDenialAudit(
    reason:
      | "configuration_changed"
      | "invalid_or_expired"
      | "provider_failed"
      | "verification_state_invalid",
  ): Promise<unknown>
}

export interface CompleteAuthenticationProofInput {
  browserBinding: string
  code: string
  state: string
}

export interface CompleteAuthenticationProofResult {
  proof: AuthenticationProofResult
}
