import { sign, type KeyObject } from "node:crypto"

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

/** Signs a short-lived GitHub App JWT. Issued a minute early to absorb clock drift. */
export function createGitHubAppJwt(
  input: { appId: string; privateKey: KeyObject },
  now: Date,
): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: issuedAt,
    exp: issuedAt + 540,
    iss: input.appId,
  })}`
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), input.privateKey).toString("base64url")}`
}
