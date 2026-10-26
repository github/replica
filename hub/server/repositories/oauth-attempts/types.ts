export interface OAuthAttempt {
  id: string
  stateDigest: string
  browserDigest: string
  verifier: string
  generation: number
  credentialRevision: string
  purpose: "sign-in" | "verify" | "enroll"
  sessionId: string | null
  expiresAt: Date
}
