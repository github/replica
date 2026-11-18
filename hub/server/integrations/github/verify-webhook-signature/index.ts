import { createHmac, timingSafeEqual } from "node:crypto"

/** Checks GitHub's `X-Hub-Signature-256` header against the raw request body. */
export function verifyWebhookSignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`)
  const received = Buffer.from(header)
  return received.length === expected.length && timingSafeEqual(received, expected)
}
