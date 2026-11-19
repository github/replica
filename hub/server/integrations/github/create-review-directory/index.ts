import type { KeyObject } from "node:crypto"
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

export function createReviewDirectory(
  credentials: { appId: string; installationId: string; privateKey: KeyObject },
  request = globalThis.fetch,
): GitHubReviewDirectory {
  let token: { value: string; expiresAt: number } | undefined
  let minting: Promise<string> | undefined

  async function send<S extends z.ZodType>(
    path: string,
    schema: S,
    bearer: string,
    signal: AbortSignal,
    method = "GET",
  ): Promise<z.output<S> | null> {
    try {
      const response = await request(new URL(path, "https://api.github.com"), {
        method,
        signal,
        redirect: "error",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${bearer}`,
          "User-Agent": "Replica-Hub",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      })
      if (response.status === 404) return null
      if (!response.ok) throw new GitHubProviderRequestError()
      return schema.parse(await response.json())
    } catch (error) {
      throw new GitHubProviderRequestError({ cause: error })
    }
  }
  async function installationToken() {
    if (token && token.expiresAt - 60_000 > Date.now()) return token.value
    minting ??= (async () => {
      const result = await send(
        `/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
        tokenSchema,
        await createGitHubAppJwt(credentials, new Date()),
        AbortSignal.timeout(5000),
        "POST",
      )
      if (!result) throw new GitHubProviderRequestError()
      token = { value: result.token, expiresAt: Date.parse(result.expires_at) }
      return token.value
    })().finally(() => {
      minting = undefined
    })
    return minting
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
  return {
    async find(repository, login, githubId, cancellation) {
      cancellation?.throwIfAborted()
      const bearer = await installationToken()
      const timeout = AbortSignal.timeout(6000)
      const signal = cancellation ? AbortSignal.any([timeout, cancellation]) : timeout
      signal.throwIfAborted()
      const profile = await send(
        githubId ? `/user/${githubId}` : `/users/${encodeURIComponent(login)}`,
        profileSchema,
        bearer,
        signal,
      )
      if (!profile || (githubId && profile.id !== githubId)) return null
      const permission = await send(
        `${repositoryPath(repository)}/collaborators/${encodeURIComponent(profile.login)}/permission`,
        permissionSchema,
        bearer,
        signal,
      )
      return permission?.user?.id === profile.id && permission.permission !== "none"
        ? present(profile)
        : null
    },
    async search(repository, query) {
      const bearer = await installationToken()
      const signal = AbortSignal.timeout(6000)
      const candidates = new Map<number, ReturnType<typeof present>>()
      const path = `${repositoryPath(repository)}/collaborators?affiliation=all&per_page=100`
      for (let page = 1; page <= 20; page += 1) {
        const rows = await send(`${path}&page=${page}`, z.array(profileSchema), bearer, signal)
        if (!rows) throw new GitHubProviderRequestError()
        for (const profile of rows) {
          if (profile.login.toLowerCase().includes(query))
            candidates.set(profile.id, present(profile))
          if (candidates.size === 20 && query) return [...candidates.values()]
        }
        if (rows.length < 100) return [...candidates.values()]
      }
      throw new GitHubProviderRequestError()
    },
  }
}
