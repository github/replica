import type { KeyObject } from "node:crypto"

import { createGitHubAppJwtSigner } from "../create-github-app-jwt-signer/index.ts"

/** Signs a short-lived GitHub App JWT. Issued a minute early to absorb clock drift. */
export function createGitHubAppJwt(
  input: { appId: string; privateKey: KeyObject },
  now: Date,
): Promise<string> {
  const issuedAt = new Date(now.getTime() - 60_000)
  return createGitHubAppJwtSigner(input.privateKey).sign({
    appId: input.appId,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 540_000),
  })
}
