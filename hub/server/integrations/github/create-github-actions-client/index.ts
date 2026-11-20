import { z } from "zod"

import { readBuildWorkflowPaths } from "../../../utils/read-build-workflow-paths/index.ts"
import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"
import { GitHubCommitLookupError, GitHubProviderRequestError } from "../errors.ts"
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
  author: z.union([actorSchema.nonoptional(), z.strictObject({})]),
})
const maximumConfigurationBytes = 16_384
const repositorySchema = z.looseObject({
  id: z.number().int().positive(),
  default_branch: z.string().min(1).max(255),
})
const referenceSchema = z.looseObject({
  object: z.looseObject({
    type: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{40}$/),
  }),
})
const configurationFileSchema = z.looseObject({
  type: z.literal("file"),
  encoding: z.literal("base64"),
  size: z.number().int().nonnegative().max(maximumConfigurationBytes),
  content: z.string(),
})
const treeSchema = z.looseObject({
  truncated: z.literal(false),
  tree: z
    .array(
      z.looseObject({
        path: z.string().max(255),
        mode: z.string(),
        type: z.string(),
        sha: z.string().regex(/^[0-9a-f]{40}$/),
      }),
    )
    .max(2_000),
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
  let workflowPaths: Promise<string[]> | undefined
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

  async function getBuildWorkflowPaths(): Promise<string[]> {
    workflowPaths ??= (async () => {
      const authorization = await installationToken()
      const repository = await parse(repositorySchema, await send(repositoryPath, authorization))
      if (repository.id !== input.githubRepositoryId) throw new GitHubProviderRequestError()
      const reference = await parse(
        referenceSchema,
        await send(
          `${repositoryPath}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`,
          authorization,
        ),
      )
      async function readTree(sha: string) {
        const response = await send(`${repositoryPath}/git/trees/${sha}`, authorization)
        if (!response.ok) throw new GitHubProviderRequestError()
        const bytes = await readBounded(response, 1_048_576)
        if (!bytes) {
          throw new Error(
            "Cannot read .github/replica.json: its configuration directory exceeds the 1 MiB discovery limit.",
          )
        }
        let value: unknown
        try {
          value = JSON.parse(bytes.toString("utf8"))
        } catch (error) {
          throw new GitHubProviderRequestError({ cause: error })
        }
        const tree = treeSchema.safeParse(value)
        if (!tree.success) {
          throw new Error(
            "Cannot read .github/replica.json: GitHub must return a complete configuration directory with at most 2,000 entries.",
            { cause: tree.error },
          )
        }
        return tree.data.tree
      }
      const directory = (await readTree(reference.object.sha)).find(
        (entry) => entry.path === ".github",
      )
      if (!directory) return readBuildWorkflowPaths({ version: 1 })
      if (directory.type !== "tree" || directory.mode !== "040000") {
        throw new Error(".github must be a directory without symbolic links.")
      }
      const entry = (await readTree(directory.sha)).find((entry) => entry.path === "replica.json")
      if (!entry) return readBuildWorkflowPaths({ version: 1 })
      if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
        throw new Error(".github/replica.json must be a regular file without symbolic links.")
      }
      const response = await send(
        `${repositoryPath}/contents/.github/replica.json?ref=${reference.object.sha}`,
        authorization,
      )
      if (!response.ok) throw new GitHubProviderRequestError()
      const bytes = await readBounded(response, 32_768)
      if (!bytes) {
        throw new Error(".github/replica.json exceeds the 16,384-byte configuration limit.")
      }
      let value: unknown
      try {
        value = JSON.parse(bytes.toString("utf8"))
      } catch (error) {
        throw new GitHubProviderRequestError({ cause: error })
      }
      const file = configurationFileSchema.safeParse(value)
      if (!file.success) {
        throw new Error(
          ".github/replica.json must be a regular JSON file of at most 16,384 bytes on the default branch.",
          { cause: file.error },
        )
      }
      const content = Buffer.from(file.data.content, "base64")
      if (content.length > maximumConfigurationBytes || content.length !== file.data.size) {
        throw new Error(".github/replica.json has an invalid or oversized file size.")
      }
      let configuration: unknown
      try {
        configuration = JSON.parse(content.toString("utf8"))
      } catch (error) {
        throw new Error(".github/replica.json must contain correctly formatted JSON.", {
          cause: error,
        })
      }
      return readBuildWorkflowPaths(configuration)
    })()
    return workflowPaths
  }

  return {
    getBuildWorkflowPaths,

    /** Resolves the account GitHub associates with this immutable commit, not its pusher. */
    async getCommitAuthor(commitSha: string) {
      if (!/^[0-9a-f]{40}$/.test(commitSha)) {
        throw new GitHubProviderRequestError({ cause: new Error("Invalid commit SHA.") })
      }
      const response = await send(
        `${repositoryPath}/commits/${commitSha}`,
        await installationToken(),
      )
      if (!response.ok) throw new GitHubCommitLookupError(response.status)
      const commit = await parse(commitSchema, response)
      if (commit.sha !== commitSha) {
        throw new GitHubProviderRequestError({
          cause: new Error("GitHub returned a different commit."),
        })
      }
      return commit.author && "id" in commit.author
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
     * Lists push runs of selected workflows through createdAfter. GitHub caps filtered
     * run searches at 1,000 results; report truncation instead of silently missing runs.
     */
    async listWorkflowRuns(createdAfter: Date, perPage = 50): Promise<GitHubWorkflowRun[]> {
      if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
        throw new Error("GitHub workflow discovery page size must be between 1 and 100.")
      }
      const runs: GitHubWorkflowRun[] = []
      const paths = await getBuildWorkflowPaths()
      for (const path of paths) {
        let complete = false
        for (let page = 1; page <= Math.ceil(1_000 / perPage); page += 1) {
          const query = new URLSearchParams({
            event: "push",
            created: `>=${createdAfter.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
            per_page: String(perPage),
            page: String(page),
          })
          const response = await send(
            `${repositoryPath}/actions/workflows/${encodeURIComponent(path.slice(".github/workflows/".length))}/runs?${query}`,
            await installationToken(),
          )
          if (response.status === 404 && page === 1) {
            complete = true
            break
          }
          const found = (await parse(runsSchema, response)).workflow_runs.map(mapRun)
          runs.push(
            ...found.filter(
              (run) =>
                run.createdAt >= createdAfter &&
                run.repositoryId === input.githubRepositoryId &&
                run.event === "push" &&
                paths.includes(run.path.split("@")[0] ?? ""),
            ),
          )
          if (found.length < perPage || found.some((run) => run.createdAt < createdAfter)) {
            complete = true
            break
          }
        }
        if (!complete) {
          throw new GitHubProviderRequestError({
            cause: new Error("Workflow run discovery reached GitHub's 1,000-result search limit."),
          })
        }
      }
      return [...new Map(runs.map((run) => [run.id, run])).values()]
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
