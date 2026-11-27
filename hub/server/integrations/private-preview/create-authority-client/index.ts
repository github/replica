import { z } from "zod"

import { previewSessionEndedHeader } from "../../../domains/private-preview/types.ts"

const exchangeReply = z.strictObject({
  access: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  startPage: z.string().max(2048),
  buildId: z.uuid(),
})
const fileReply = z.strictObject({
  storageKey: z.string().max(128),
  byteLength: z.number().int().nonnegative(),
  path: z.string().max(2048),
})

export function createAuthorityClient(hubOrigin: string, readerSecret: string) {
  async function request<Result, Missing>(
    endpoint: string,
    body: object,
    schema: z.ZodType<Result>,
    notFound: (response: Response) => Missing,
  ) {
    const response = await fetch(new URL(endpoint, hubOrigin), {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
      headers: { authorization: `Bearer ${readerSecret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (response.status === 404) {
      await response.body?.cancel()
      return notFound(response)
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel()
      throw new Error("Private preview authority is unavailable.")
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 8 * 1024) throw new Error("Private preview authority response is too large.")
        chunks.push(value)
      }
      return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    } finally {
      await reader.cancel()
    }
  }
  return {
    exchange(
      endpoint: string,
      input: { repositoryId: string; runId: string; grant: string; challengeDigest: string },
    ) {
      return request(endpoint, input, exchangeReply, () => null)
    },
    authorizeFile(
      endpoint: string,
      input: {
        repositoryId: string
        runId: string
        access: string
        path: string
        allowEntryPointFallback: boolean
      },
    ) {
      return request(endpoint, input, fileReply, (response) =>
        response.headers.get(previewSessionEndedHeader) === "1" ? ("session-ended" as const) : null,
      )
    },
  }
}
