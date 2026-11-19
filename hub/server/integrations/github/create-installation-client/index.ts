import { z } from "zod"

import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"
import { GitHubProviderRequestError } from "../errors.ts"
import type { GitHubInstallationCredentials, GitHubInstallationTransport } from "./types.ts"

const tokenSchema = z.looseObject({ token: z.string().min(1).max(2_000) })
const maxJsonBytes = 8 * 1024 * 1024
const downloadTimeoutMs = 120_000

export class GitHubInstallationHttpError extends GitHubProviderRequestError {
  readonly status: number
  readonly limited: boolean

  constructor(response: Response) {
    super()
    this.name = "GitHubInstallationHttpError"
    this.status = response.status
    this.limited =
      response.status === 429 ||
      response.headers.get("x-ratelimit-remaining") === "0" ||
      response.headers.has("retry-after")
  }
}

export class GitHubArtifactDownloadTooLarge extends Error {
  constructor() {
    super("The Replica artifact ZIP exceeds the download limit.")
    this.name = "GitHubArtifactDownloadTooLarge"
  }
}

export class InvalidGitHubInstallationEvidence extends GitHubProviderRequestError {
  constructor(options?: ErrorOptions) {
    super(options)
    this.name = "InvalidGitHubInstallationEvidence"
  }
}

function isArtifactRedirect(url: URL) {
  return (
    url.protocol === "https:" &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.hash &&
    (url.hostname.endsWith(".blob.core.windows.net") ||
      url.hostname.endsWith(".actions.githubusercontent.com"))
  )
}

async function boundBody(response: Response, maxBytes: number) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel()
    throw new GitHubArtifactDownloadTooLarge()
  }
  const reader = response.body?.getReader()
  if (!reader) throw new GitHubProviderRequestError()
  const blocks: Buffer[] = []
  let block: Buffer | undefined
  let offset = 0
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        return blocks.length === 1 && block
          ? block.subarray(0, offset)
          : Buffer.concat(blocks, length)
      }
      if (length + value.byteLength > maxBytes) throw new GitHubArtifactDownloadTooLarge()
      for (let cursor = 0; cursor < value.byteLength;) {
        if (!block || offset === block.length) {
          block = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - length))
          blocks.push(block)
          offset = 0
        }
        const copied = Math.min(value.byteLength - cursor, block.length - offset)
        block.set(value.subarray(cursor, cursor + copied), offset)
        offset += copied
        cursor += copied
        length += copied
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

export type GitHubInstallationClient = Awaited<ReturnType<typeof createGitHubInstallationClient>>

/** Mints only the configured installation's token. It is never forwarded to redirects. */
export async function createGitHubInstallationClient(
  credentials: GitHubInstallationCredentials,
  {
    apiUrl = "https://api.github.com",
    fetch: request = fetch,
    now = () => new Date(),
    timeoutMs = 10_000,
  }: GitHubInstallationTransport = {},
) {
  const origin = new URL(apiUrl).origin

  async function send(
    path: string,
    token: string,
    method: "GET" | "POST",
    signal: AbortSignal,
    redirect: "error" | "manual" = "error",
  ) {
    const url = new URL(path, origin)
    if (url.origin !== origin || url.username || url.password)
      throw new GitHubProviderRequestError()
    try {
      return await request(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "Replica-Hub",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        method,
        redirect,
        signal,
      })
    } catch (error) {
      throw new GitHubProviderRequestError({ cause: error })
    }
  }

  async function readJson<Schema extends z.ZodType>(
    response: Response,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new GitHubInstallationHttpError(response)
    }
    const bytes = await boundBody(response, maxJsonBytes).catch((error: unknown) => {
      if (error instanceof GitHubArtifactDownloadTooLarge)
        throw new InvalidGitHubInstallationEvidence()
      throw error
    })
    try {
      return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
    } catch (error) {
      throw new InvalidGitHubInstallationEvidence({ cause: error })
    }
  }

  const { token } = await readJson(
    await send(
      `/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
      await createGitHubAppJwt(credentials, now()),
      "POST",
      AbortSignal.timeout(timeoutMs),
    ),
    tokenSchema,
  )

  return {
    async get<Schema extends z.ZodType>(path: string, schema: Schema): Promise<z.infer<Schema>> {
      return readJson(await send(path, token, "GET", AbortSignal.timeout(timeoutMs)), schema)
    },
    async download(path: string, maxBytes: number): Promise<Buffer> {
      const signal = AbortSignal.timeout(downloadTimeoutMs)
      let response = await send(path, token, "GET", signal, "manual")
      if (response.status === 302) {
        const location = response.headers.get("location")
        await response.body?.cancel().catch(() => undefined)
        const url = location ? URL.parse(location) : null
        if (!url || !isArtifactRedirect(url)) throw new InvalidGitHubInstallationEvidence()
        try {
          response = await request(url, { method: "GET", redirect: "error", signal })
        } catch {
          // Do not keep errors that may contain the signed download URL.
          throw new GitHubProviderRequestError()
        }
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined)
        throw new GitHubInstallationHttpError(response)
      }
      return boundBody(response, maxBytes)
    },
  }
}
