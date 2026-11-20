import { z } from "zod"

import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"
import { GitHubProviderRequestError } from "../errors.ts"
import type {
  GitHubActionsClientInput,
  GitHubActionsClientOptions,
  GitHubWorkflowArtifact,
  GitHubWorkflowRun,
} from "./types.ts"

const tokenSchema = z.looseObject({ token: z.string().min(1) })
const actorSchema = z
  .looseObject({
    id: z.number().int().positive(),
    login: z.string().min(1).max(255),
    avatar_url: z.string().max(2048).nullish(),
  })
  .nullish()
const runSchema = z.looseObject({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  path: z.string().max(2048),
  event: z.string().max(100),
  head_branch: z.string().max(255).nullable(),
  head_sha: z.string(),
  status: z.string().max(50),
  conclusion: z.string().max(50).nullable(),
  html_url: z.string().max(2048),
  created_at: z.iso.datetime({ offset: true }),
  run_started_at: z.iso.datetime({ offset: true }).nullish(),
  updated_at: z.iso.datetime({ offset: true }),
  repository: z.looseObject({ id: z.number().int().positive() }),
  actor: actorSchema,
  triggering_actor: actorSchema,
})
const runsSchema = z.looseObject({ workflow_runs: z.array(runSchema) })
const branchHeadsSchema = z.array(
  z.looseObject({
    name: z.string().min(1).max(255),
    commit: z.looseObject({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  }),
)
const comparisonSchema = z.looseObject({
  status: z.enum(["ahead", "behind", "diverged"]),
  base_commit: z.looseObject({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  merge_base_commit: z.looseObject({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
})
const artifactsSchema = z.looseObject({
  total_count: z.number().int().nonnegative(),
  artifacts: z.array(
    z.looseObject({
      id: z.number().int().positive(),
      name: z.string().max(255),
      size_in_bytes: z.number().int().nonnegative(),
      expired: z.boolean(),
      created_at: z.iso.datetime({ offset: true }).optional(),
    }),
  ),
})
const maximumArtifactPages = 10
const commitSchema = z.looseObject({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  author: actorSchema.nonoptional(),
})

function mapRun(run: z.infer<typeof runSchema>): GitHubWorkflowRun {
  const actor = run.triggering_actor ?? run.actor
  return {
    id: run.id,
    runAttempt: run.run_attempt,
    path: run.path,
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    createdAt: new Date(run.created_at),
    ...(run.run_started_at ? { startedAt: new Date(run.run_started_at) } : {}),
    updatedAt: new Date(run.updated_at),
    repositoryId: run.repository.id,
    actor: actor ? { id: actor.id, login: actor.login, avatarUrl: actor.avatar_url ?? null } : null,
  }
}

async function readBounded(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel()
    return undefined
  }
  if (!response.body) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > maximumBytes) {
      await response.body.cancel().catch(() => undefined)
      return undefined
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Reads workflow runs and artifacts for one repository with a short-lived installation
 * token that only grants Actions and Contents read access to that repository.
 */
export function createGitHubActionsClient(
  input: GitHubActionsClientInput,
  {
    apiUrl = "https://api.github.com",
    fetch: request = fetch,
    now = () => new Date(),
    timeoutMs = 10_000,
    downloadTimeoutMs = 120_000,
  }: GitHubActionsClientOptions = {},
) {
  let token: Promise<string> | undefined
  const repositoryPath = `/repositories/${input.githubRepositoryId}`

  async function send(path: string, authorization: string, init: RequestInit = {}) {
    try {
      return await request(new URL(path, apiUrl), {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${authorization}`,
          "User-Agent": "Replica-Hub",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        redirect: init.redirect ?? "error",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new GitHubProviderRequestError({ cause: error })
    }
  }

  async function parse<Schema extends z.ZodType>(schema: Schema, response: Response) {
    if (!response.ok) throw new GitHubProviderRequestError()
    const body = schema.safeParse(await response.json().catch(() => undefined))
    if (!body.success) throw new GitHubProviderRequestError({ cause: body.error })
    return body.data
  }

  function installationToken() {
    token ??= (async () => {
      const response = await send(
        `/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
        await createGitHubAppJwt(input, now()),
        {
          method: "POST",
          body: JSON.stringify({
            repository_ids: [input.githubRepositoryId],
            permissions: { actions: "read", contents: "read" },
          }),
        },
      )
      return (await parse(tokenSchema, response)).token
    })()
    token.catch(() => {
      token = undefined
    })
    return token
  }

  return {
    /** Resolves the account GitHub associates with this immutable commit, not its pusher. */
    async getCommitAuthor(commitSha: string) {
      if (!/^[0-9a-f]{40}$/.test(commitSha)) {
        throw new GitHubProviderRequestError({ cause: new Error("Invalid commit SHA.") })
      }
      const response = await send(
        `${repositoryPath}/commits/${commitSha}`,
        await installationToken(),
      )
      if (response.status === 404 || response.status === 422) return null
      const commit = await parse(commitSchema, response)
      if (commit.sha !== commitSha) {
        throw new GitHubProviderRequestError({
          cause: new Error("GitHub returned a different commit."),
        })
      }
      return commit.author
        ? {
            providerUserId: String(commit.author.id),
            login: commit.author.login,
            avatarUrl: commit.author.avatar_url ?? null,
          }
        : null
    },

    /** Lists branch heads without assuming a truncated response is a complete snapshot. */
    async listBranchHeads(): Promise<{ branchName: string; commitSha: string }[]> {
      const heads: { branchName: string; commitSha: string }[] = []
      for (let page = 1; page <= 10; page += 1) {
        const response = await send(
          `${repositoryPath}/branches?per_page=100&page=${page}`,
          await installationToken(),
        )
        const branches = await parse(branchHeadsSchema, response)
        heads.push(
          ...branches.map((branch) => ({
            branchName: branch.name,
            commitSha: branch.commit.sha,
          })),
        )
        if (branches.length < 100) return heads
      }
      throw new GitHubProviderRequestError({
        cause: new Error("Branch discovery exceeded its ten-page limit."),
      })
    },

    /** A shared ancestor is insufficient: the complete saved head must be contained. */
    async isAncestor(base: string, head: string): Promise<boolean> {
      if (!/^[0-9a-f]{40}$/.test(base) || !/^[0-9a-f]{40}$/.test(head)) {
        throw new GitHubProviderRequestError({ cause: new Error("Invalid branch ancestry SHA.") })
      }
      if (base === head) return true
      const comparison = await parse(
        comparisonSchema,
        await send(`${repositoryPath}/compare/${base}...${head}`, await installationToken()),
      )
      const mergeBase = comparison.merge_base_commit.sha
      if (
        comparison.base_commit.sha !== base ||
        (comparison.status === "ahead") !== (mergeBase === base) ||
        (comparison.status === "behind" && mergeBase !== head) ||
        (comparison.status === "diverged" && mergeBase === head)
      ) {
        throw new GitHubProviderRequestError({
          cause: new Error("GitHub returned contradictory branch ancestry."),
        })
      }
      return comparison.status === "ahead"
    },

    /** Returns the run, or null when GitHub no longer has it for this repository. */
    async getWorkflowRun(runId: number): Promise<GitHubWorkflowRun | null> {
      const response = await send(
        `${repositoryPath}/actions/runs/${runId}`,
        await installationToken(),
      )
      if (response.status === 404) return null
      return mapRun(await parse(runSchema, response))
    },

    /**
     * Lists push runs of the Replica workflow through createdAfter. GitHub caps filtered
     * run searches at 1,000 results; report truncation instead of silently missing runs.
     */
    async listWorkflowRuns(createdAfter: Date, perPage = 50): Promise<GitHubWorkflowRun[]> {
      const runs: GitHubWorkflowRun[] = []
      for (let page = 1; page <= Math.ceil(1_000 / perPage); page += 1) {
        const query = new URLSearchParams({
          event: "push",
          created: `>=${createdAfter.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
          per_page: String(perPage),
          page: String(page),
        })
        const response = await send(
          `${repositoryPath}/actions/workflows/replica.yml/runs?${query}`,
          await installationToken(),
        )
        if (response.status === 404 && page === 1) return []
        const found = (await parse(runsSchema, response)).workflow_runs.map(mapRun)
        runs.push(...found.filter((run) => run.createdAt >= createdAfter))
        if (found.length < perPage || found.some((run) => run.createdAt < createdAfter)) {
          return runs
        }
      }
      throw new GitHubProviderRequestError({
        cause: new Error("Workflow run discovery reached GitHub's 1,000-result search limit."),
      })
    },

    async listRunArtifacts(runId: number, name: string): Promise<GitHubWorkflowArtifact[]> {
      const artifacts: GitHubWorkflowArtifact[] = []
      for (let page = 1; page <= maximumArtifactPages; page += 1) {
        const body = await parse(
          artifactsSchema,
          await send(
            `${repositoryPath}/actions/runs/${runId}/artifacts?name=${encodeURIComponent(name)}&per_page=100&page=${page}`,
            await installationToken(),
          ),
        )
        artifacts.push(
          ...body.artifacts
            .filter((artifact) => artifact.name === name)
            .map((artifact) => ({
              id: artifact.id,
              name: artifact.name,
              sizeInBytes: artifact.size_in_bytes,
              expired: artifact.expired,
              ...(artifact.created_at ? { createdAt: new Date(artifact.created_at) } : {}),
            })),
        )
        if (body.artifacts.length < 100 || page * 100 >= body.total_count) return artifacts
      }
      throw new GitHubProviderRequestError()
    },

    /**
     * Downloads an artifact ZIP. Returns "gone" when GitHub has expired or removed it,
     * and "too-large" when it exceeds maximumBytes; transport failures throw.
     */
    async downloadArtifact(artifactId: number, maximumBytes: number) {
      const redirect = await send(
        `${repositoryPath}/actions/artifacts/${artifactId}/zip`,
        await installationToken(),
        { redirect: "manual" },
      )
      if (redirect.status === 404 || redirect.status === 410) return { status: "gone" as const }
      const location = redirect.headers.get("location")
      if (redirect.status !== 302 || !location) throw new GitHubProviderRequestError()
      let url: URL
      try {
        url = new URL(location)
      } catch (error) {
        throw new GitHubProviderRequestError({ cause: error })
      }
      if (url.protocol !== "https:") throw new GitHubProviderRequestError()
      let response: Response
      try {
        // The signed storage URL must not receive the installation token.
        response = await request(url, {
          headers: { "User-Agent": "Replica-Hub" },
          redirect: "error",
          signal: AbortSignal.timeout(downloadTimeoutMs),
        })
      } catch (error) {
        throw new GitHubProviderRequestError({ cause: error })
      }
      if (!response.ok) throw new GitHubProviderRequestError()
      let bytes
      try {
        bytes = await readBounded(response, maximumBytes)
      } catch (error) {
        throw new GitHubProviderRequestError({ cause: error })
      }
      return bytes ? { status: "ok" as const, bytes } : { status: "too-large" as const }
    },
  }
}
