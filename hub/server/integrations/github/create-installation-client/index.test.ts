import { generateKeyPairSync } from "node:crypto"
import { expect, it, vi } from "vitest"

import { createGitHubInstallationClient, GitHubArtifactDownloadTooLarge } from "."

const credentials = {
  appId: "12",
  installationId: "34",
  privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
}
const path = "/repos/octo/repo/actions/artifacts/23/zip"
const tokenPath = "/app/installations/34/access_tokens"

it("follows a signed Actions redirect without forwarding the installation token", async () => {
  const signedUrl = "https://replicatest.blob.core.windows.net/builds/23?signature=synthetic"
  const request = vi.fn<typeof fetch>((url, init) => {
    const target = new URL(url instanceof Request ? url.url : url)
    const headers = new Headers(init?.headers)
    if (target.pathname === tokenPath) {
      expect(init?.method).toBe("POST")
      return Promise.resolve(Response.json({ token: "fake-installation-token" }))
    }
    if (target.pathname === path) {
      expect(headers.get("authorization")).toBe("Bearer fake-installation-token")
      expect(init?.redirect).toBe("manual")
      return Promise.resolve(Response.redirect(signedUrl, 302))
    }
    expect(target.href).toBe(signedUrl)
    expect(headers.has("authorization")).toBe(false)
    expect(init?.redirect).toBe("error")
    return Promise.resolve(new Response("zip"))
  })

  const client = await createGitHubInstallationClient(credentials, { fetch: request })
  expect((await client.download(path, 10)).toString()).toBe("zip")
  expect(request).toHaveBeenCalledTimes(3)
})

it("does not fetch an arbitrary redirect target", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ token: "fake-installation-token" }))
    .mockResolvedValueOnce(Response.redirect("https://unrelated.invalid/archive", 302))
  const client = await createGitHubInstallationClient(credentials, { fetch: request })
  await expect(client.download(path, 10)).rejects.toThrow()
  expect(request).toHaveBeenCalledTimes(2)
})

it("stops a ZIP body that exceeds its allowance without a Content-Length", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]))
        controller.enqueue(Uint8Array.from([3, 4]))
        controller.close()
      },
    }),
  )
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ token: "fake-installation-token" }))
    .mockResolvedValueOnce(response)
  const client = await createGitHubInstallationClient(credentials, { fetch: request })
  await expect(client.download(path, 3)).rejects.toBeInstanceOf(GitHubArtifactDownloadTooLarge)
})
