import { generateKeyPairSync } from "node:crypto"
import { expect, it, vi } from "vitest"

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

it("shares only the pending verification for the same repository and GitHub user", async () => {
  let startVerification!: () => void
  let finishVerification!: () => void
  const verifying = new Promise<void>((resolve) => (startVerification = resolve))
  const pending = new Promise<void>((resolve) => (finishVerification = resolve))
  let permission = "read"
  const { directory, request } = directoryWith((path) => {
    switch (path) {
      case permissionPath:
        startVerification()
        return pending.then(() => Response.json({ user: { id: 501 }, permission }))
      case oldPermissionPath:
        return new Response(null, { status: 404 })
      case "/user/501":
        return Response.json({ id: 501, login: "reviewer" })
      default:
        throw new Error(`Unexpected request: ${path}`)
    }
  })
  const first = directory.canRead(42n, "reviewer", 501)
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
  expect(requests).toEqual([repositoryPath, permissionPath])

  permission = "none"
  await expect(directory.canRead(42n, "reviewer", 501)).resolves.toBe(false)
})

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
        return Response.json({ id: 501, login: "reviewer" })
      case permissionPath:
        return Response.json({ user: { id: currentOwner }, permission: "read" })
      default:
        throw new Error(`Unexpected request: ${path}`)
    }
  })
  await expect(directory.canRead(42n, "old-login", 501)).resolves.toBe(true)
  currentOwner = 502
  await expect(directory.canRead(42n, "old-login", 501)).resolves.toBe(false)
})
