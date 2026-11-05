import { createHash, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const configuredSecretSchema = z.string().min(32).max(2_000)
const submittedSecretSchema = z.string().min(1).max(2_000)

export function verifyBootstrapSecret(configuredSecret: string, submittedSecret: string): boolean {
  const configured = configuredSecretSchema.parse(configuredSecret)
  const submitted = submittedSecretSchema.safeParse(submittedSecret)
  const configuredDigest = createHash("sha256").update(configured).digest()
  const submittedDigest = createHash("sha256")
    .update(submitted.success ? submitted.data : "")
    .digest()
  return submitted.success && timingSafeEqual(configuredDigest, submittedDigest)
}
