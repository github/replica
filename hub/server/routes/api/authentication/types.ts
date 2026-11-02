import type { Request } from "express"

import type { AuthenticationProofResult } from "../../../domains/authentication/types.ts"

export type AuthorizationPurpose = "SIGN_IN" | "ADMIN_ENROLLMENT"

export interface AuthenticationRouteRuntime {
  applicationOrigin: string
  secureCookie: boolean
  start(purpose: AuthorizationPurpose): Promise<{
    authorizationUrl: string
    browserBinding: string
    expiresAt: Date
  }>
  complete(input: {
    browserBinding: string
    code: string
    state: string
  }): Promise<{ proof: AuthenticationProofResult }>
  admit(input: {
    proof: AuthenticationProofResult
    sessionDigest: string
    sessionId: string
  }): Promise<{
    expiresAt: Date
    membershipId: string
    role: "administrator" | "member"
    sessionId: string
    userId: string
  }>
  restore(sessionDigest: string): Promise<{
    membershipId: string
    role: "administrator" | "member"
    sessionId: string
    userId: string
  } | null>
  end(sessionDigest: string): Promise<boolean>
  checkRateLimit(operation: "start" | "callback", subjectDigest: string): Promise<boolean>
  verifyBootstrapSecret(submittedSecret: string): boolean
  writeBootstrapDenial(reason: "invalid_secret" | "rate_limited"): Promise<unknown>
}

export interface AuthenticationRequest extends Request {
  authenticationRateLimitAllowed?: boolean
}
