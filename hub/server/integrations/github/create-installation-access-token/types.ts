import type { GitHubAppJwtSigner } from "../create-github-app-jwt-signer/types.ts"

export interface CreateInstallationAccessTokenInput {
  appId: string
  fetch?: typeof globalThis.fetch
  installationId: string
  now?: () => Date
  organization: string
  signer: GitHubAppJwtSigner
}
