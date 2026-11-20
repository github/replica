import { encryptAuthenticationValue } from "../../authentication/encrypt-authentication-value/index.ts"

export function createPreviewGrant(
  input: {
    buildId: string
    expiresAt: Date
    sessionDigest: string
  } & (
    { target: "preview" | "desktop" | "narrow" } | { target: "template"; screenshotPath?: string }
  ),
  key: Buffer,
): string {
  return encryptAuthenticationValue(
    JSON.stringify({
      v: 1,
      b: input.buildId,
      t: input.target,
      p: input.target === "template" ? input.screenshotPath : undefined,
      e: input.expiresAt.getTime(),
      s: input.sessionDigest,
    }),
    key,
  )
}
