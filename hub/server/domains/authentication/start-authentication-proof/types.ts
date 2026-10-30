import type { AuthenticationProviderAdapter } from "../types.ts"

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
    codeChallenge: string
    codeVerifierCiphertext: string
    expiresAt: Date
    id: string
    providerRevisionId: string
    requestIpDigest: string
    stateDigest: string
  }): Promise<unknown>
  createId(): string
  createOpaqueValue(): string
  deleteExpiredArtifacts(now: Date): Promise<void>
  encryptCodeVerifier(value: string): string
  getSelectedProviderRevision(): Promise<SelectedProviderRevision | null>
  now(): Date
  recentAttemptCount(input: { createdAfter: Date; requestIpDigest: string }): Promise<number>
  writeDenialAudit(reason: "configuration_changed" | "rate_limited"): Promise<unknown>
}

export interface StartAuthenticationProofInput {
  requestIp: string
}

export interface StartAuthenticationProofResult {
  authorizationUrl: string
  browserBinding: string
  expiresAt: Date
}
