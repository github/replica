import { z } from "zod"

const environmentSchema = z.looseObject({
  HUB_APPLICATION_ORIGIN: z.url().max(500),
  HUB_AUTHENTICATION_ENCRYPTION_KEY: z.string().min(1),
  HUB_BOOTSTRAP_SECRET: z.string().min(32).max(2_000),
})

export function createSharedAuthenticationContext(environment: NodeJS.ProcessEnv) {
  const parsed = environmentSchema.parse(environment)
  const origin = new URL(parsed.HUB_APPLICATION_ORIGIN)
  if (
    origin.origin !== parsed.HUB_APPLICATION_ORIGIN ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "http:" && origin.protocol !== "https:")
  ) {
    throw new Error("HUB_APPLICATION_ORIGIN must be an exact HTTP origin without a trailing slash.")
  }
  const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"])
  if (origin.protocol !== "https:" && !loopbackHosts.has(origin.hostname)) {
    throw new Error("HUB_APPLICATION_ORIGIN must use HTTPS outside loopback development.")
  }
  const encryptionKey = Buffer.from(parsed.HUB_AUTHENTICATION_ENCRYPTION_KEY, "base64")
  if (encryptionKey.length !== 32) {
    throw new Error("HUB_AUTHENTICATION_ENCRYPTION_KEY must decode to exactly 32 bytes.")
  }
  return {
    applicationOrigin: origin.origin,
    bootstrapSecret: parsed.HUB_BOOTSTRAP_SECRET,
    encryptionKey,
    secureCookie: origin.protocol === "https:",
  }
}
