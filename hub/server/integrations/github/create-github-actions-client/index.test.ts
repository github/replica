import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { GitHubProviderRequestError } from "../errors"
import { createGitHubActionsClient } from "."

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const input = { appId: "12", installationId: "34", privateKey, githubRepositoryId: 56 }

type Handler = (url: URL, init: RequestInit) => Response
function respond(
  handler: Handler,
  configuration?: (url: URL, init: RequestInit) => Response | undefined,
) {
  return vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
    const href = new URL(url instanceof Request ? url.url : url.toString())
    if (href.pathname === "/app/installations/34/access_tokens") {
      return Promise.resolve(new Response(JSON.stringify({ token: "t" }), { status: 201 }))
    }
    if (
      href.pathname === "/repositories/56" ||
      href.pathname.startsWith("/repositories/56/git/ref/heads/") ||
      href.pathname.startsWith("/repositories/56/git/trees/") ||
      href.pathname === "/repositories/56/contents/.github/replica.json"
    ) {
      const overridden = configuration?.(href, init ?? {})
      if (overridden) return Promise.resolve(overridden)
      if (href.pathname === "/repositories/56") {
        return Promise.resolve(Response.json({ id: 56, default_branch: "trunk" }))
      }
      if (href.pathname.includes("/git/ref/")) {
        return Promise.resolve(Response.json({ object: { type: "commit", sha: "c".repeat(40) } }))
      }
      if (href.pathname === `/repositories/56/git/trees/${"c".repeat(40)}`) {
        return Promise.resolve(
          Response.json({
            truncated: false,
            tree: [{ path: ".github", mode: "040000", type: "tree", sha: "d".repeat(40) }],
          }),
        )
      }
      if (href.pathname === `/repositories/56/git/trees/${"d".repeat(40)}`) {
        return Promise.resolve(
          Response.json({
            truncated: false,
            tree: configuration
              ? [{ path: "replica.json", mode: "100644", type: "blob", sha: "e".repeat(40) }]
              : [],
          }),
        )
      }
      return Promise.resolve(new Response("{}", { status: 404 }))
    }
    return Promise.resolve(handler(href, init ?? {}))
  })
}

