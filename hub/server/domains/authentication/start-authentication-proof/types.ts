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
    providerRevisionId: string
    stateDigest: string
  }): Promise<{ expiresAt: Date }>
  createId(): string
  createOpaqueValue(): string
  deleteExpiredArtifacts(): Promise<void>
  encryptCodeVerifier(value: string): string
  getSelectedProviderRevision(): Promise<SelectedProviderRevision | null>
  writeDenialAudit(reason: "configuration_changed"): Promise<unknown>
}

export type StartAuthenticationProofInput = Record<string, never>

export interface StartAuthenticationProofResult {
  authorizationUrl: string
  browserBinding: string
  expiresAt: Date
}
