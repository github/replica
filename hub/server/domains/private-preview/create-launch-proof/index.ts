import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { z } from "zod"

import { normalizeStartPage } from "../../../utils/normalize-start-page/index.ts"
import type { PrivatePreviewAddress } from "../../../utils/private-preview-address/index.ts"
import type { PrivatePreviewSettings } from "../read-settings/index.ts"
import {
  grantLifetime,
  maximumResumeTokenLength,
  previewDigestPattern,
  previewTokenPattern,
  resumeTokenPattern,
} from "../types.ts"

const intent = z.strictObject({
  id: z.uuid(),
  buildId: z.uuid(),
  repositoryId: z.string(),
  runId: z.string(),
  deadline: z.number().int(),
  session: z.string().regex(previewTokenPattern),
})
const continuation = z.strictObject({
  intent,
  challenge: z.string().regex(previewDigestPattern),
})
const resume = intent.omit({ session: true }).extend({
  challenge: z.string().regex(previewDigestPattern),
  page: z.string(),
})
const buildMarker = intent.pick({ buildId: true, repositoryId: true, runId: true, deadline: true })

/** Signs the browser handoff states that Hub and the reader pass through each other. */
export function createLaunchProof({
  hubOrigin,
  readerOrigin,
  readerSecret,
}: Pick<PrivatePreviewSettings, "hubOrigin" | "readerOrigin" | "readerSecret">) {
  function mac(purpose: string, value: string) {
    return createHmac("sha256", Buffer.from(readerSecret, "base64url"))
      .update(
        JSON.stringify(["private-preview-launch-v1", hubOrigin, readerOrigin, purpose, value]),
      )
      .digest("base64url")
  }

  function seal(purpose: string, data: object) {
    const value = Buffer.from(JSON.stringify(data)).toString("base64url")
    return `${value}.${mac(purpose, value)}`
  }

  function open<Output>(purpose: string, token: string, schema: z.ZodType<Output>) {
    const [value, signature, extra] = token.split(".")
    if (!value || !signature || extra !== undefined || !previewTokenPattern.test(signature))
      return null
    if (!timingSafeEqual(Buffer.from(mac(purpose, value)), Buffer.from(signature))) return null
    try {
      const parsed = schema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString()))
      return parsed.success ? parsed.data : null
    } catch (error) {
      if (error instanceof SyntaxError) return null
      throw error
    }
  }

  function matches(
    data: Pick<z.infer<typeof intent>, "repositoryId" | "runId">,
    address: PrivatePreviewAddress,
  ) {
    // Transit verifies the proof, not expiry. Only the database clock governs issuance.
    return data.repositoryId === address.repositoryId && data.runId === address.runId
  }

  function bindSession(id: string, digest: string) {
    return mac("session", `${id}:${digest}`)
  }

  function bindAccess(address: PrivatePreviewAddress, access: string) {
    return mac("access", `${address.repositoryId}/${address.runId}:${access}`)
  }

  return {
    start(address: PrivatePreviewAddress, buildId: string, sessionDigest: string, expiresAt: Date) {
      const id = randomUUID()
      return seal("intent", {
        id,
        buildId,
        repositoryId: address.repositoryId,
        runId: address.runId,
        deadline: expiresAt.getTime(),
        session: bindSession(id, sessionDigest),
      })
    },
    attest(
      value: string,
      address: PrivatePreviewAddress,
      challengeForIntent: (id: string) => string | null,
    ) {
      const data = open("intent", value, intent)
      if (!data || !matches(data, address)) return null
      const challenge = challengeForIntent(data.id)
      return challenge ? seal("continuation", { intent: data, challenge }) : null
    },
    read(value: string, address: PrivatePreviewAddress, sessionDigest?: string) {
      const data = open("continuation", value, continuation)
      if (!data || !matches(data.intent, address)) return null
      const { id, buildId, deadline, session } = data.intent
      if (
        sessionDigest !== undefined &&
        !timingSafeEqual(Buffer.from(bindSession(id, sessionDigest)), Buffer.from(session))
      )
        return null
      return { id, buildId, expiresAt: new Date(deadline), challenge: data.challenge }
    },
    startResume(address: PrivatePreviewAddress, buildId: string, challenge: string, page: string) {
      if (normalizeStartPage(page) !== page) return null
      const id = randomUUID()
      const token = seal("resume", {
        id,
        buildId,
        repositoryId: address.repositoryId,
        runId: address.runId,
        deadline: Date.now() + grantLifetime,
        challenge,
        page,
      })
      return token.length <= maximumResumeTokenLength ? { id, token } : null
    },
    readResume(value: string, address: PrivatePreviewAddress) {
      if (value.length > maximumResumeTokenLength || !resumeTokenPattern.test(value)) return null
      const data = open("resume", value, resume)
      if (!data || !matches(data, address) || normalizeStartPage(data.page) !== data.page)
        return null
      return {
        id: data.id,
        buildId: data.buildId,
        expiresAt: new Date(data.deadline),
        challenge: data.challenge,
        page: data.page,
      }
    },
    /** Signs a reader session for one mount so another cookie for that path cannot shadow it. */
    sealAccess(address: PrivatePreviewAddress, access: string) {
      return `${access}.${bindAccess(address, access)}`
    },
    openAccess(value: string, address: PrivatePreviewAddress) {
      const [access, signature, extra] = value.split(".")
      if (
        !access ||
        !signature ||
        extra !== undefined ||
        !previewTokenPattern.test(access) ||
        !previewTokenPattern.test(signature) ||
        !timingSafeEqual(Buffer.from(bindAccess(address, access)), Buffer.from(signature))
      )
        return null
      return access
    },
    identifyBuild(address: PrivatePreviewAddress, buildId: string, deadline: number) {
      return seal("build-marker", {
        repositoryId: address.repositoryId,
        runId: address.runId,
        buildId,
        deadline,
      })
    },
    readBuild(value: string, address: PrivatePreviewAddress) {
      if (value.length > 512 || !resumeTokenPattern.test(value)) return null
      const marker = open("build-marker", value, buildMarker)
      return marker && matches(marker, address) && marker.deadline > Date.now()
        ? { buildId: marker.buildId, deadline: marker.deadline }
        : null
    },
  }
}
