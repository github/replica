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
    id: string
    lifetimeSeconds: number
    providerRevisionId: string
    requestIpDigest: string
    stateDigest: string
  }): Promise<{ expiresAt: Date }>
  createId(): string
  createOpaqueValue(): string
  deleteExpiredArtifacts(): Promise<void>
  encryptCodeVerifier(value: string): string
  getSelectedProviderRevision(): Promise<SelectedProviderRevision | null>
  writeDenialAudit(reason: "configuration_changed" | "rate_limited"): Promise<unknown>
}

export interface StartAuthenticationProofInput {
  requestIpDigest: string
}

export interface StartAuthenticationProofResult {
  authorizationUrl: string
  browserBinding: string
  expiresAt: Date
}
