import type { IdentityStore, SessionContext } from "#server/domains/identity/create-store/types"
import type {
  GitHubUserAuthClient,
  GitHubUserAuthConfiguration,
  GitHubUserProfile,
} from "#server/integrations/github/create-user-auth-client/types"
import type { OidcClient, OidcConfiguration } from "#server/integrations/oidc/create-client/types"
import type { InstallationMembershipRecord } from "#server/repositories/installation-memberships/types"
import type { GitHubAdmissionBaseline } from "#server/domains/github-authorization/create-service/types"
import type { Prisma } from "../../../generated/prisma/client.ts"

export type AuthorizationPurpose = "sign-in" | "verify" | "bootstrap" | "recovery"

export interface AdmissionPolicy {
  name: "hub-managed" | "github-synchronized" | "legacy-repository"
  admit(profile: GitHubUserProfile): Promise<GitHubAdmissionBaseline | "legacy" | boolean | null>
  saveBaseline?(
    database: Prisma.TransactionClient,
    userId: string,
    baseline: GitHubAdmissionBaseline,
  ): Promise<void>
}

export interface AuthenticationSettings {
  origin: string
  secureCookies: boolean
  configured: boolean
  provider?: "github" | "oidc" | null
  providerLabel?: string | null
  admissionPolicy: AdmissionPolicy["name"]
  trustedProxyHops: number
}

export interface AuthenticationContext extends SessionContext {
  membership: InstallationMembershipRecord
}

export interface AuthenticationService {
  start(
    purpose: AuthorizationPurpose,
    sessionToken?: string,
    enrollmentSecret?: string,
  ): Promise<{ authorizationUrl: string; browserToken: string }>
  complete(
    code: string,
    state: string,
    browserToken: string,
  ): Promise<{ sessionToken?: string; purpose: AuthorizationPurpose }>
  current(sessionToken: string): Promise<AuthenticationContext>
  signOut(sessionToken: string): Promise<void>
  revokeAll(sessionToken: string): Promise<void>
}

export interface AuthenticationDependencies {
  store: IdentityStore
  github: GitHubUserAuthClient | null
  configuration: GitHubUserAuthConfiguration | null
  providerRevisionId: string | null
  oidc?: OidcClient | null
  oidcConfiguration?: OidcConfiguration | null
  oidcProviderRevisionId?: string | null
  provider?: "github" | "oidc"
  admissionPolicy: AdmissionPolicy
  bootstrapSecret?: string | null
  recoverySecret?: string | null
  now: () => Date
}
