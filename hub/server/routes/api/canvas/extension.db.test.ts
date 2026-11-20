import { execFileSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdir, rm } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import { z } from "zod"

import { createHubClient } from "../../../../../.github/extensions/replica-prototype/create-hub-client/index.mjs"
import { createApp } from "../../../create-app"
import { createLogger } from "../../../integrations/pino/create-logger"
import { prisma } from "../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../product/create-product-route-dependencies"

it("pairs and renews the unchanged extension using local sign-in, then stops at browser revocation", async () => {
  const root = fileURLToPath(
    new URL(`../../../../.local/canvas-test-${randomUUID()}/`, import.meta.url),
  )
  const repositoryPath = join(root, ".local", "prototypes", "example")
  const server = createServer()
  await mkdir(repositoryPath, { recursive: true })
  try {
    execFileSync("git", ["init", "--initial-branch=main", "--quiet"], { cwd: repositoryPath })
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Local developer",
        "-c",
        "user.email=local@example.test",
        "commit",
        "--allow-empty",
        "--no-gpg-sign",
        "-m",
        "Synthetic checkout",
        "--quiet",
      ],
      { cwd: repositoryPath },
    )
    execFileSync("git", ["switch", "--create", "prototype/example", "--quiet"], {
      cwd: repositoryPath,
    })
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "local/example", defaultBranch: "main", localPath: repositoryPath },
    })
    await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/example", name: "Example draft" },
    })

    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const authentication = await createAuthenticationRouteDependencies(
      {
        NODE_ENV: "development",
        DATABASE_URL: process.env.DATABASE_URL,
        HUB_LOCAL_SIGN_IN: "true",
        HUB_APPLICATION_ORIGIN: origin,
        HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        HUB_BOOTSTRAP_SECRET: "synthetic-bootstrap-secret-for-canvas-test",
      },
      () => {
        throw new Error("The Canvas test must not reach an outside provider.")
      },
    )
    server.on(
      "request",
      createApp({
        authentication,
        product: createProductRouteDependencies(),
        logger: createLogger({ level: "silent" }),
      }),
    )
    const extension = createHubClient(
      { repositoryPath, target: { repository: "local/example" } },
      { origin, directory: join(root, "canvas-store") },
    )
    const pairing = await extension.pair()
    const returnTo = new URL(pairing.verificationUrl).pathname
    const approvalPath = `/api/canvas/approvals/${pairing.userCode}`
    expect(new URL(pairing.verificationUrl).origin).toBe(origin)
    expect((await fetch(origin + approvalPath)).status).toBe(401)

    const start = await fetch(`${origin}/api/auth/local/start`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: origin },
      body: new URLSearchParams({ return_to: returnTo }),
    })
    expect(start.status).toBe(303)
    const authCookies = start.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";", 1)[0])
      .join("; ")
    const callback = await fetch(new URL(start.headers.get("location")!, origin), {
      redirect: "manual",
      headers: { Cookie: authCookies },
    })
    expect(callback.headers.get("location")).toBe(returnTo)
    const session = callback.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("hub_session="))!
      .split(";", 1)[0]!
    function browser(path: string, method = "GET") {
      return fetch(origin + path, {
        method,
        headers: { Cookie: session, Origin: origin },
      })
    }
    expect((await browser("/api/canvas/pairings", "POST")).status).toBe(403)
    const approval = z
      .object({ code: z.string(), repository: z.string(), expiresAt: z.iso.datetime() })
      .strict()
      .parse(await (await browser(approvalPath)).json())
    expect(approval.code).toBe(pairing.userCode)
    expect(approval.repository).toBe("local/example")
    expect((await browser(approvalPath, "POST")).status).toBe(200)
    expect(await extension.poll()).toEqual({ status: "approved" })
    expect(await extension.status({ register: false })).toMatchObject({
      state: "connected",
      repository: "local/example",
      prototype: { name: "Example draft", viewerLogin: "local-developer", canRegister: false },
    })

    const list = z
      .object({
        connections: z.array(
          z
            .object({
              id: z.number(),
              repository: z.string(),
              expiresAt: z.iso.datetime(),
              inactiveAt: z.iso.datetime(),
            })
            .strict(),
        ),
      })
      .strict()
      .parse(await (await browser("/api/canvas/connections")).json())
    expect(list.connections.map(({ repository }) => repository)).toEqual(["local/example"])
    const id = list.connections[0]!.id
    const original = await prisma.canvasGrant.findUniqueOrThrow({ where: { id } })
    await prisma.canvasGrant.update({ where: { id }, data: { expiresAt: new Date(0) } })
    expect(await extension.status({ register: false })).toMatchObject({ state: "connected" })
    const renewed = await prisma.canvasGrant.findUniqueOrThrow({ where: { id } })
    expect(renewed.tokenDigest).not.toBe(original.tokenDigest)
    expect(renewed.inactiveAt).toEqual(original.inactiveAt)

    expect((await browser(`/api/canvas/connections/${id}`, "DELETE")).status).toBe(204)
    expect(await (await browser("/api/canvas/connections")).json()).toEqual({ connections: [] })
    expect(await extension.status({ register: false })).toMatchObject({ state: "disconnected" })
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
    await rm(root, { force: true, recursive: true })
  }
}, 20_000)
