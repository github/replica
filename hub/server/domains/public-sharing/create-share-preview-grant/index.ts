import { encryptAuthenticationValue } from "../../authentication/encrypt-authentication-value/index.ts"

export function createSharePreviewGrant(
  input: { buildId: string; shareLinkId: string; expiresAt: Date },
  key: Buffer,
) {
  return encryptAuthenticationValue(
    JSON.stringify({
      v: 1,
      b: input.buildId,
      s: input.shareLinkId,
      e: input.expiresAt.getTime(),
    }),
    key,
  )
}
