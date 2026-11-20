import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { GitHubProviderRequestError } from "../errors"
import { createGitHubActionsClient } from "."

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const input = { appId: "12", installationId: "34", privateKey, githubRepositoryId: 56 }

type Handler = (url: URL, init: RequestInit) => Response
function respond(handler: Handler) {
  return vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
    const href = new URL(url instanceof Request ? url.url : url.toString())
    if (href.pathname === "/app/installations/34/access_tokens") {
      return Promise.resolve(new Response(JSON.stringify({ token: "t" }), { status: 201 }))
    }
    return Promise.resolve(handler(href, init ?? {}))
  })
}

function workflowRun(id: number, createdAt = "2026-01-02T00:00:00Z") {
  return {
    id,
    run_attempt: 1,
    path: ".github/workflows/replica.yml",
    event: "push",
    head_branch: "proto/welcome",
    head_sha: "a".repeat(40),
    status: "completed",
    conclusion: "success",
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    repository: { id: 56 },
    actor: null,
  }
}

describe("createGitHubActionsClient", () => {
  it("reuses one repository-scoped token for Actions and commit reads", async () => {
    const fetch = respond((url) =>
      url.pathname.includes("/commits/")
        ? Response.json({ sha: "a".repeat(40), author: null })
        : Response.json({ total_count: 0, artifacts: [] }),
    )
    const client = createGitHubActionsClient(input, { fetch })

    await client.listRunArtifacts(7, "replica-build-v1")
    await client.getCommitAuthor("a".repeat(40))
    await client.listRunArtifacts(7, "replica-screenshots-v1")

    const tokenCalls = fetch.mock.calls.filter(([url]) =>
      (url as URL).href.includes("access_tokens"),
    )
    expect(tokenCalls).toHaveLength(1)
    expect(JSON.parse(tokenCalls[0]?.[1]?.body as string)).toEqual({
      repository_ids: [56],
      permissions: { actions: "read", contents: "read" },
    })
  })

  it.each([
    { id: 101, login: "commit-author", avatar_url: "https://avatars.githubusercontent.com/u/101" },
    { id: 102, login: "replica[bot]", avatar_url: null, type: "Bot" },
  ])("reads the canonical account for an immutable commit by $login", async (author) => {
    const sha = "a".repeat(40)
    const fetch = respond((url, init) => {
      expect(url.pathname).toBe(`/repositories/56/commits/${sha}`)
      expect(init.headers).toMatchObject({ Authorization: "Bearer t" })
      return Response.json({
        sha,
        author,
        committer: { id: 999, login: "different-committer" },
        commit: { author: { name: "Unverified display name", email: "author@example.test" } },
      })
    })
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.getCommitAuthor(sha)).resolves.toEqual({
      providerUserId: String(author.id),
      login: author.login,
      avatarUrl: author.avatar_url,
    })
  })

  it.each([null, {}])(
    "does not turn Git author text into a provider account (%j)",
    async (author) => {
      const sha = "a".repeat(40)
      const fetch = respond(() =>
        Response.json({
          sha,
          author,
          committer: { id: 999, login: "committer" },
          commit: { author: { name: "Octocat", email: "octocat@example.test" } },
        }),
      )
      const client = createGitHubActionsClient(input, { fetch })

      await expect(client.getCommitAuthor(sha)).resolves.toBeNull()
    },
  )

  it.each([
    { sha: "b".repeat(40), author: { id: 101, login: "commit-author" } },
    { sha: "b".repeat(40), author: null },
    { sha: "b".repeat(40), author: {} },
    { author: { id: 101, login: "commit-author" } },
    { sha: "a".repeat(40) },
    { sha: "a".repeat(40), author: { id: "101", login: "commit-author" } },
    { sha: "a".repeat(40), author: { id: 101 } },
    { sha: "a".repeat(40), author: { login: "commit-author" } },
    { sha: "a".repeat(40), author: { type: "User" } },
  ])("rejects malformed or mismatched commit evidence %#", async (commit) => {
    const fetch = respond(() => Response.json(commit))
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.getCommitAuthor("a".repeat(40))).rejects.toThrow(GitHubProviderRequestError)
  })

  it.each([403, 404, 422, 503])(
    "does not hide HTTP %s commit lookup failures as unknown",
    async (status) => {
      const fetch = respond(() => new Response("{}", { status }))
      const client = createGitHubActionsClient(input, { fetch })

      await expect(client.getCommitAuthor("a".repeat(40))).rejects.toThrow(
        GitHubProviderRequestError,
      )
    },
  )

  it("throws when the commit lookup transport fails", async () => {
    const fetch = respond(() => {
      throw new Error("Connection reset")
    })
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.getCommitAuthor("a".repeat(40))).rejects.toThrow(GitHubProviderRequestError)
  })

  it("downloads from the redirect without forwarding the token", async () => {
    const fetch = respond((url) =>
      url.hostname === "api.github.com"
        ? new Response(null, {
            status: 302,
            headers: { location: "https://blob.example/artifact.zip?sig=1" },
          })
        : new Response("zip-bytes"),
    )
    const client = createGitHubActionsClient(input, { fetch })

    const result = await client.downloadArtifact(9, 100)

    expect(result).toEqual({ status: "ok", bytes: Buffer.from("zip-bytes") })
    const [, init] = fetch.mock.calls.at(-1) as unknown as [URL, RequestInit]
    expect(init.headers).not.toHaveProperty("Authorization")
  })

  it("bounds downloads and reports expired artifacts", async () => {
    const fetch = respond((url) =>
      url.pathname.endsWith("/9/zip")
        ? new Response(null, { status: 302, headers: { location: "https://blob.example/a" } })
        : url.pathname.endsWith("/10/zip")
          ? new Response(null, { status: 410 })
          : new Response("x".repeat(101)),
    )
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.downloadArtifact(9, 100)).resolves.toEqual({ status: "too-large" })
    await expect(client.downloadArtifact(10, 100)).resolves.toEqual({ status: "gone" })
  })

  it("rejects insecure redirects and returns null for missing runs", async () => {
    const fetch = respond((url) =>
      url.pathname.endsWith("/zip")
        ? new Response(null, { status: 302, headers: { location: "http://blob.example/a" } })
        : new Response("{}", { status: 404 }),
    )
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.downloadArtifact(9, 100)).rejects.toThrow(GitHubProviderRequestError)
    await expect(client.getWorkflowRun(7)).resolves.toBeNull()
  })

  it("lists recent Replica push runs and treats a missing workflow as none", async () => {
    const run = {
      id: 7,
      run_attempt: 2,
      path: ".github/workflows/replica.yml",
      event: "push",
      head_branch: "main",
      head_sha: "a".repeat(40),
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/o/r/actions/runs/7",
      created_at: "2026-01-02T00:00:00Z",
      run_started_at: "2026-01-02T00:01:00Z",
      updated_at: "2026-01-02T00:05:00Z",
      repository: { id: 56 },
      actor: { id: 1, login: "octocat", avatar_url: null },
    }
    let missing = false
    const fetch = respond(() =>
      missing
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify({ total_count: 1, workflow_runs: [run] })),
    )
    const client = createGitHubActionsClient(input, { fetch })

    const runs = await client.listWorkflowRuns(new Date("2026-01-01T00:00:00.789Z"))
    missing = true

    expect(runs).toEqual([
      expect.objectContaining({
        id: 7,
        runAttempt: 2,
        status: "completed",
        startedAt: new Date("2026-01-02T00:01:00Z"),
      }),
    ])
    const [url] = fetch.mock.calls.at(-1) as unknown as [URL]
    expect(url.pathname).toBe("/repositories/56/actions/workflows/replica.yml/runs")
    expect(url.searchParams.get("event")).toBe("push")
    expect(url.searchParams.get("created")).toBe(">=2026-01-01T00:00:00Z")
    await expect(client.listWorkflowRuns(new Date())).resolves.toEqual([])
  })

  it("includes recent runs beyond the first page", async () => {
    const runs = Array.from({ length: 151 }, (_, index) => workflowRun(151 - index))
    const fetch = respond((url) => {
      const page = Number(url.searchParams.get("page") ?? 1)
      const size = Number(url.searchParams.get("per_page"))
      return Response.json({
        total_count: runs.length,
        workflow_runs: runs.slice((page - 1) * size, page * size),
      })
    })
    const client = createGitHubActionsClient(input, { fetch })

    const result = await client.listWorkflowRuns(new Date("2026-01-01T00:00:00Z"))
    expect(result.map((run) => run.id)).toEqual(runs.map((run) => run.id))
  })

  it("stops pagination at the creation boundary without returning older runs", async () => {
    let pages = 0
    const fetch = respond((url) => {
      pages += 1
      const size = Number(url.searchParams.get("per_page"))
      return Response.json({
        total_count: 900,
        workflow_runs: Array.from({ length: size }, (_, index) =>
          workflowRun(index + 1, index === 0 ? "2026-01-02T00:00:00Z" : "2025-12-31T23:59:59Z"),
        ),
      })
    })
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.listWorkflowRuns(new Date("2026-01-01T00:00:00Z"))).resolves.toEqual([
      expect.objectContaining({ id: 1 }),
    ])
    expect(pages).toBe(1)
  })

  it("reports truncated workflow search results instead of silently omitting runs", async () => {
    const fetch = respond((url) => {
      const size = Number(url.searchParams.get("per_page"))
      const page = Number(url.searchParams.get("page") ?? 1)
      return Response.json({
        total_count: 1_001,
        workflow_runs: Array.from({ length: size }, (_, index) =>
          workflowRun((page - 1) * size + index + 1),
        ),
      })
    })
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.listWorkflowRuns(new Date("2026-01-01T00:00:00Z"))).rejects.toThrow(
      GitHubProviderRequestError,
    )
  })

  it("preserves artifact creation times for rerun selection", async () => {
    const fetch = respond(
      () =>
        new Response(
          JSON.stringify({
            total_count: 1,
            artifacts: [
              {
                id: 9,
                name: "replica-build-v1",
                size_in_bytes: 123,
                expired: false,
                created_at: "2026-01-02T00:02:00Z",
              },
            ],
          }),
        ),
    )
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.listRunArtifacts(7, "replica-build-v1")).resolves.toEqual([
      {
        id: 9,
        name: "replica-build-v1",
        sizeInBytes: 123,
        expired: false,
        createdAt: new Date("2026-01-02T00:02:00Z"),
      },
    ])
  })

  it("reads every branch page and maps branch names and exact commit SHAs", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({
      name: `prototype/${index}`,
      commit: { sha: "a".repeat(40), url: "https://api.github.com/commits/ignored" },
      protected: false,
    }))
    const fetch = respond(
      (url) =>
        new Response(
          JSON.stringify(
            url.searchParams.get("page") === "1"
              ? first
              : [{ name: "prototype/last", commit: { sha: "b".repeat(40) } }],
          ),
        ),
    )
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.listBranchHeads()).resolves.toEqual([
      ...first.map(({ name, commit }) => ({ branchName: name, commitSha: commit.sha })),
      { branchName: "prototype/last", commitSha: "b".repeat(40) },
    ])
    const requests = fetch.mock.calls
      .map(([url]) => url as URL)
      .filter((url) => url.pathname.endsWith("/branches"))
    expect(requests.map((url) => url.pathname)).toEqual([
      "/repositories/56/branches",
      "/repositories/56/branches",
    ])
    expect(requests.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"])
    expect(requests.every((url) => url.searchParams.get("per_page") === "100")).toBe(true)
  })

  it("fails rather than returning a partial branch list beyond ten pages", async () => {
    const fetch = respond(
      () =>
        new Response(
          JSON.stringify(
            Array.from({ length: 100 }, (_, index) => ({
              name: `prototype/${index}`,
              commit: { sha: "a".repeat(40) },
            })),
          ),
        ),
    )
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.listBranchHeads()).rejects.toThrow(GitHubProviderRequestError)
    expect(
      fetch.mock.calls.filter(([url]) => (url as URL).pathname.endsWith("/branches")),
    ).toHaveLength(10)
  })

  it.each([[{ name: "prototype/a", commit: { sha: "not-a-commit" } }], [{ name: "prototype/a" }]])(
    "rejects malformed branch evidence",
    async (branch) => {
      const fetch = respond(() => new Response(JSON.stringify([branch])))
      const client = createGitHubActionsClient(input, { fetch })

      await expect(client.listBranchHeads()).rejects.toThrow(GitHubProviderRequestError)
    },
  )

  it("recognizes an identical head without requesting GitHub evidence", async () => {
    const fetch = respond(() => Response.json({}))
    const client = createGitHubActionsClient(input, { fetch })
    const sha = "a".repeat(40)

    await expect(client.isAncestor(sha, sha)).resolves.toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { status: "ahead", mergeBase: "a", expected: true },
    { status: "behind", mergeBase: "b", expected: false },
    { status: "diverged", mergeBase: "c", expected: false },
  ])("returns $expected for verified $status ancestry", async ({ status, mergeBase, expected }) => {
    const base = "a".repeat(40)
    const head = "b".repeat(40)
    const fetch = respond((url) => {
      expect(url.pathname).toBe(`/repositories/56/compare/${base}...${head}`)
      return Response.json({
        status,
        base_commit: { sha: base },
        merge_base_commit: { sha: mergeBase.repeat(40) },
      })
    })
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.isAncestor(base, head)).resolves.toBe(expected)
  })

  it.each([
    {},
    { status: "ahead", base_commit: { sha: "a".repeat(40) } },
    {
      status: "ahead",
      base_commit: { sha: "c".repeat(40) },
      merge_base_commit: { sha: "a".repeat(40) },
    },
    {
      status: "ahead",
      base_commit: { sha: "a".repeat(40) },
      merge_base_commit: { sha: "c".repeat(40) },
    },
    {
      status: "identical",
      base_commit: { sha: "a".repeat(40) },
      merge_base_commit: { sha: "a".repeat(40) },
    },
    {
      status: "behind",
      base_commit: { sha: "a".repeat(40) },
      merge_base_commit: { sha: "a".repeat(40) },
    },
    {
      status: "diverged",
      base_commit: { sha: "a".repeat(40) },
      merge_base_commit: { sha: "b".repeat(40) },
    },
  ])("rejects malformed or contradictory comparison evidence %#", async (comparison) => {
    const fetch = respond(() => Response.json(comparison))
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.isAncestor("a".repeat(40), "b".repeat(40))).rejects.toThrow(
      GitHubProviderRequestError,
    )
  })

  it.each([404, 503])("does not interpret HTTP %s as ancestry evidence", async (status) => {
    const fetch = respond(() => new Response("{}", { status }))
    const client = createGitHubActionsClient(input, { fetch })

    await expect(client.isAncestor("a".repeat(40), "b".repeat(40))).rejects.toThrow(
      GitHubProviderRequestError,
    )
  })
})
