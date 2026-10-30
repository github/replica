import type { AuthenticationProviderAdapter, PublicIdentityAttributes } from "../types.ts"
import type { SelectedProviderRevision } from "../start-authentication-proof/types.ts"

export interface ConsumedAuthorizationAttempt {
  codeVerifierCiphertext: string
  providerRevisionId: string
}

export interface CompleteAuthenticationProofDependencies {
  adapter: AuthenticationProviderAdapter
  callbackUri: string
  consumeAttempt(input: {
    browserBindingDigest: string
    consumedAt: Date
    stateDigest: string
  }): Promise<ConsumedAuthorizationAttempt | null>
  createHandoff(input: {
    browserBindingDigest: string
    displayAttributes: PublicIdentityAttributes
    expiresAt: Date
    externalIdentityId: string
    providerRevisionId: string
    tokenDigest: string
  }): Promise<void>
  createOpaqueValue(): string
  decryptCodeVerifier(value: string): string
  getSelectedProviderRevision(): Promise<SelectedProviderRevision | null>
  now(): Date
  resolveOrCreateIdentity(input: {
    issuer: string
    provider: string
    subject: string
  }): Promise<{ externalIdentityId: string; userId: string }>
  writeDenialAudit(
    reason: "configuration_changed" | "invalid_or_expired" | "provider_failed",
  ): Promise<unknown>
}

export interface CompleteAuthenticationProofInput {
  browserBinding: string
  code: string
  state: string
}

export interface CompleteAuthenticationProofResult {
  attributes: PublicIdentityAttributes
  expiresAt: Date
  handoffToken: string
  status: "authentication_proved"
}
