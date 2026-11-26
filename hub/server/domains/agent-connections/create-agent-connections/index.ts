import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { claimAgentAuthorization } from "../../../repositories/agent-authorizations/claim-agent-authorization/index.ts"
import { createAgentAuthorization } from "../../../repositories/agent-authorizations/create-agent-authorization/index.ts"
import { decideAgentAuthorization } from "../../../repositories/agent-authorizations/decide-agent-authorization/index.ts"
import { findAgentAuthorizationChallenge } from "../../../repositories/agent-authorizations/find-agent-authorization-challenge/index.ts"
import { findPendingAgentAuthorization } from "../../../repositories/agent-authorizations/find-pending-agent-authorization/index.ts"
import { createAgentClient } from "../../../repositories/agent-clients/create-agent-client/index.ts"
import { findAgentClient } from "../../../repositories/agent-clients/find-agent-client/index.ts"
import { createAgentConnection } from "../../../repositories/agent-connections/create-agent-connection/index.ts"
import { listAgentConnections } from "../../../repositories/agent-connections/list-agent-connections/index.ts"
import { recordAgentConnectionAudit } from "../../../repositories/agent-connections/record-agent-connection-audit/index.ts"
import { revokeAgentConnection } from "../../../repositories/agent-connections/revoke-agent-connection/index.ts"
import { rotateAgentConnection } from "../../../repositories/agent-connections/rotate-agent-connection/index.ts"
import { touchAgentConnection } from "../../../repositories/agent-connections/touch-agent-connection/index.ts"
import {
  canvasAuthorityReference,
  readCanvasAuthority,
} from "../../../repositories/canvas/authority/index.ts"
import type { CanvasBrowser } from "../../canvas/authorization/index.ts"
import {
  accessLifetime,
  canvasDigest,
  canvasSecret,
  inactiveLifetime,
  pairingLifetime,
} from "../../canvas/credentials/index.ts"

const accessPattern = /^ra_[A-Za-z0-9_-]{43}$/
const refreshPattern = /^rar_[A-Za-z0-9_-]{43}$/
const codePattern = /^rac_[A-Za-z0-9_-]{43}$/

function issueTokens() {
  const accessToken = canvasSecret("ra_")
  const refreshToken = canvasSecret("rar_")
  const now = Date.now()
  return {
    accessToken,
    refreshToken,
    tokenDigest: canvasDigest(accessToken),
    refreshDigest: canvasDigest(refreshToken),
    expiresAt: new Date(now + accessLifetime),
    inactiveAt: new Date(now + inactiveLifetime),
  }
}

function tokenResponse(tokens: ReturnType<typeof issueTokens>) {
  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(accessLifetime / 1000),
    refresh_token: tokens.refreshToken,
  }
}

/**
 * Lets a person connect a coding agent to Hub with OAuth. A connection acts for the person
 * who approved it, so every use rechecks that their Hub sign-in still holds. Only digests
 * of codes and tokens are stored.
 */
