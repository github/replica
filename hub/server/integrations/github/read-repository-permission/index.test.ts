import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { GitHubProviderRequestError } from "../errors"

import { readRepositoryPermission } from "."

describe("readRepositoryPermission()", () => {
  it.each(["reviewer", `${"r".repeat(34)}_corp`])(
    "checks repository and branch eligibility for account %s",
    async (login) => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: "synthetic" }))
        .mockResolvedValueOnce(Response.json({ id: 42, full_name: "sandbox/renamed" }))
        .mockResolvedValueOnce(Response.json({ user: { id: 501 }, permission: "write" }))
        .mockResolvedValueOnce(Response.json({ name: "prototype/managed-review" }))

      await expect(
        readRepositoryPermission(
          {
            credentials: { appId: "16", installationId: "17", privateKey },
            githubRepositoryId: 42n,
            login,
            subject: "501",
            branchName: "prototype/managed-review",
          },
          request,
        ),
      ).resolves.toBe("write")
      expect(
        request.mock.calls.map(
          ([input]) => new URL(input instanceof Request ? input.url : input).pathname,
        ),
      ).toEqual([
        "/app/installations/17/access_tokens",
        "/repositories/42",
        `/repos/sandbox/renamed/collaborators/${login}/permission`,
        "/repos/sandbox/renamed/branches/prototype%2Fmanaged-review",
      ])
      expect(request.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ repository_ids: [42] }))
    },
  )

  it.each([
    { reason: "repository", repositoryId: 99, userId: 501 },
    { reason: "user", repositoryId: 42, userId: 502 },
  ])(
    "denies a managed account when the numeric $reason identity differs",
    async ({ repositoryId, userId }) => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: "synthetic" }))
        .mockResolvedValueOnce(Response.json({ id: repositoryId, full_name: "sandbox/private" }))
        .mockResolvedValueOnce(Response.json({ user: { id: userId }, permission: "admin" }))

      await expect(
        readRepositoryPermission(
          {
            credentials: { appId: "16", installationId: "17", privateKey },
            githubRepositoryId: 42n,
            login: "reviewer_enterprise",
            subject: "501",
          },
          request,
        ),
      ).resolves.toBeNull()
    },
  )

  it("reports unavailable managed-account permission checks instead of a missing identity", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "synthetic" }))
      .mockResolvedValueOnce(Response.json({ id: 42, full_name: "sandbox/private" }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))

    await expect(
      readRepositoryPermission(
        {
          credentials: { appId: "16", installationId: "17", privateKey },
          githubRepositoryId: 42n,
          login: "reviewer_enterprise",
          subject: "501",
        },
        request,
      ),
    ).rejects.toBeInstanceOf(GitHubProviderRequestError)
  })
})
