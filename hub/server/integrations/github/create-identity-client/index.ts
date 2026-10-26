import { createHash, sign } from "node:crypto"
import { z } from "zod"

import type {
  GitHubCredentials,
  GitHubIdentityClient,
  GitHubProfile,
  RepositoryPermission,
} from "../../../utils/identity-contracts/types.ts"
import { IdentityError } from "../../../utils/identity-error/index.ts"

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const profileSchema = z.object({
  id,
  login: z.string().min(1).max(100),
  name: z.string().nullable(),
  avatar_url: z.url(),
})

class GitHubResponseError extends IdentityError {
  upstreamStatus: number

  constructor(upstreamStatus: number) {
    super(
      503,
      "github_unavailable",
      "GitHub could not verify identity or repository access. Try again.",
    )
    this.upstreamStatus = upstreamStatus
  }
}

export function createGitHubIdentityClient(origin: string): GitHubIdentityClient {
  async function request(path: string, token: string, method = "GET"): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      })
    } catch {
      throw new GitHubResponseError(0)
    }
    if (!response.ok) throw new GitHubResponseError(response.status)
    return response.json()
  }

  function appToken(credentials: GitHubCredentials): string {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
    const payload = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: credentials.appId }),
    ).toString("base64url")
    const unsigned = `${header}.${payload}`
    return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), credentials.privateKey).toString("base64url")}`
  }

  async function installationToken(
    credentials: GitHubCredentials,
    installationId: number,
  ): Promise<string> {
    const data = await request(
      `/app/installations/${installationId}/access_tokens`,
      appToken(credentials),
      "POST",
    )
    return z.object({ token: z.string().min(1) }).parse(data).token
  }

  async function role(
    token: string,
    profile: GitHubProfile,
    fullName: string,
  ): Promise<RepositoryPermission> {
    let data: unknown
    try {
      data = await request(
        `/repos/${fullName}/collaborators/${encodeURIComponent(profile.login)}/permission`,
        token,
      )
    } catch (error) {
      if (error instanceof GitHubResponseError && error.upstreamStatus === 404) return "none"
      throw error
    }
    const result = z
      .object({
        permission: z.enum(["admin", "write", "read", "maintain", "triage", "none"]),
        user: z.object({ id }),
      })
      .parse(data)
    if (String(result.user.id) !== profile.providerId) {
      throw new IdentityError(
        403,
        "identity_mismatch",
        "GitHub's repository permission response did not match the signed-in account.",
      )
    }
    if (result.permission === "maintain") return "write"
    if (result.permission === "triage") return "read"
    return result.permission
  }

  return {
    authorize(credentials, state, verifier) {
      const url = new URL("https://github.com/login/oauth/authorize")
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: `${origin}/api/auth/github/callback`,
        state,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      }).toString()
      return url.href
    },
    async identify(credentials, code, verifier) {
      let response: Response
      try {
        response = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            code,
            code_verifier: verifier,
            redirect_uri: `${origin}/api/auth/github/callback`,
          }),
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        })
      } catch {
        throw new GitHubResponseError(0)
      }
      if (!response.ok) throw new GitHubResponseError(response.status)
      const result = z.object({ access_token: z.string().min(1) }).safeParse(await response.json())
      if (!result.success) {
        throw new IdentityError(
          401,
          "github_sign_in_failed",
          "GitHub did not authorize this sign-in. Start again.",
        )
      }
      const profile = profileSchema.parse(await request("/user", result.data.access_token))
      return {
        providerId: String(profile.id),
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatar_url,
      }
    },
    async admitted(credentials, profile) {
      for (let page = 1; page <= 100; page++) {
        const installations = z
          .array(z.object({ id }))
          .parse(
            await request(`/app/installations?per_page=100&page=${page}`, appToken(credentials)),
          )
        for (const installation of installations) {
          const token = await installationToken(credentials, installation.id)
          for (let repositoryPage = 1; repositoryPage <= 100; repositoryPage++) {
            const data = z
              .object({
                repositories: z.array(
                  z.object({ full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }),
                ),
              })
              .parse(
                await request(
                  `/installation/repositories?per_page=100&page=${repositoryPage}`,
                  token,
                ),
              )
            for (const repository of data.repositories) {
              if ((await role(token, profile, repository.full_name)) !== "none") return true
            }
            if (data.repositories.length < 100) break
            if (repositoryPage === 100) {
              throw new IdentityError(
                503,
                "github_limit",
                "GitHub repository discovery exceeded the supported page limit.",
              )
            }
          }
        }
        if (installations.length < 100) return false
      }
      throw new IdentityError(
        503,
        "github_limit",
        "GitHub installation discovery exceeded the supported page limit.",
      )
    },
    async permission(credentials, profile, owner, repository) {
      const fullName = `${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
      let data: unknown
      try {
        data = await request(`/repos/${fullName}/installation`, appToken(credentials))
      } catch (error) {
        if (error instanceof GitHubResponseError && error.upstreamStatus === 404) return "none"
        throw error
      }
      const installation = z.object({ id }).parse(data)
      return role(await installationToken(credentials, installation.id), profile, fullName)
    },
  }
}
