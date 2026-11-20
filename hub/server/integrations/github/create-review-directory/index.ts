import type { KeyObject } from "node:crypto"
import { addAbortListener } from "node:events"
import { z } from "zod"

import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"
import { GitHubProviderRequestError } from "../errors.ts"
import type { GitHubReviewDirectory } from "./types.ts"

const profileSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  login: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  avatar_url: z
    .url({ protocol: /^https$/ })
    .nullable()
    .optional(),
})
const permissionSchema = z.object({
  permission: z.enum(["none", "pull", "read", "triage", "push", "write", "maintain", "admin"]),
  user: z.object({ id: profileSchema.shape.id }).nullable(),
})
const tokenSchema = z.object({
  token: z.string().min(1).max(2000),
  expires_at: z.iso.datetime({ offset: true }),
})
const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().max(255),
})

export function createReviewDirectory(
  credentials: { appId: string; installationId: string; privateKey: KeyObject },
  request = globalThis.fetch,
): GitHubReviewDirectory {
  const tokens = new Map<number, { value: string; expiresAt: number }>()
  const minting = new Map<number, Promise<string>>()
  const reading = new Map<string, Promise<boolean>>()

  async function send<S extends z.ZodType>(
    path: string,
    schema: S,
    bearer: string,
    signal: AbortSignal,
    body?: { repository_ids: number[] },
  ): Promise<z.output<S> | null> {
    try {
      const response = await request(new URL(path, "https://api.github.com"), {
        method: body ? "POST" : "GET",
        body: body ? JSON.stringify(body) : undefined,
        signal,
        redirect: "error",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${bearer}`,
          "User-Agent": "Replica-Hub",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      })
      if (response.status === 404) return null
      if (!response.ok) throw new GitHubProviderRequestError()
      return schema.parse(await response.json())
    } catch (error) {
      throw new GitHubProviderRequestError({ cause: error })
    }
  }
  async function installationToken(repositoryId: number) {
    const token = tokens.get(repositoryId)
    if (token && token.expiresAt - 60_000 > Date.now()) return token.value
    const pending = minting.get(repositoryId)
    if (pending) return pending
    const request = (async () => {
      const result = await send(
        `/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
        tokenSchema,
        await createGitHubAppJwt(credentials, new Date()),
        AbortSignal.timeout(5000),
        { repository_ids: [repositoryId] },
      )
      if (!result) throw new GitHubProviderRequestError()
      tokens.delete(repositoryId)
      tokens.set(repositoryId, { value: result.token, expiresAt: Date.parse(result.expires_at) })
      if (tokens.size > 64) {
        const oldest = tokens.keys().next()
        if (!oldest.done) tokens.delete(oldest.value)
      }
      return result.token
    })().finally(() => {
      minting.delete(repositoryId)
    })
    minting.set(repositoryId, request)
    return request
  }
  function repositoryPath(repository: string) {
    const parts = repository.split("/")
    if (
      parts.length !== 2 ||
      parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || /^\.\.?$/.test(part))
    ) {
      throw new GitHubProviderRequestError()
    }
    return `/repos/${parts.map(encodeURIComponent).join("/")}`
  }
  function present(profile: z.output<typeof profileSchema>) {
    return { githubId: profile.id, login: profile.login, avatarUrl: profile.avatar_url ?? null }
  }
  async function scope(repositoryId: bigint, signal: AbortSignal) {
    const id = Number(repositoryId)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    const bearer = await installationToken(id)
    const record = await send(`/repositories/${id}`, repositorySchema, bearer, signal)
    // The restricted token still addresses the original repository if its name changes mid-request.
    return record?.id === id ? { bearer, path: repositoryPath(record.full_name) } : null
  }
  async function verifyRead(repositoryId: bigint, login: string, githubId: number) {
    const signal = AbortSignal.timeout(6000)
    const repository = await scope(repositoryId, signal)
    if (!repository) return false
    const { bearer, path } = repository
    function readPermission(name: string) {
      return send(
        `${path}/collaborators/${encodeURIComponent(name)}/permission`,
        permissionSchema,
        bearer,
        signal,
      )
    }
    const permission = profileSchema.shape.login.safeParse(login).success
      ? await readPermission(login)
      : null
    if (permission?.user?.id === githubId) return permission.permission !== "none"

    // The session login can outlive a rename. Never accept a permission for a different ID.
    const profile = await send(`/user/${githubId}`, profileSchema, bearer, signal)
    if (profile?.id !== githubId || profile.login.toLowerCase() === login.toLowerCase()) {
      return false
    }
    const current = await readPermission(profile.login)
    return current?.user?.id === githubId && current.permission !== "none"
  }

  return {
    async canRead(repositoryId, login, githubId, cancellation) {
      cancellation?.throwIfAborted()
      if (!Number.isSafeInteger(githubId) || githubId <= 0) return false
      const key = `${repositoryId}:${githubId}`
      let pending = reading.get(key)
      if (!pending) {
        pending = verifyRead(repositoryId, login, githubId).finally(() => reading.delete(key))
        reading.set(key, pending)
      }
      if (!cancellation) return pending
      // Share the in-progress check, not a completed permission or any caller's timeout.
      return new Promise<boolean>((resolve, reject) => {
        const abort = addAbortListener(cancellation, () => {
          reject(new Error("Review permission check was canceled.", { cause: cancellation.reason }))
        })
        void pending.then(resolve, reject).finally(() => abort[Symbol.dispose]())
      })
    },
    async find(repositoryId, login, githubId, cancellation) {
      cancellation?.throwIfAborted()
      const timeout = AbortSignal.timeout(6000)
      const signal = cancellation ? AbortSignal.any([timeout, cancellation]) : timeout
      const repository = await scope(repositoryId, signal)
      if (!repository) return null
      const { bearer, path } = repository
      const profile = await send(
        githubId ? `/user/${githubId}` : `/users/${encodeURIComponent(login)}`,
        profileSchema,
        bearer,
        signal,
      )
      if (!profile || (githubId && profile.id !== githubId)) return null
      const permission = await send(
        `${path}/collaborators/${encodeURIComponent(profile.login)}/permission`,
        permissionSchema,
        bearer,
        signal,
      )
      return permission?.user?.id === profile.id && permission.permission !== "none"
        ? present(profile)
        : null
    },
    async search(repositoryId, query) {
      const signal = AbortSignal.timeout(6000)
      const repository = await scope(repositoryId, signal)
      if (!repository) throw new GitHubProviderRequestError()
      const { bearer, path } = repository
      const candidates = new Map<number, ReturnType<typeof present>>()
      const collaborators = `${path}/collaborators?affiliation=all&per_page=100`
      for (let page = 1; page <= 20; page += 1) {
        const rows = await send(
          `${collaborators}&page=${page}`,
          z.array(profileSchema),
          bearer,
          signal,
        )
        if (!rows) throw new GitHubProviderRequestError()
        for (const profile of rows) {
          if (profile.login.toLowerCase().includes(query))
            candidates.set(profile.id, present(profile))
          if (candidates.size === 20) return [...candidates.values()]
        }
        if (rows.length < 100) return [...candidates.values()]
      }
      return [...candidates.values()]
    },
  }
}
