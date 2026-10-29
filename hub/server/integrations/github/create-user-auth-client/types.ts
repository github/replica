export interface GitHubUserAuthConfiguration {
  clientId: string
  clientSecret: string
  callbackUrl: string
  issuer: "https://github.com"
}

export interface GitHubUserProfile {
  subject: string
  username: string
  displayName: string | null
  avatarUrl: string | null
}

export interface GitHubUserAuthClient {
  authorizationUrl(state: string, pkceVerifier: string): string
  identify(code: string, pkceVerifier: string): Promise<GitHubUserProfile>
}
