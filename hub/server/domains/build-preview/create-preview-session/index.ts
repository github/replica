import { encryptAuthenticationValue } from "../../authentication/encrypt-authentication-value/index.ts"

export function createPreviewSession(
  buildId: string,
  sessionDigest: string,
  expiresAt: Date,
  key: Buffer,
  template = false,
): string {
  return encryptAuthenticationValue(
    JSON.stringify({
      v: 1,
      b: buildId,
      s: sessionDigest,
      e: expiresAt.getTime(),
      t: template || undefined,
    }),
    key,
  )
}
