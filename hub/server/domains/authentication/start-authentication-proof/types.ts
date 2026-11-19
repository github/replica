import type { AuthenticationProviderAdapter } from "../types.ts"
import type { AuthorizationAttemptPurpose } from "../../../generated/prisma/enums.ts"

export interface SelectedProviderRevision {
  configurationDigest: string
  id: string
  revision: number
}

export interface StartAuthenticationProofDependencies {
  adapter: AuthenticationProviderAdapter
  callbackUri: string
  configurationDigest: string
  expectedRevision: number
  createAttempt(input: {
    browserBindingDigest: string
    codeVerifierCiphertext: string
    id: string
    lifetimeSeconds: number
    nonceCiphertext: string
    purpose: AuthorizationAttemptPurpose
    providerRevisionId: string
    sensitiveAuthorizationId?: string
    sessionRevocationRevision: number
    stateDigest: string
  }): Promise<{ expiresAt: Date }>
  createId(): string
  createOpaqueValue(): string
  deleteExpiredArtifacts(): Promise<void>
  encryptCodeVerifier(value: string): string
  encryptNonce(value: string): string
  getAuthenticationProofState(): Promise<{
    selectedProviderRevision: SelectedProviderRevision | null
    sessionRevocationRevision: number
  } | null>
  writeDenialAudit(reason: "configuration_changed"): Promise<unknown>
}

export interface StartAuthenticationProofInput {
  purpose: AuthorizationAttemptPurpose
  sensitiveAuthorizationId?: string
  switchAccount?: boolean
}

export interface StartAuthenticationProofResult {
  authorizationAttemptId: string
  authorizationUrl: string
  browserBinding: string
  expiresAt: Date
}
