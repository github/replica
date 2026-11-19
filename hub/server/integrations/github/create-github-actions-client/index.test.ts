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

describe("createGitHubActionsClient", () => {
  it("requests one repository-scoped token for Actions and branch reads", async () => {
    const fetch = respond(() => new Response(JSON.stringify({ total_count: 0, artifacts: [] })))
    const client = createGitHubActionsClient(input, { fetch })

    await client.listRunArtifacts(7, "replica-build-v1")
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

    const runs = await client.listWorkflowRuns(new Date("2026-01-01T00:00:00Z"))
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
    expect(url.searchParams.get("created")).toBe(">=2026-01-01T00:00:00.000Z")
    await expect(client.listWorkflowRuns(new Date())).resolves.toEqual([])
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
})
