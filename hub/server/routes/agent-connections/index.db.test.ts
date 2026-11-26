import { createHash, randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { expect, it, vi } from "vitest"

import { createApp } from "../../create-app"
import { createLogger } from "../../integrations/pino/create-logger"
import { prisma } from "../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../api/auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../api/product/create-product-route-dependencies"

it("connects an agent with the person's approval and stops it after they revoke it", async () => {
  const server = createServer()
  try {
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
        HUB_BOOTSTRAP_SECRET: "synthetic-bootstrap-secret-for-agent-test",
      },
      () => {
        throw new Error("The agent connection test must not reach an outside provider.")
      },
    )
    const product = Object.assign(createProductRouteDependencies(), {
      getRepositoryPermission: vi.fn(() => Promise.resolve("admin" as const)),
    })
    const githubRepositoryId = BigInt(Math.floor(Math.random() * 1_000_000_000) + 1)
    const repository = await prisma.repository.create({
      data: {
        nameWithOwner: `octo/agent-${githubRepositoryId}`,
        defaultBranch: "main",
        githubRepositoryId,
      },
    })
    server.on(
      "request",
      createApp({
        authentication,
        product,
        agentConnections: {
          applicationOrigin: origin,
          learning: {
            cliPath: "/missing/cli.mjs",
            nodePath: "node",
            root: "/",
            staticDirectories: [],
          },
        },
        logger: createLogger({ level: "silent" }),
      }),
    )
    const mcpUrl = `${origin}/mcp/repositories/${repository.id}`
    function callMcp(token?: string) {
      return fetch(mcpUrl, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    }

    const unauthenticated = await callMcp()
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get("www-authenticate")).toContain(
      `${origin}/.well-known/oauth-protected-resource/mcp`,
    )

    expect(
      await (await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`)).json(),
    ).toMatchObject({ resource: `${origin}/mcp`, authorization_servers: [`${origin}/`] })

    const redirectUri = "http://127.0.0.1:9/callback"
    const registered = (await (
      await fetch(`${origin}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: "Test agent", redirect_uris: [redirectUri] }),
      })
    ).json()) as { client_id: string; client_secret?: string }
    expect(registered.client_secret).toBeUndefined()

    const verifier = randomBytes(32).toString("base64url")
    const authorize = await fetch(
      `${origin}/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: registered.client_id,
        redirect_uri: redirectUri,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        state: "agent-state",
      })}`,
      { redirect: "manual" },
    )
    const approvalPath = authorize.headers.get("location")!
    expect(approvalPath).toMatch(/^\/agents\/approve\/[0-9a-f-]{36}$/)
    const authorizationId = approvalPath.split("/").at(-1)!
    const authorizationPath = `/api/agent-connections/authorizations/${authorizationId}`
    expect((await fetch(origin + authorizationPath)).status).toBe(401)

    const start = await fetch(`${origin}/api/auth/local/start`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: origin },
      body: new URLSearchParams({ return_to: approvalPath }),
    })
    const callback = await fetch(new URL(start.headers.get("location")!, origin), {
      redirect: "manual",
      headers: {
        Cookie: start.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";", 1)[0])
          .join("; "),
      },
    })
    expect(callback.headers.get("location")).toBe(approvalPath)
    const session = callback.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("hub_session="))!
      .split(";", 1)[0]!
    function browser(path: string, method = "GET") {
      return fetch(origin + path, { method, headers: { Cookie: session, Origin: origin } })
    }
    expect(await (await browser(authorizationPath)).json()).toMatchObject({ agent: "Test agent" })
    const { redirectUrl } = (await (
      await browser(`${authorizationPath}/approve`, "POST")
    ).json()) as { redirectUrl: string }
    const returned = new URL(redirectUrl)
    expect(returned.searchParams.get("state")).toBe("agent-state")
    expect((await browser(`${authorizationPath}/approve`, "POST")).status).toBe(410)

    const tokens = (await (
      await fetch(`${origin}/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: registered.client_id,
          code: returned.searchParams.get("code")!,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        }),
      })
    ).json()) as { access_token: string }

    // Local sign-in cannot read GitHub repositories, so the token works but access stops
    // at the repository check.
    expect((await callMcp(tokens.access_token)).status).toBe(403)

    const listed = (await (await browser("/api/agent-connections")).json()) as {
      connections: { id: string; agent: string }[]
    }
    expect(listed.connections).toEqual([expect.objectContaining({ agent: "Test agent" })])
    const connectionId = listed.connections[0]!.id
    expect((await browser(`/api/agent-connections/${connectionId}`, "DELETE")).status).toBe(204)
    expect((await callMcp(tokens.access_token)).status).toBe(401)
    expect(
      await prisma.securityAudit.count({
        where: { action: { in: ["agent_connection.approve", "agent_connection.revoke"] } },
      }),
    ).toBe(2)
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
}, 20_000)
