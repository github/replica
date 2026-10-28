import { PrismaPg } from "@prisma/adapter-pg"
import { describe, expect, it, onTestFinished } from "vitest"

import { ensureOidcProviderRevision } from "#server/domains/authentication/ensure-oidc-provider-revision"
import { createIdentityStore } from "#server/domains/identity/create-store"
import type { OidcConfiguration } from "#server/integrations/oidc/create-client/types"

import { PrismaClient } from "../../../generated/prisma/client.ts"

const configuration: OidcConfiguration = {
  issuer: "https://login.microsoftonline.com/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
  clientId: "hub-client",
  clientSecret: "client-secret-fixture",
  clientCredentialReference: "HUB_OIDC_CLIENT_SECRET",
  callbackUrl: "https://hub.example.test/api/auth/oidc/callback",
  scopes: ["openid", "profile", "email"],
  memberRole: "Hub.User",
  administratorRole: "Hub.Administrator",
  membershipPolicy: "invitation-required",
  enabled: true,
  providerRevision: 4,
}

function databaseClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("Set DATABASE_URL before running database tests.")
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

describe("ensureOidcProviderRevision() database behavior", () => {
  it("reuses a JSONB-backed revision after a process restart and scope reordering", async () => {
    const firstClient = databaseClient()
    let restartedClient: PrismaClient | null = null
    onTestFinished(async () => {
      await Promise.allSettled([
        firstClient.$disconnect(),
        ...(restartedClient ? [restartedClient.$disconnect()] : []),
      ])
    })

    const created = await ensureOidcProviderRevision(
      createIdentityStore(firstClient),
      configuration,
    )
    await firstClient.$disconnect()

    restartedClient = databaseClient()
    const restartedConfiguration = {
      ...configuration,
      scopes: ["email", "openid", "profile"],
    }

    await expect(
      ensureOidcProviderRevision(createIdentityStore(restartedClient), restartedConfiguration),
    ).resolves.toMatchObject({
      id: created.id,
      revision: configuration.providerRevision,
    })
    await expect(restartedClient.authenticationProviderRevision.count()).resolves.toBe(1)
  })
})
