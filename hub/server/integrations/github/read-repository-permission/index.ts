import { z } from "zod"

import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"
import { GitHubProviderRequestError } from "../errors.ts"
import type { RepositoryPermission, RepositoryPermissionInput } from "./types.ts"

const tokenSchema = z.object({
  token: z.string().min(1).max(2_000),
  expires_at: z.iso.datetime().optional(),
})
type TokenEntry = {
  expiresAt: number
  pending: Promise<z.infer<typeof tokenSchema> | null>
}
const tokenCaches = new WeakMap<
  RepositoryPermissionInput["credentials"],
  WeakMap<typeof fetch, Map<number, TokenEntry>>
>()
const maximumCachedTokens = 128
const maximumTokenReuseMs = 120_000
const expiryMarginMs = 30_000
const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z
    .string()
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/)
    .max(255),
})
const permissionSchema = z.object({
  permission: z.enum(["none", "read", "triage", "write", "maintain", "admin"]),
  user: z.object({ id: z.number().int().positive() }),
})
const branchSchema = z.object({ name: z.string() })

/** Returns null when GitHub cannot identify both the exact repository and user. */
export async function readRepositoryPermission(
  input: RepositoryPermissionInput,
  request: typeof fetch = fetch,
): Promise<RepositoryPermission | null> {
  const { branchName, credentials, githubRepositoryId, login, subject } = input
  const numericId = Number(githubRepositoryId)
  if (
    !Number.isSafeInteger(numericId) ||
    numericId <= 0 ||
    !/^[1-9]\d{0,15}$/.test(subject) ||
    !/^[A-Za-z0-9_-]{1,39}$/.test(login)
  ) {
    return null
  }
  let requestCaches = tokenCaches.get(credentials)
  if (!requestCaches) {
    requestCaches = new WeakMap()
    tokenCaches.set(credentials, requestCaches)
  }
  let cache = requestCaches.get(request)
  if (!cache) {
    cache = new Map()
    requestCaches.set(request, cache)
  }
  async function send<Schema extends z.ZodType>(
    path: string,
    token: string,
    schema: Schema,
    body?: { repository_ids: number[] },
  ): Promise<z.infer<Schema> | null> {
    let response: Response
    try {
      response = await request(new URL(path, "https://api.github.com"), {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "Replica-Hub",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        method: body ? "POST" : "GET",
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new GitHubProviderRequestError({ cause: error })
    }
    if (response.status === 404) return null
    if (response.status === 401 && !body) cache?.delete(numericId)
    if (!response.ok) throw new GitHubProviderRequestError()
    const parsed = schema.safeParse(await response.json().catch(() => undefined))
    if (!parsed.success) throw new GitHubProviderRequestError()
    return parsed.data
  }

  // Narrow the credential so a repository renamed during the lookup cannot authorize its replacement.
  let tokenEntry = cache.get(numericId)
  if (!tokenEntry || tokenEntry.expiresAt <= Date.now()) {
    cache.delete(numericId)
    if (cache.size >= maximumCachedTokens) cache.delete(cache.keys().next().value!)
    const expiresAt = Date.now() + maximumTokenReuseMs
    const pending = (async () =>
      send(
        `/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
        await createGitHubAppJwt(credentials, new Date()),
        tokenSchema,
        { repository_ids: [numericId] },
      ))()
    const entry = { expiresAt, pending }
    function discard() {
      if (cache?.get(numericId) === entry) cache.delete(numericId)
    }
    cache.set(numericId, entry)
    void pending.then((token) => {
      if (!token?.expires_at) {
        discard()
        return
      }
      entry.expiresAt = Math.min(expiresAt, Date.parse(token.expires_at) - expiryMarginMs)
      if (entry.expiresAt <= Date.now()) discard()
    }, discard)
    tokenEntry = entry
  }
  const token = await tokenEntry.pending
  if (!token) return null
  const repository = await send(`/repositories/${numericId}`, token.token, repositorySchema)
  if (!repository || repository.id !== numericId) return null
  const [owner, name] = repository.full_name.split("/")
  if (name === "." || name === "..") return null
  const result = await send(
    `/repos/${owner}/${name}/collaborators/${login}/permission`,
    token.token,
    permissionSchema,
  )
  if (!result || String(result.user.id) !== subject) return null
  if (
    branchName &&
    (result.permission === "write" ||
      result.permission === "maintain" ||
      result.permission === "admin")
  ) {
    const branch = await send(
      `/repos/${owner}/${name}/branches/${encodeURIComponent(branchName)}`,
      token.token,
      branchSchema,
    )
    if (branch?.name !== branchName) return null
  }
  return result.permission
}