function configurationFile(content: string) {
  return Response.json({
    type: "file",
    encoding: "base64",
    size: Buffer.byteLength(content),
    content: Buffer.from(content).toString("base64"),
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
  it("pins selection to the actual default branch commit and caches it only for one client", async () => {
    let filename = "publish-proto.yml"
    const fetch = respond(
      () => Response.json({ workflow_runs: [] }),
      (url) =>
        url.pathname.endsWith("/replica.json")
          ? configurationFile(
              JSON.stringify({
                version: 1,
                hub: { origin: "https://hub.example.test" },
                templates: [],
                builds: { workflows: [`.github/workflows/${filename}`] },
              }),
            )
          : undefined,
    )
    const client = createGitHubActionsClient(input, { fetch })

    await expect(
      Promise.all([client.getBuildWorkflowPaths(), client.getBuildWorkflowPaths()]),
    ).resolves.toEqual([
      [".github/workflows/publish-proto.yml"],
      [".github/workflows/publish-proto.yml"],
    ])
    filename = "next.yaml"
    await client.listWorkflowRuns(new Date("2026-01-01T00:00:00Z"))
    await expect(client.getBuildWorkflowPaths()).resolves.toEqual([
      ".github/workflows/publish-proto.yml",
    ])

    const requests = fetch.mock.calls.map(([url]) => url as URL)
    expect(requests.filter((url) => url.pathname === "/repositories/56")).toHaveLength(1)
    expect(
      requests.filter((url) => url.pathname === "/repositories/56/git/ref/heads/trunk"),
    ).toHaveLength(1)
    const configReads = requests.filter((url) => url.pathname.endsWith("/replica.json"))
    expect(configReads).toHaveLength(1)
    expect(configReads[0]?.searchParams.get("ref")).toBe("c".repeat(40))
    expect(
      requests.filter((url) => url.pathname.includes("/git/trees/")).map((url) => url.pathname),
    ).toEqual([
      `/repositories/56/git/trees/${"c".repeat(40)}`,
      `/repositories/56/git/trees/${"d".repeat(40)}`,
    ])
    expect(
      requests
        .filter((url) => url.pathname.includes("/actions/workflows/"))
        .map((url) => url.pathname),
    ).toEqual(["/repositories/56/actions/workflows/publish-proto.yml/runs"])
    await expect(
      createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
    ).resolves.toEqual([".github/workflows/next.yaml"])
  })

  it("pages every selected workflow independently and deduplicates run IDs across them", async () => {
    const workflows = [".github/workflows/publish-proto.yml", ".github/workflows/preview.yaml"]
    const fetch = respond(
      (url) => {
        const path = url.pathname.includes("publish-proto.yml") ? workflows[0] : workflows[1]
        const ids = path === workflows[0] ? [7, 6, 5] : [5, 4, 3]
        const page = Number(url.searchParams.get("page"))
        const runs = ids.slice((page - 1) * 2, page * 2).map((id) => ({
          ...workflowRun(id),
          path,
        }))
        return Response.json({ total_count: 3, workflow_runs: runs })
      },
      (url) =>
        url.pathname.endsWith("/replica.json")
          ? configurationFile(JSON.stringify({ version: 1, builds: { workflows } }))
          : undefined,
    )

    const runs = await createGitHubActionsClient(input, { fetch }).listWorkflowRuns(
      new Date("2026-01-01T00:00:00Z"),
      2,
    )

    expect(runs.map((run) => run.id).sort()).toEqual([3, 4, 5, 6, 7])
    const requests = fetch.mock.calls
      .map(([url]) => url as URL)
      .filter((url) => url.pathname.includes("/actions/workflows/"))
    expect(
      requests.map((url) => [url.pathname.split("/").at(-2), url.searchParams.get("page")]),
    ).toEqual([
      ["publish-proto.yml", "1"],
      ["publish-proto.yml", "2"],
      ["preview.yaml", "1"],
      ["preview.yaml", "2"],
    ])
    expect(requests.every((url) => url.searchParams.get("event") === "push")).toBe(true)
  })

  it.each(["provider error", "truncated results"])(
    "does not return earlier workflow results after a later workflow has %s",
    async (failure) => {
      const workflows = [".github/workflows/first.yml", ".github/workflows/second.yaml"]
      const fetch = respond(
        (url) => {
          if (url.pathname.includes("/first.yml/")) {
            return Response.json({ workflow_runs: [workflowRun(7)] })
          }
          if (failure === "provider error") return new Response("{}", { status: 503 })
          const size = Number(url.searchParams.get("per_page"))
          return Response.json({
            total_count: 1_001,
            workflow_runs: Array.from({ length: size }, (_, index) => workflowRun(100 + index)),
          })
        },
        (url) =>
          url.pathname.endsWith("/replica.json")
            ? configurationFile(JSON.stringify({ version: 1, builds: { workflows } }))
            : undefined,
      )

      await expect(
        createGitHubActionsClient(input, { fetch }).listWorkflowRuns(
          new Date("2026-01-01T00:00:00Z"),
        ),
      ).rejects.toThrow(GitHubProviderRequestError)
    },
  )

  it("continues discovery when one selected workflow has not produced any runs", async () => {
    const fetch = respond(
      (url) =>
        url.pathname.includes("/missing.yml/")
          ? new Response("{}", { status: 404 })
          : Response.json({
              workflow_runs: [{ ...workflowRun(7), path: ".github/workflows/publish.yaml" }],
            }),
      (url) =>
        url.pathname.endsWith("/replica.json")
          ? configurationFile(
              JSON.stringify({
                version: 1,
                builds: {
                  workflows: [".github/workflows/missing.yml", ".github/workflows/publish.yaml"],
                },
              }),
            )
          : undefined,
    )

    await expect(
      createGitHubActionsClient(input, { fetch }).listWorkflowRuns(
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).resolves.toEqual([expect.objectContaining({ id: 7 })])
  })

  it.each([401, 403, 404, 429, 503])(
    "does not treat a configuration HTTP %s failure as omitted configuration",
    async (status) => {
      const fetch = respond(
        () => Response.json({ workflow_runs: [] }),
        (url) =>
          url.pathname.endsWith("/replica.json") ? new Response("{}", { status }) : undefined,
      )

      await expect(
        createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
      ).rejects.toThrow(GitHubProviderRequestError)
    },
  )

  it.each(["configuration file", "configuration directory"])(
    "rejects a symlinked %s before the Contents API can follow it",
    async (target) => {
      const fetch = respond(
        () => Response.json({}),
        (url) => {
          const treeSha = target === "configuration file" ? "d" : "c"
          if (url.pathname === `/repositories/56/git/trees/${treeSha.repeat(40)}`) {
            return Response.json({
              truncated: false,
              tree: [
                {
                  path: target === "configuration file" ? "replica.json" : ".github",
                  mode: "120000",
                  type: "blob",
                  sha: "e".repeat(40),
                },
              ],
            })
          }
          if (url.pathname.endsWith("/replica.json")) {
            return configurationFile(
              '{"version":1,"builds":{"workflows":[".github/workflows/redirected.yml"]}}',
            )
          }
          return undefined
        },
      )

      await expect(
        createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
      ).rejects.toThrow()
      expect(fetch.mock.calls.some(([url]) => (url as URL).pathname.includes("/contents/"))).toBe(
        false,
      )
    },
  )

  it("accepts a regular executable configuration at the end of a 2000-entry tree", async () => {
    const fetch = respond(
      () => Response.json({}),
      (url) => {
        if (url.pathname === `/repositories/56/git/trees/${"d".repeat(40)}`) {
          return Response.json({
            truncated: false,
            tree: [
              ...Array.from({ length: 1999 }, (_, index) => ({
                path: `other-${index}`,
                mode: "100644",
                type: "blob",
                sha: "e".repeat(40),
              })),
              { path: "replica.json", mode: "100755", type: "blob", sha: "e".repeat(40) },
            ],
          })
        }
        return url.pathname.endsWith("/replica.json")
          ? configurationFile(
              '{"version":1,"builds":{"workflows":[".github/workflows/publish.yml"]}}',
            )
          : undefined
      },
    )

    await expect(
      createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
    ).resolves.toEqual([".github/workflows/publish.yml"])
  })

  it.each([".github", "replica.json"])(
    "uses the legacy workflow only when the pinned tree has no %s entry",
    async (missing) => {
      const fetch = respond(
        () => Response.json({}),
        (url) => {
          const treeSha = missing === ".github" ? "c" : "d"
          if (url.pathname === `/repositories/56/git/trees/${treeSha.repeat(40)}`) {
            return Response.json({ truncated: false, tree: [] })
          }
          return undefined
        },
      )

      await expect(
        createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
      ).resolves.toEqual([".github/workflows/replica.yml"])
      expect(fetch.mock.calls.some(([url]) => (url as URL).pathname.includes("/contents/"))).toBe(
        false,
      )
    },
  )

  it.each(["truncated", "malformed", "too many entries", "oversized"])(
    "rejects %s tree evidence rather than treating configuration as absent",
    async (failure) => {
      const fetch = respond(
        () => Response.json({}),
        (url) => {
          if (url.pathname === `/repositories/56/git/trees/${"d".repeat(40)}`) {
            if (failure === "truncated") return Response.json({ truncated: true, tree: [] })
            if (failure === "malformed") return Response.json({ truncated: false, tree: null })
            if (failure === "oversized") {
              return Response.json({
                truncated: false,
                tree: [],
                padding: "x".repeat(1024 * 1024),
              })
            }
            return Response.json({
              truncated: false,
              tree: Array.from({ length: 2001 }, (_, index) => ({
                path: `other-${index}`,
                mode: "100644",
                type: "blob",
                sha: "e".repeat(40),
              })),
            })
          }
          return undefined
        },
      )

      await expect(
        createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
      ).rejects.toThrow()
      expect(fetch.mock.calls.some(([url]) => (url as URL).pathname.includes("/contents/"))).toBe(
        false,
      )
    },
  )

  it.each([
    { treeSha: "c", status: 404 },
    { treeSha: "d", status: 503 },
  ])("does not fall back after a tree HTTP $status failure", async ({ treeSha, status }) => {
    const fetch = respond(
      () => Response.json({}),
      (url) =>
        url.pathname === `/repositories/56/git/trees/${treeSha.repeat(40)}`
          ? new Response("{}", { status })
          : undefined,
    )

    await expect(
      createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
    ).rejects.toThrow(GitHubProviderRequestError)
  })

  it.each(["/repositories/56", "/repositories/56/git/ref/heads/trunk"])(
    "does not treat missing source evidence at %s as omitted configuration",
    async (path) => {
      const fetch = respond(
        () => Response.json({}),
        (url) => (url.pathname === path ? new Response("{}", { status: 404 }) : undefined),
      )

      await expect(
        createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
      ).rejects.toThrow(GitHubProviderRequestError)
    },
  )

  it("propagates transport failures rather than falling back to the legacy workflow", async () => {
    const fetch = respond(
      () => Response.json({}),
      (url) => {
        if (url.pathname.endsWith("/replica.json")) throw new TypeError("Connection reset")
        return undefined
      },
    )

    await expect(
      createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
    ).rejects.toThrow(GitHubProviderRequestError)
  })

  it.each([
    { type: "symlink", encoding: "base64", size: 13, content: "eyJ2ZXJzaW9uIjoxfQ==" },
    { type: "file", encoding: "utf-8", size: 13, content: '{"version":1}' },
    { type: "file", encoding: "base64", size: 13, content: "not base64 JSON" },
  ])(
    "rejects malformed configuration file evidence instead of using a fallback: %j",
    async (file) => {
      const fetch = respond(
        () => Response.json({}),
        (url) => (url.pathname.endsWith("/replica.json") ? Response.json(file) : undefined),
      )

      await expect(
        createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
      ).rejects.toThrow(/replica\.json|configuration/i)
    },
  )

  it.each(["{invalid", '{"version":1,"builds":{"workflows":[]}}'])(
    "reports malformed explicit configuration instead of selecting the legacy workflow: %s",
    async (content) => {
      const fetch = respond(
        () => Response.json({}),
        (url) => (url.pathname.endsWith("/replica.json") ? configurationFile(content) : undefined),
      )

      await expect(
        createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
      ).rejects.toThrow(/replica\.json|configuration|workflows/i)
    },
  )

  it("bounds decoded configuration bytes rather than the encoded response length", async () => {
    const content = '{"version":1}'.padEnd(16_384, " ")
    const fetch = respond(
      () => Response.json({}),
      (url) => (url.pathname.endsWith("/replica.json") ? configurationFile(content) : undefined),
    )
    await expect(
      createGitHubActionsClient(input, { fetch }).getBuildWorkflowPaths(),
    ).resolves.toEqual([".github/workflows/replica.yml"])

    const oversized = respond(
      () => Response.json({}),
      (url) =>
        url.pathname.endsWith("/replica.json")
          ? Response.json({
              type: "file",
              encoding: "base64",
              size: 1,
              content: Buffer.from(`${content} `).toString("base64"),
            })
          : undefined,
    )
    await expect(
      createGitHubActionsClient(input, { fetch: oversized }).getBuildWorkflowPaths(),
    ).rejects.toThrow(/16384|16 KiB|large|size|bytes/i)
  })

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
