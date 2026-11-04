import { randomBytes } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"

import { createAuthenticationRouteDependencies } from "."

vi.mock("../../../../domains/identity/validate-and-persist-provider-revision/index.ts", () => ({
  validateAndPersistProviderRevision: vi.fn(() => Promise.resolve()),
}))
vi.mock("../../../../integrations/prisma/index.ts", () => ({ prisma: {} }))

const githubEnvironment = {
  GITHUB_CLIENT_ID: "github-client-id",
  GITHUB_CLIENT_SECRET: "github-client-secret",
  GITHUB_PROVIDER_REVISION: "1",
  HUB_APPLICATION_ORIGIN: "https://hub.example.test",
  HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
}

describe("createAuthenticationRouteDependencies()", () => {
  it.each([
    "ENTRA_OIDC_CLIENT_AUTHENTICATION",
    "ENTRA_OIDC_CLIENT_ID",
    "ENTRA_OIDC_ISSUER",
    "ENTRA_OIDC_PROVIDER_REVISION",
    "ENTRA_OIDC_CLIENT_SECRET",
    "ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID",
  ] as const)("rejects an incomplete Entra profile containing only %s", async (key) => {
    const error = await createAuthenticationRouteDependencies({
      ...githubEnvironment,
      [key]: "configured",
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ZodError)
    if (!(error instanceof ZodError)) throw error
    expect(
      error.issues.some((issue) =>
        issue.path.some(
          (segment) => typeof segment === "string" && segment.startsWith("ENTRA_OIDC_"),
        ),
      ),
    ).toBe(true)
  })
})
