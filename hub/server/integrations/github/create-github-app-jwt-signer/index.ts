import { createPrivateKey, createSign } from "node:crypto"

import type { GitHubAppJwtSigner } from "./types.ts"

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url")
}

export function createGitHubAppJwtSigner(privateKey: string): GitHubAppJwtSigner {
  if (!privateKey.trim()) throw new Error("GitHub App private key is required.")
  const key = createPrivateKey(privateKey)
  return {
    sign({ appId, expiresAt, issuedAt }) {
      const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
      const payload = base64Url(
        JSON.stringify({
          exp: Math.floor(expiresAt.getTime() / 1000),
          iat: Math.floor(issuedAt.getTime() / 1000),
          iss: appId,
        }),
      )
      const unsigned = `${header}.${payload}`
      const signer = createSign("RSA-SHA256")
      signer.update(unsigned)
      signer.end()
      return Promise.resolve(`${unsigned}.${signer.sign(key).toString("base64url")}`)
    },
  }
}
