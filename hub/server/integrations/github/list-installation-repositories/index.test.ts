import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { listInstallationRepositories } from "."

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const input = { appId: "12", installationId: "34", privateKey }

function repository(id: number) {
  return { id, full_name: `octo/repo-${id}`, default_branch: "main" }
}

function respond(pages: unknown[][], { tokenStatus = 201, totalCount = pages.flat().length } = {}) {
  return vi.fn((url: URL | RequestInfo) => {
    const href = new URL(url instanceof Request ? url.url : url.toString())
    if (href.pathname === "/app/installations/34/access_tokens") {
      return Promise.resolve(new Response(JSON.stringify({ token: "t" }), { status: tokenStatus }))
    }
    const page = Number(href.searchParams.get("page"))
    const repositories = pages[page - 1]
    return Promise.resolve(
      repositories
        ? new Response(JSON.stringify({ repositories, total_count: totalCount }))
        : new Response("{}", { status: 500 }),
    )
  })
}

describe("listInstallationRepositories", () => {
  it("lists every page with an installation token", async () => {
    const fetch = respond([
      Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      [repository(101)],
    ])
    const repositories = await listInstallationRepositories(input, { fetch })
    expect(repositories).toHaveLength(101)
    expect(repositories[100]).toEqual({
      defaultBranch: "main",
      githubRepositoryId: 101,
      nameWithOwner: "octo/repo-101",
    })
    const listing = fetch.mock.calls[1] as unknown as [URL, RequestInit]
    expect((listing[1].headers as Record<string, string>).Authorization).toBe("Bearer t")
  })

  it("throws rather than returning a partial list", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => repository(index + 1))
    const fetch = respond([fullPage], { totalCount: 101 })
    await expect(listInstallationRepositories(input, { fetch })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(3)
    await expect(
      listInstallationRepositories(input, { fetch: respond([[]], { tokenStatus: 401 }) }),
    ).rejects.toThrow()
  })

  it("rejects a truncated or inconsistent repository snapshot", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "t" })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ total_count: 2, repositories: [repository(1)] })),
      )
    await expect(listInstallationRepositories(input, { fetch })).rejects.toThrow()
  })

  it.each(["later-page 404", "changing total", "duplicate ID"] as const)(
    "rejects a repository snapshot with a %s",
    async (problem) => {
      const firstPage = Array.from({ length: 100 }, (_, index) => repository(index + 1))
      const secondPage =
        problem === "later-page 404"
          ? new Response(null, { status: 404 })
          : new Response(
              JSON.stringify({
                total_count: problem === "changing total" ? 102 : 101,
                repositories: [repository(problem === "duplicate ID" ? 1 : 101)],
              }),
            )
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ token: "t" })))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ total_count: 101, repositories: firstPage })),
        )
        .mockResolvedValueOnce(secondPage)

      await expect(listInstallationRepositories(input, { fetch })).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(3)
    },
  )
})
