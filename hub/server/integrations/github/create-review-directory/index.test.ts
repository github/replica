import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { GitHubProviderRequestError } from "../errors"

import { createReviewDirectory } from "."

const installationTokenPath = "/app/installations/17/access_tokens"
const repositoryPath = "/repositories/42"
const oldPermissionPath = "/repos/sandbox/renamed/collaborators/old-login/permission"
const permissionPath = "/repos/sandbox/renamed/collaborators/reviewer/permission"

function directoryWith(
  responseFor: (path: string, query: URLSearchParams) => Response | Promise<Response>,
) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const request = vi.fn<typeof fetch>((input, options) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname === installationTokenPath) {
      expect(options?.body).toBe(JSON.stringify({ repository_ids: [42] }))
      return Promise.resolve(
        Response.json({
          token: "synthetic",
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        }),
      )
    }
    expect(options?.method ?? (input instanceof Request ? input.method : "GET")).toBe("GET")
    if (url.pathname === repositoryPath) {
      return Promise.resolve(Response.json({ id: 42, full_name: "sandbox/renamed" }))
    }
    return Promise.resolve(responseFor(url.pathname, url.searchParams))
  })
  return {
    directory: createReviewDirectory({ appId: "16", installationId: "17", privateKey }, request),
    request,
  }
}

it("returns the matches found when the search reaches the page limit", async () => {
  const pages: number[] = []
  const matchingLogins = new Map([
    [1, "mona-reviewer"],
    [2000, "mona"],
  ])
  const { directory } = directoryWith((path, query) => {
    if (path !== "/repos/sandbox/renamed/collaborators") {
      throw new Error(`Unexpected request: ${path}`)
    }
    const page = Number(query.get("page"))
    const perPage = Number(query.get("per_page"))
    expect(perPage).toBe(100)
    pages.push(page)
    return Response.json(
      Array.from({ length: perPage }, (_, index) => {
        const id = (page - 1) * perPage + index + 1
        return { id, login: matchingLogins.get(id) ?? `reviewer-${id}` }
      }),
    )
  })

  const matches = await directory.search(42n, "mona")
  expect(matches.map(({ login }) => login).sort()).toEqual(["mona", "mona-reviewer"])
  expect(pages).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
})

it("uses the immutable repository ID when checking a collaborator after a rename", async () => {
  const { directory, request } = directoryWith((path) => {
    switch (path) {
      case "/user/501":
        return Response.json({ id: 501, login: "reviewer" })
      case permissionPath:
        return Response.json({ user: { id: 501 }, permission: "read" })
      default:
        throw new Error(`Unexpected request: ${path}`)
    }
  })
  await expect(directory.find(42n, "old-login", 501)).resolves.toMatchObject({
    githubId: 501,
    login: "reviewer",
  })
  request.mockImplementationOnce(() =>
    Promise.resolve(Response.json({ id: 99, full_name: "sandbox/renamed" })),
  )
  request.mockClear()
  await expect(directory.find(42n, "reviewer", 501)).resolves.toBeNull()
  expect(request).toHaveBeenCalledTimes(1)
})

