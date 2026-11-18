import { encryptAuthenticationValue } from "../../authentication/encrypt-authentication-value/index.ts"

export function createPreviewGrant(
  input: {
    buildId: string
    target: "preview" | "desktop" | "narrow"
    expiresAt: Date
    sessionDigest: string
  },
  key: Buffer,
): string {
  return encryptAuthenticationValue(
    JSON.stringify({
      v: 1,
      b: input.buildId,
      t: input.target,
      e: input.expiresAt.getTime(),
      s: input.sessionDigest,
    }),
    key,
  )
}