export function createAgentConnections(database: PrismaClient) {
  return {
    async registerClient(client: { id: string; name: string; redirectUris: string[] }) {
      return createAgentClient(database, client)
    },

    getClient(id: string) {
      return findAgentClient(database, id)
    },

    async startAuthorization(input: {
      clientId: string
      redirectUri: string
      codeChallenge: string
      state?: string
    }) {
      const { id } = await createAgentAuthorization(database, {
        ...input,
        expiresAt: new Date(Date.now() + pairingLifetime),
      })
      return id
    },

    async readAuthorization(id: string) {
      const pending = await findPendingAgentAuthorization(database, id)
      return (
        pending && {
          clientName: pending.client.name,
          expiresAt: pending.expiresAt,
          redirectUri: pending.redirectUri,
        }
      )
    },

    async decideAuthorization(id: string, browser: CanvasBrowser, approve: boolean) {
      const pending = await findPendingAgentAuthorization(database, id)
      if (!pending) return null
      const redirect = new URL(pending.redirectUri)
      const code = canvasSecret("rac_")
      const decided = await database.$transaction(async (transaction) => {
        const settled = await decideAgentAuthorization(
          transaction,
          id,
          approve ? { sessionId: browser.sessionId, codeDigest: canvasDigest(code) } : null,
        )
        if (settled && approve) {
          await recordAgentConnectionAudit(transaction, {
            action: "agent_connection.approve",
            actorMembershipId: browser.viewer.membershipId,
            authorizationId: id,
          })
        }
        return settled
      })
      if (!decided) return null
      if (approve) redirect.searchParams.set("code", code)
      else redirect.searchParams.set("error", "access_denied")
      if (pending.state !== null) redirect.searchParams.set("state", pending.state)
      return redirect.toString()
    },

    async challenge(clientId: string, code: string) {
      if (!codePattern.test(code)) return null
      const found = await findAgentAuthorizationChallenge(database, clientId, canvasDigest(code))
      return found?.codeChallenge ?? null
    },

    async exchangeCode(clientId: string, code: string, redirectUri?: string) {
      if (!codePattern.test(code)) return null
      return database.$transaction(async (transaction) => {
        const claimed = await claimAgentAuthorization(transaction, clientId, canvasDigest(code))
        const session = claimed?.session
        if (!claimed || !session || (redirectUri && redirectUri !== claimed.redirectUri))
          return null
        if (session.endedAt || session.expiresAt <= new Date()) return null
        const reference = canvasAuthorityReference(session)
        const viewer = reference && (await readCanvasAuthority(transaction, reference))
        if (!viewer) return null
        const tokens = issueTokens()
        await createAgentConnection(transaction, {
          clientId,
          membershipId: viewer.membershipId,
          externalIdentityId: viewer.externalIdentityId,
          providerRevisionId: viewer.providerRevisionId,
          revocationRevision: viewer.revocationRevision,
          tokenDigest: tokens.tokenDigest,
          refreshDigest: tokens.refreshDigest,
          expiresAt: tokens.expiresAt,
          inactiveAt: tokens.inactiveAt,
        })
        return tokenResponse(tokens)
      })
    },

    async refresh(clientId: string, refreshToken: string) {
      if (!refreshPattern.test(refreshToken)) return null
      const tokens = issueTokens()
      return database.$transaction(async (transaction) => {
        const connection = await rotateAgentConnection(transaction, {
          clientId,
          refreshDigest: canvasDigest(refreshToken),
          tokenDigest: tokens.tokenDigest,
          nextRefreshDigest: tokens.refreshDigest,
          expiresAt: tokens.expiresAt,
          inactiveAt: tokens.inactiveAt,
        })
        const reference = connection && canvasAuthorityReference(connection)
        const viewer = reference && (await readCanvasAuthority(transaction, reference))
        if (!viewer) return null
        return tokenResponse(tokens)
      })
    },

    /** Returns who the token acts for, or null when it or their Hub access has ended. */
    async verify(accessToken: string) {
      if (!accessPattern.test(accessToken)) return null
      const connection = await touchAgentConnection(
        database,
        canvasDigest(accessToken),
        new Date(Date.now() + inactiveLifetime),
      )
      const reference = connection && canvasAuthorityReference(connection)
      const viewer = reference && (await readCanvasAuthority(database, reference))
      return connection && viewer ? { connection, viewer } : null
    },

    async revokeToken(clientId: string, token: string) {
      if (accessPattern.test(token))
        await revokeAgentConnection(database, { clientId, tokenDigest: canvasDigest(token) })
      else if (refreshPattern.test(token))
        await revokeAgentConnection(database, { clientId, refreshDigest: canvasDigest(token) })
    },

    list(browser: CanvasBrowser) {
      const { membershipId, externalIdentityId } = browser.viewer
      return listAgentConnections(database, { membershipId, externalIdentityId })
    },

    revokeBrowser(id: string, browser: CanvasBrowser) {
      const { membershipId, externalIdentityId } = browser.viewer
      return database.$transaction(async (transaction) => {
        const revoked = await revokeAgentConnection(transaction, {
          id,
          membershipId,
          externalIdentityId,
        })
        if (!revoked) return false
        await recordAgentConnectionAudit(transaction, {
          action: "agent_connection.revoke",
          actorMembershipId: membershipId,
          connectionId: revoked.id,
        })
        return true
      })
    },
  }
}

export type AgentConnections = ReturnType<typeof createAgentConnections>
export type AgentViewer = NonNullable<Awaited<ReturnType<AgentConnections["verify"]>>>["viewer"]
