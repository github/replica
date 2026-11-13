import type {
  AuthenticationProofResult,
  AuthenticationProviderAdapter,
  ProviderAssignmentEvidence,
} from "../types.ts"
import type { SelectedProviderRevision } from "../start-authentication-proof/types.ts"

export interface ConsumedAuthorizationAttempt {
  id: string
  codeVerifierCiphertext: string
  createdAt: Date
  nonceCiphertext: string | null
  purpose: "SIGN_IN" | "ADMIN_ENROLLMENT" | "ADMINISTRATOR_MANAGEMENT"
  providerRevisionId: string
  sensitiveAuthorizationId?: string | null
  sessionRevocationRevision: number
}

export interface CompleteAuthenticationProofDependencies {
  adapter: AuthenticationProviderAdapter
  callbackUri: string
  consumeAttempt(input: {
    browserBindingDigest: string
    stateDigest: string
  }): Promise<ConsumedAuthorizationAttempt | null>
  decryptCodeVerifier(value: string): string
  decryptNonce(value: string): string
  localConfigurationDigest: string
  localRevision: number
  getAuthenticationProofState(): Promise<{
    selectedProviderRevision: SelectedProviderRevision | null
    sessionRevocationRevision: number
  } | null>
  resolveOrCreateIdentity(input: {
    authorizationAttemptId: string
    issuer: string
    provider: string
    providerRevisionId: string
    sessionRevocationRevision: number
    subject: string
  }): Promise<{ externalIdentityId: string; userId: string }>
  updateIdentityProfile(input: {
    id: string
    login: string
    name: string | null
    provider: string
  }): Promise<void>
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
  purpose: "SIGN_IN" | "ADMIN_ENROLLMENT" | "ADMINISTRATOR_MANAGEMENT"
  sensitiveAuthorizationId?: string
  providerAssignment?: ProviderAssignmentEvidence & { providerRevisionId: string }
  proof: AuthenticationProofResult
}