describe("createReviewDirectory()", () => {
  it.each(["reviewer_enterprise", `${"r".repeat(34)}_corp`])(
    "resolves managed account %s by numeric identity and live repository permission",
    async (login) => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            token: "synthetic",
            expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          }),
        )
        .mockResolvedValueOnce(Response.json({ id: 42, full_name: "sandbox/renamed" }))
        .mockResolvedValueOnce(Response.json({ id: 501, login }))
        .mockResolvedValueOnce(Response.json({ user: { id: 501 }, permission: "read" }))
      const directory = createReviewDirectory(
        { appId: "16", installationId: "17", privateKey },
        request,
      )

      await expect(directory.find(42n, "old-login", 501)).resolves.toEqual({
        githubId: 501,
        login,
        avatarUrl: null,
      })
      expect(
        request.mock.calls.map(
          ([input]) => new URL(input instanceof Request ? input.url : input).pathname,
        ),
      ).toEqual([
        "/app/installations/17/access_tokens",
        "/repositories/42",
        "/user/501",
        `/repos/sandbox/renamed/collaborators/${login}/permission`,
      ])
      expect(request.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ repository_ids: [42] }))
    },
  )

  it.each([
    {
      reason: "a different profile identity",
      profileId: 502,
      collaboratorId: 501,
      permission: "read",
    },
    {
      reason: "a different collaborator identity",
      profileId: 501,
      collaboratorId: 502,
      permission: "read",
    },
    { reason: "no repository permission", profileId: 501, collaboratorId: 501, permission: "none" },
  ])("denies a managed account with $reason", async ({ profileId, collaboratorId, permission }) => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          token: "synthetic",
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 42, full_name: "sandbox/private" }))
      .mockResolvedValueOnce(Response.json({ id: profileId, login: "reviewer_enterprise" }))
      .mockResolvedValueOnce(Response.json({ user: { id: collaboratorId }, permission }))
    const directory = createReviewDirectory(
      { appId: "16", installationId: "17", privateKey },
      request,
    )

    await expect(directory.find(42n, "reviewer_enterprise", 501)).resolves.toBeNull()
  })

  it("reports an unavailable collaborator directory instead of an empty search", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          token: "synthetic",
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 42, full_name: "sandbox/private" }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const directory = createReviewDirectory(
      { appId: "16", installationId: "17", privateKey },
      request,
    )

    await expect(directory.search(42n, "reviewer_enterprise")).rejects.toBeInstanceOf(
      GitHubProviderRequestError,
    )
  })
})

it.each(["reviewer", "reviewer_enterprise", `${"r".repeat(34)}_corp`])(
  "shares only pending verification for the same repository and GitHub user with login %s",
  async (login) => {
    let startVerification!: () => void
    let finishVerification!: () => void
    const verifying = new Promise<void>((resolve) => (startVerification = resolve))
    const pending = new Promise<void>((resolve) => (finishVerification = resolve))
    let permission = "read"
    const { directory, request } = directoryWith((path) => {
      switch (path) {
        case `/repos/sandbox/renamed/collaborators/${login}/permission`:
          startVerification()
          return pending.then(() => Response.json({ user: { id: 501 }, permission }))
        case oldPermissionPath:
          return new Response(null, { status: 404 })
        case "/user/501":
          return Response.json({ id: 501, login })
        default:
          throw new Error(`Unexpected request: ${path}`)
      }
    })
    const first = directory.canRead(42n, login, 501)
    try {
      await Promise.race([verifying, first])
      const concurrent = directory.canRead(42n, "old-login", 501)
      finishVerification()
      await expect(Promise.all([first, concurrent])).resolves.toEqual([true, true])
    } finally {
      finishVerification()
    }
    const requests = request.mock.calls
      .map(([input]) => new URL(input instanceof Request ? input.url : input).pathname)
      .filter((path) => path !== installationTokenPath)
    expect(requests).toEqual([
      repositoryPath,
      `/repos/sandbox/renamed/collaborators/${login}/permission`,
    ])

    permission = "none"
    await expect(directory.canRead(42n, login, 501)).resolves.toBe(false)
  },
)

it.each([
  ["has no permission record", null],
  ["belongs to another account", 502],
])("uses the current GitHub login when the old login %s", async (_case, oldOwner) => {
  let currentOwner = 501
  const { directory } = directoryWith((path) => {
    switch (path) {
      case oldPermissionPath:
        return oldOwner === null
          ? new Response(null, { status: 404 })
          : Response.json({ user: { id: oldOwner }, permission: "admin" })
      case "/user/501":
        return Response.json({ id: 501, login: "reviewer_enterprise" })
      case "/repos/sandbox/renamed/collaborators/reviewer_enterprise/permission":
        return Response.json({ user: { id: currentOwner }, permission: "read" })
      default:
        throw new Error(`Unexpected request: ${path}`)
    }
  })
  await expect(directory.canRead(42n, "old-login", 501)).resolves.toBe(true)
  currentOwner = 502
  await expect(directory.canRead(42n, "old-login", 501)).resolves.toBe(false)
})
