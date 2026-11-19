import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished } from "vitest"

import { createApp } from "../../../../../create-app"
import { prisma } from "../../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../../product/create-product-route-dependencies"

function signInCookie(response: Response, name: string) {
  const cookie = response.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`))
    ?.split(";")[0]
  if (!cookie) throw new Error(`Local sign-in did not set ${name}.`)
  return cookie
}

async function signInAsLocalAdministrator() {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )

  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  const authentication = await createAuthenticationRouteDependencies({
    HUB_APPLICATION_ORIGIN: origin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: randomBytes(32).toString("base64url"),
    HUB_LOCAL_SIGN_IN: "true",
  })
  server.on("request", createApp({ authentication, product: createProductRouteDependencies() }))

  const start = await fetch(`${origin}/api/auth/local/start`, {
    method: "POST",
    headers: { origin },
    redirect: "manual",
  })
  const location = start.headers.get("location")
  if (!location) throw new Error("Local sign-in did not redirect.")
  const callbackUrl = new URL(location, origin)
  expect(callbackUrl.origin).toBe(origin)
  const callback = await fetch(callbackUrl, {
    headers: { cookie: signInCookie(start, "hub_auth_browser") },
    redirect: "manual",
  })
  return { origin, headers: { cookie: signInCookie(callback, "hub_session") } }
}

describe("prototype management GET API", () => {
  it("separates eligible drafts and registered prototypes and omits ineligible branches", async () => {
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "trunk",
        localPath: "/prototype-root/checkout",
        nameWithOwner: "local/checkout",
      },
    })
    const repositoryId = repository.id
    const candidate = {
      id: randomUUID(),
      branchName: "feature/address",
      name: "New address form",
      description: "An alternate address form.",
      startPage: "/checkout/address",
    }
    const registered = {
      id: randomUUID(),
      branchName: "feature/payment",
      name: "Payment options",
      description: "A new payment step.",
      startPage: "/checkout/payment",
    }
    const registeredAt = new Date("2026-10-01T00:00:00Z")
    await prisma.prototype.createMany({
      data: [
        { repositoryId, ...candidate },
        { repositoryId, ...registered, registeredAt },
        { repositoryId, branchName: repository.defaultBranch, name: "Default branch" },
        { repositoryId, branchName: "replica/install-workflow", name: "Install workflow" },
        { repositoryId, branchName: "feature/replica", name: "Replica", replica: true },
        {
          repositoryId,
          branchName: "feature/deleted",
          name: "Deleted prototype",
          registeredAt,
          branchDeletedAt: new Date("2026-10-02T00:00:00Z"),
        },
      ],
    })

    const { origin, headers } = await signInAsLocalAdministrator()
    const repositoryUrl = `${origin}/api/repositories/${repositoryId}`
    const response = await fetch(`${repositoryUrl}/prototype-management`, { headers })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      repository: { id: repositoryId },
      registered: [{ ...registered, canEdit: true }],
      candidates: [candidate],
      canManage: true,
    })
  })

  it("returns not found for a non-local repository the local administrator can browse", async () => {
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "trunk",
        githubRepositoryId: 1001,
        nameWithOwner: "team/checkout",
      },
    })
    await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "feature/address",
        name: "New address form",
      },
    })
    const { origin, headers } = await signInAsLocalAdministrator()
    const repositoryUrl = `${origin}/api/repositories/${repository.id}`

    const gallery = await fetch(repositoryUrl, { headers })
    expect(gallery.status).toBe(200)

    const management = await fetch(`${repositoryUrl}/prototype-management`, { headers })
    expect(management.status).toBe(404)
  })
})
