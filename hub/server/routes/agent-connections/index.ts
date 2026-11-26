import express from "express"
import type { Request, RequestHandler, Response } from "express"
import type { Logger } from "pino"

import { createAgentConnections } from "../../domains/agent-connections/create-agent-connections/index.ts"
import type { AgentConnections } from "../../domains/agent-connections/create-agent-connections/index.ts"
import { createLearningMcpBackend } from "../../domains/agent-connections/create-learning-mcp-backend/index.ts"
import {
  createCanvasAuthorization,
  type GetCanvasRepositoryPermission,
} from "../../domains/canvas/authorization/index.ts"
import { canvasDigest } from "../../domains/canvas/credentials/index.ts"
import { hubSessionCookieName } from "../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../integrations/express/read-cookie/index.ts"
import { requireOrigin } from "../../integrations/express/require-origin/index.ts"
import { GitHubProviderRequestError } from "../../integrations/github/errors.ts"
import { loadLearningMcp } from "../../integrations/learning/load-learning-mcp/index.ts"
import { createAgentAuthRouter } from "../../integrations/mcp/create-agent-auth-router/index.ts"
import { handleMcpRequest } from "../../integrations/mcp/handle-mcp-request/index.ts"
import { requireAgentToken } from "../../integrations/mcp/require-agent-token/index.ts"
import { withLearningExecutionLock } from "../../integrations/postgres/with-learning-execution-lock/index.ts"
import { findAgentRepository } from "../../repositories/agent-connections/find-agent-repository/index.ts"
import type { AgentConnectionRouteDependencies } from "./types.ts"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function status(response: Response, code: number, error: string) {
  response.status(code).json({ error })
}

/**
 * Lets people connect coding agents to Hub and lets those agents read a repository's
 * learnings over MCP. People approve and manage connections with their Hub sign-in;
 * agents use OAuth tokens that act for the person who approved them.
 */
