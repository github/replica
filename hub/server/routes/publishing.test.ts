import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { describe, expect, it, onTestFinished, vi } from "vitest"
import type { Mocked } from "vitest"

import { maximumPublishingJsonBytes } from "#server/domains/artifact-publishing/create-service/constants"
import type { ArtifactPublishingService } from "#server/domains/artifact-publishing/create-service/types"
import type { AdministrationService } from "#server/domains/administration/create-service/types"
import type { AuthenticationService } from "#server/domains/authentication/create-service/types"
import type { PrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service/types"
import { createLogger } from "#server/integrations/pino/create-logger"
import type { AuthenticationRoutes } from "#server/routes/types"

import { createApp } from "../create-app/index.ts"

function runtime(
  overrides: Partial<Mocked<ArtifactPublishingService>> = {},
): AuthenticationRoutes & { artifactPublishing: Mocked<ArtifactPublishingService> } {
  const artifactPublishing = Object.assign(
    {
      publish: vi.fn(),
      getStatus: vi.fn(),
      promote: vi.fn(),
    },
    overrides,
  ) as Mocked<ArtifactPublishingService>
  return {
    service: {} as Mocked<AuthenticationService>,
    administration: {} as Mocked<AdministrationService>,
    prototypeAuthorization: {} as Mocked<PrototypeAuthorizationService>,
    artifactPublishing,
    settings: {
      origin: "https://hub.example",
      secureCookies: true,
      configured: true,
      admissionPolicy: "hub-managed",
      trustedProxyHops: 0,
    },
  }
}

async function serve(authentication: AuthenticationRoutes, logger = createLogger()) {
  const server = createServer(createApp({ authentication, logger }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

describe("publishing routes", () => {
  it("passes workload authorization and idempotency to publication without browser state", async () => {
    const publish = vi.fn().mockResolvedValue({
      version: { id: "version-id" },
      replayed: false,
      promotedChannel: null,
    })
    const authentication = runtime({
      publish,
    })
    const baseUrl = await serve(authentication)
    const body = {
      manifest: { schemaVersion: 1 },
      artifactBase64: "cHJpdmF0ZS1hcnRpZmFjdA==",
    }

    const response = await fetch(`${baseUrl}/api/publishing/prototypes/prototype-id/versions`, {
      method: "POST",
      headers: {
        authorization: "Bearer workload-token",
        "content-type": "application/json",
        "idempotency-key": "request-key",
      },
      body: JSON.stringify(body),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      version: { id: "version-id" },
      replayed: false,
      promotedChannel: null,
    })
    expect(publish).toHaveBeenCalledWith(
      "Bearer workload-token",
      "prototype-id",
      "request-key",
      body,
    )
  })

  it("returns 200 for an idempotent publication replay", async () => {
    const authentication = runtime({
      publish: vi.fn().mockResolvedValue({
        version: { id: "same-version" },
        replayed: true,
        promotedChannel: "preview",
      }),
    })
    const baseUrl = await serve(authentication)

    const response = await fetch(`${baseUrl}/api/publishing/prototypes/prototype-id/versions`, {
      method: "POST",
      headers: {
        authorization: "Bearer workload-token",
        "content-type": "application/json",
        "idempotency-key": "retry-key",
      },
      body: JSON.stringify({ manifest: {}, artifactBase64: "" }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      version: { id: "same-version" },
      replayed: true,
    })
  })

  it("routes status reads and channel promotion through workload credentials", async () => {
    const getStatus = vi.fn().mockResolvedValue({ publicationId: "publication-id" })
    const promote = vi.fn().mockResolvedValue({
      name: "current",
      prototypeVersionId: "version-id",
    })
    const authentication = runtime({
      getStatus,
      promote,
    })
    const baseUrl = await serve(authentication)
    const headers = {
      authorization: "Bearer workload-token",
      "idempotency-key": "request-key",
    }

    const status = await fetch(`${baseUrl}/api/publishing/prototypes/prototype-id/status`, {
      headers,
    })
    const promotion = await fetch(
      `${baseUrl}/api/publishing/prototypes/prototype-id/channels/current`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ versionId: "version-id" }),
      },
    )

    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ publicationId: "publication-id" })
    expect(getStatus).toHaveBeenCalledWith("Bearer workload-token", "prototype-id", "request-key")
    expect(promotion.status).toBe(200)
    expect(await promotion.json()).toEqual({
      channel: { name: "current", prototypeVersionId: "version-id" },
    })
    expect(promote).toHaveBeenCalledWith("Bearer workload-token", "prototype-id", "current", {
      versionId: "version-id",
    })
  })

  it("omits workload authorization, query values, and artifact content from request logs", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: {
        write: (line) => records.push(JSON.parse(line) as Record<string, unknown>),
      },
    })
    const authentication = runtime({
      publish: vi.fn().mockResolvedValue({
        version: { id: "version-id" },
        replayed: false,
        promotedChannel: null,
      }),
    })
    const baseUrl = await serve(authentication, logger)

    const response = await fetch(
      `${baseUrl}/api/publishing/prototypes/prototype-id/versions?note=private-query`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer private-workload-token",
          "content-type": "application/json",
          "idempotency-key": "request-key",
        },
        body: JSON.stringify({
          manifest: { provenance: { revision: "private-revision" } },
          artifactBase64: "cHJpdmF0ZS1hcnRpZmFjdC1jb250ZW50",
        }),
      },
    )

    expect(response.status).toBe(201)
    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records[0]).not.toHaveProperty("query")
    expect(records[0]).not.toHaveProperty("body")
    expect(JSON.stringify(records)).not.toMatch(
      /private-workload-token|private-query|private-revision|cHJpdmF0ZS1hcnRpZmFjdC1jb250ZW50/,
    )
  })

  it("rejects a publishing body above its dedicated limit before the service runs", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: {
        write: (line) => records.push(JSON.parse(line) as Record<string, unknown>),
      },
    })
    const publish = vi.fn()
    const authentication = runtime({ publish })
    const baseUrl = await serve(authentication, logger)
    const privateContent = "x".repeat(maximumPublishingJsonBytes)

    const response = await fetch(`${baseUrl}/api/publishing/prototypes/prototype-id/versions`, {
      method: "POST",
      headers: {
        authorization: "Bearer private-workload-token",
        "content-type": "application/json",
        "idempotency-key": "oversized-request",
      },
      body: JSON.stringify({ artifactBase64: privateContent }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "Invalid request" })
    expect(publish).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records[0]).not.toHaveProperty("body")
    expect(JSON.stringify(records)).not.toContain(privateContent.slice(0, 100))
  })

  it("applies publishing rate limits before parsing malformed JSON", async () => {
    const getStatus = vi.fn().mockResolvedValue({ publicationId: null })
    const publish = vi.fn()
    const baseUrl = await serve(
      runtime({ getStatus, publish }),
      createLogger({ destination: { write: () => undefined } }),
    )

    for (let request = 0; request < 60; request++) {
      const response = await fetch(`${baseUrl}/api/publishing/prototypes/prototype-id/status`, {
        headers: { authorization: "******" },
      })
      expect(response.status).toBe(200)
    }
    const rejected = await fetch(`${baseUrl}/api/publishing/prototypes/prototype-id/versions`, {
      method: "POST",
      headers: {
        authorization: "******",
        "content-type": "application/json",
        "idempotency-key": "rate-limited",
      },
      body: "{",
    })

    expect(rejected.status).toBe(429)
    expect(await rejected.json()).toEqual({
      error: "rate_limited",
      message: "Too many publishing requests.",
    })
    expect(getStatus).toHaveBeenCalledTimes(60)
    expect(publish).not.toHaveBeenCalled()
  })

  it("uses the larger JSON limit only for version uploads", async () => {
    const publish = vi.fn().mockResolvedValue({
      version: { id: "version-id" },
      replayed: false,
      promotedChannel: null,
    })
    const promote = vi.fn()
    const baseUrl = await serve(runtime({ publish, promote }))
    const padding = "x".repeat(128 * 1024)

    const upload = await fetch(`${baseUrl}/api/publishing/prototypes/prototype-id/versions`, {
      method: "POST",
      headers: {
        authorization: "******",
        "content-type": "application/json",
        "idempotency-key": "larger-parser",
      },
      body: JSON.stringify({ padding }),
    })
    const promotion = await fetch(
      `${baseUrl}/api/publishing/prototypes/prototype-id/channels/current`,
      {
        method: "PUT",
        headers: {
          authorization: "******",
          "content-type": "application/json",
        },
        body: JSON.stringify({ padding }),
      },
    )

    expect(upload.status).toBe(201)
    expect(publish).toHaveBeenCalledOnce()
    expect(promotion.status).toBe(413)
    expect(promote).not.toHaveBeenCalled()
  })
})
