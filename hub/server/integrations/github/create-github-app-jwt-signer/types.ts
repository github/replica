export interface GitHubAppJwtSigner {
  sign(input: { appId: string; expiresAt: Date; issuedAt: Date }): Promise<string>
}
