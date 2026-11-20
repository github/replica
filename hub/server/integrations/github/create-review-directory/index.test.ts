import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { GitHubProviderRequestError } from "../errors"

import { createReviewDirectory } from "."

it("uses the immutable repository ID when checking a collaborator after a rename", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const request = vi.fn<typeof fetch>((input, options) => {
    const url = new URL(input instanceof Request ? input.url : input)
    switch (url.pathname) {
      case "/app/installations/17/access_tokens": {
        expect(options?.body).toBe(JSON.stringify({ repository_ids: [42] }))
        return Promise.resolve(
          Response.json({
            token: "synthetic",
            expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          }),
        )
      }
      case "/repositories/42":
        return Promise.resolve(Response.json({ id: 42, full_name: "sandbox/renamed" }))
      case "/user/501":
        return Promise.resolve(Response.json({ id: 501, login: "reviewer" }))
      case "/repos/sandbox/renamed/collaborators/reviewer/permission":
        return Promise.resolve(Response.json({ user: { id: 501 }, permission: "read" }))
      default:
        throw new Error("Unexpected request")
    }
  })
  const directory = createReviewDirectory(
    { appId: "16", installationId: "17", privateKey },
    request,
  )
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