export function agentConnectionRoutes(
  dependencies: AgentConnectionRouteDependencies,
  getRepositoryPermission?: GetCanvasRepositoryPermission,
  logger?: Logger,
) {
  const { applicationOrigin, databaseUrl, learning } = dependencies
  const router = express.Router()
  const browserMutation = requireOrigin(applicationOrigin)

  let services: Promise<{
    connections: AgentConnections
    authority: ReturnType<typeof createCanvasAuthorization>
    prisma: Parameters<typeof findAgentRepository>[0]
  }> | null = null
  function load() {
    services ??= import("../../integrations/prisma/index.ts").then(({ prisma }) => ({
      prisma,
      connections: createAgentConnections(prisma),
      authority: createCanvasAuthorization(prisma, getRepositoryPermission),
    }))
    return services
  }

  // The SDK's router needs the service before any request, so each call loads it lazily.
  const service: Parameters<typeof createAgentAuthRouter>[1] = {
    registerClient: async (client) => (await load()).connections.registerClient(client),
    getClient: async (id) => (await load()).connections.getClient(id),
    startAuthorization: async (input) => (await load()).connections.startAuthorization(input),
    challenge: async (clientId, code) => (await load()).connections.challenge(clientId, code),
    exchangeCode: async (clientId, code, redirectUri) =>
      (await load()).connections.exchangeCode(clientId, code, redirectUri),
    refresh: async (clientId, token) => (await load()).connections.refresh(clientId, token),
    verify: async (token) => (await load()).connections.verify(token),
    revokeToken: async (clientId, token) => (await load()).connections.revokeToken(clientId, token),
  }

  function handler(
    handle: (request: Request, response: Response) => Promise<void>,
  ): RequestHandler {
    return async (request, response, next) => {
      try {
        await handle(request, response)
      } catch (error) {
        if (error instanceof GitHubProviderRequestError) {
          status(response, 503, "Repository access could not be verified. Try again.")
          return
        }
        next(error)
      }
    }
  }

  async function browser(request: Request) {
    const cookie = readCookie(request, hubSessionCookieName)
    return cookie ? (await load()).authority.browser(canvasDigest(cookie)) : null
  }

  function decision(approve: boolean) {
    return handler(async (request, response) => {
      const id = String(request.params.authorizationId)
      const session = await browser(request)
      if (!session) return status(response, 401, "Sign in to continue.")
      // The page names the account it loaded with. If another tab switched accounts since,
      // the person has not seen who they would be granting access as.
      const shown = (request.body as { session?: unknown } | undefined)?.session
      if (shown !== session.sessionId)
        return status(response, 409, "You switched accounts. Review this request again.")
      const redirectUrl = uuidPattern.test(id)
        ? await (await load()).connections.decideAuthorization(id, session, approve)
        : null
      if (!redirectUrl)
        return status(response, 410, "This request expired. Connect again from your agent.")
      response.json({ redirectUrl })
    })
  }

  router.use(createAgentAuthRouter(applicationOrigin, service))

  router.get(
    "/api/agent-connections/authorizations/:authorizationId",
    handler(async (request, response) => {
      const id = String(request.params.authorizationId)
      const session = await browser(request)
      if (!session) return status(response, 401, "Sign in to continue.")
      const pending = uuidPattern.test(id)
        ? await (await load()).connections.readAuthorization(id)
        : null
      if (!pending)
        return status(response, 410, "This request expired. Connect again from your agent.")
      response.json({
        agent: pending.clientName,
        redirectUri: pending.redirectUri,
        session: session.sessionId,
        signedInAs: session.viewer.login,
        expiresAt: pending.expiresAt.toISOString(),
      })
    }),
  )
  router.post(
    "/api/agent-connections/authorizations/:authorizationId/approve",
    browserMutation,
    decision(true),
  )
  router.post(
    "/api/agent-connections/authorizations/:authorizationId/cancel",
    browserMutation,
    decision(false),
  )
  router.get(
    "/api/agent-connections",
    handler(async (request, response) => {
      const session = await browser(request)
      if (!session) return status(response, 401, "Sign in to continue.")
      const connections = await (await load()).connections.list(session)
      response.json({
        connections: connections.map((connection) => ({
          id: connection.id,
          agent: connection.client.name,
          createdAt: connection.createdAt.toISOString(),
          lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
          inactiveAt: connection.inactiveAt.toISOString(),
        })),
      })
    }),
  )
  router.delete(
    "/api/agent-connections/:connectionId",
    browserMutation,
    handler(async (request, response) => {
      const session = await browser(request)
      if (!session) return status(response, 401, "Sign in to continue.")
      const id = String(request.params.connectionId)
      const revoked =
        uuidPattern.test(id) && (await (await load()).connections.revokeBrowser(id, session))
      if (!revoked) return status(response, 404, "Agent connection was not found.")
      response.status(204).end()
    }),
  )

  const mcpPath = "/mcp/repositories/:repositoryId"
  router.post(
    mcpPath,
    requireAgentToken(applicationOrigin, service),
    handler(async (request, response) => {
      const id = String(request.params.repositoryId)
      const { prisma, authority } = await load()
      const repository = uuidPattern.test(id) ? await findAgentRepository(prisma, id) : null
      if (!repository?.githubRepositoryId) return status(response, 404, "Repository not found.")
      const { result } = request.auth!.extra as {
        result: NonNullable<Awaited<ReturnType<AgentConnections["verify"]>>>
      }
      if ((await authority.permission(result.viewer, repository)) === "none")
        return status(response, 403, "Repository access was denied.")
      const mcp = await loadLearningMcp(learning.cliPath)
      const token = request.auth!.token
      const backend = createLearningMcpBackend({
        async confirmAccess() {
          const current = await (await load()).connections.verify(token)
          const stillListed = current && (await findAgentRepository(prisma, repository.id))
          return Boolean(
            stillListed && (await authority.permission(current.viewer, stillListed)) !== "none",
          )
        },
        connectionId: result.connection.id,
        learning,
        learningsUrl: new URL(`/repositories/${repository.id}/learnings`, applicationOrigin).href,
        repository: { id: repository.id, githubRepositoryId: repository.githubRepositoryId },
        async serialize(operation) {
          try {
            return await withLearningExecutionLock({
              databaseUrl,
              protectSessionAuthority: true,
              run: operation,
            })
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === "Another learning operation is still running."
            )
              throw new mcp.LearningError(
                "busy",
                "Hub is busy with other learning work. Try again in a minute.",
              )
            throw error
          }
        },
        toAgentError: (code, message) => new mcp.LearningError(code, message),
      })
      const server = mcp.createLearningMcpServer(backend, {
        name: "replica-hub-learning",
        onError: (error) => logger?.error({ err: error }, "Agent learning tool failed"),
      })
      await handleMcpRequest(server, request, response)
    }),
  )
  router.all(mcpPath, (_request, response) => {
    response.set("Allow", "POST")
    status(response, 405, "Send MCP messages with POST.")
  })

  return router
}
