import { encryptAuthenticationValue } from "../../authentication/encrypt-authentication-value/index.ts"

export function createPreviewSession(buildId: string, expiresAt: Date, key: Buffer): string {
  return encryptAuthenticationValue(
    JSON.stringify({ v: 1, b: buildId, e: expiresAt.getTime() }),
    key,
  )
}
