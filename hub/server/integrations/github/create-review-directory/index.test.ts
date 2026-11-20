import { generateKeyPairSync } from "node:crypto"
import { expect, it, vi } from "vitest"

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
