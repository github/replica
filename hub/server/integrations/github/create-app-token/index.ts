import { sign } from "node:crypto"

import type { GitHubCredentials } from "#server/utils/identity-contracts/types"

export function createAppToken(credentials: GitHubCredentials): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: credentials.appId }),
  ).toString("base64url")
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), credentials.privateKey).toString("base64url")}`
}
