import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { GitHubProviderRequestError } from "../errors.ts"
import { createGitHubActionsClient } from "./index.ts"

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
  it("requests a repository-scoped Actions read token once", async () => {
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
      permissions: { actions: "read" },
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
})
