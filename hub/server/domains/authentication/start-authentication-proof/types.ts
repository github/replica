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
    codeVerifierCiphertext: string
    id: string
    lifetimeSeconds: number
    nonceCiphertext: string
    providerRevisionId: string
    requiresFreshAuthentication: boolean
    stateDigest: string
  }): Promise<{ expiresAt: Date }>
  createId(): string
  createOpaqueValue(): string
  deleteExpiredArtifacts(): Promise<void>
  encryptCodeVerifier(value: string): string
  encryptNonce(value: string): string
  getSelectedProviderRevision(): Promise<SelectedProviderRevision | null>
  requiresFreshAuthentication: boolean
  writeDenialAudit(reason: "configuration_changed"): Promise<unknown>
}

export type StartAuthenticationProofInput = Record<string, never>

export interface StartAuthenticationProofResult {
  authorizationUrl: string
  browserBinding: string
  expiresAt: Date
}
