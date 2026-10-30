import type {
  CompleteAuthenticationProofInput,
  CompleteAuthenticationProofResult,
} from "../../../../domains/authentication/complete-authentication-proof/types.ts"
import type {
  StartAuthenticationProofInput,
  StartAuthenticationProofResult,
} from "../../../../domains/authentication/start-authentication-proof/types.ts"
import type { BoundedRateLimiter } from "../../../../utils/authentication/create-bounded-rate-limiter/index.ts"

export interface GitHubAuthenticationRoutesDependencies {
  appOrigin: string
  callbackRateLimiter: BoundedRateLimiter
  complete(input: CompleteAuthenticationProofInput): Promise<CompleteAuthenticationProofResult>
  now(): Date
  secureCookies: boolean
  start(input: StartAuthenticationProofInput): Promise<StartAuthenticationProofResult>
}
