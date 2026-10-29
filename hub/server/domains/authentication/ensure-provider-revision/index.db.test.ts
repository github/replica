import { expect, it, onTestFinished, vi } from "vitest"

import { createIdentityStore } from "#server/domains/identity/create-store"
import { ensureGitHubProviderRevision } from "#server/domains/authentication/ensure-provider-revision"

it("allocates the next revision when an existing GitHub provider is disabled", async () => {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  const store = createIdentityStore(prisma)
  const configuration = {
    clientId: "github-client",
    clientSecret: "github-client-secret-fixture",
    callbackUrl: "https://hub.example/api/auth/github/callback",
    issuer: "https://github.com" as const,
  }
  await store.lock((records) =>
    records.createAuthenticationProviderRevision({
      key: "github",
      type: "github",
      enabled: false,
      revision: 1,
      issuer: configuration.issuer,
      configuration: {},
    }),
  )

  const revision = await ensureGitHubProviderRevision(store, configuration)

  expect(revision).toMatchObject({
    revision: 2,
    authenticationProvider: { enabled: true },
  })
  await expect(
    store.lock((records) => records.currentAuthenticationProviderRevision("github")),
  ).resolves.toMatchObject({ id: revision.id })
})
