export interface AuthorizationAttempt {
  id: string
  authenticationProviderRevisionId: string
  originatingSessionId: string | null
  stateDigest: string
  browserDigest: string
  pkceVerifier: string
  nonce: string | null
  purpose: "sign-in" | "verify" | "link-identity"
  sessionGeneration: number
  expiresAt: Date
}
