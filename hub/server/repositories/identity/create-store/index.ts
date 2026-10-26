import type { PrismaClient, Prisma } from "../../../generated/prisma/client.ts"
import type { IdentityRecords, IdentityStore } from "../../../utils/identity-contracts/types.ts"

const stateId = "00000000-0000-4000-8000-000000000001"

export function createIdentityStore(client: PrismaClient): IdentityStore {
  function records(database: Prisma.TransactionClient): IdentityRecords {
    return {
      state: () => database.identityState.findUniqueOrThrow({ where: { id: stateId } }),
      async saveCredentials(encryptedCredentials) {
        await database.identityState.update({
          where: { id: stateId },
          data: { encryptedCredentials },
        })
      },
      async advanceGeneration() {
        await database.identityState.update({
          where: { id: stateId },
          data: { generation: { increment: 1 } },
        })
        await database.oAuthAttempt.deleteMany()
      },
      user: (id) => database.user.findUnique({ where: { id } }),
      githubUser: (providerId) =>
        database.user.findUnique({
          where: { provider_providerId: { provider: "github", providerId } },
        }),
      saveUser: (profile) =>
        database.user.upsert({
          where: { provider_providerId: { provider: "github", providerId: profile.providerId } },
          create: { ...profile, provider: "github" },
          update: profile,
        }),
      enroll: (id) => database.user.update({ where: { id }, data: { administrator: true } }),
      session: (tokenDigest) =>
        database.session.findUnique({ where: { tokenDigest }, include: { user: true } }),
      sessionById: (id) => database.session.findUnique({ where: { id }, include: { user: true } }),
      createSession: (data) => database.session.create({ data }),
      async verifySession(id, freshAuthorizedAt, credentialRevision) {
        await database.session.update({
          where: { id },
          data: { freshAuthorizedAt, credentialRevision },
        })
      },
      async invalidateFreshness() {
        await database.session.updateMany({ data: { freshAuthorizedAt: null } })
      },
      async deleteSession(id) {
        await database.session.deleteMany({ where: { id } })
        await database.oAuthAttempt.deleteMany({ where: { sessionId: id } })
      },
      async deleteSessions() {
        await database.session.deleteMany()
      },
      async createAttempt(data) {
        await database.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } })
        await database.oAuthAttempt.create({ data })
      },
      async consumeAttempt(stateDigest) {
        const attempt = await database.oAuthAttempt.findUnique({ where: { stateDigest } })
        if (!attempt) return null
        await database.oAuthAttempt.delete({ where: { id: attempt.id } })
        if (
          attempt.purpose !== "sign-in" &&
          attempt.purpose !== "verify" &&
          attempt.purpose !== "enroll"
        ) {
          throw new Error("Stored OAuth purpose is invalid.")
        }
        return { ...attempt, purpose: attempt.purpose }
      },
      async audit(data) {
        await database.securityAudit.deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60_000) } },
        })
        await database.securityAudit.create({ data })
      },
      audits: () =>
        database.securityAudit.findMany({
          where: { createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60_000) } },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
    }
  }

  return {
    read: records(client),
    lock: (operation) =>
      client.$transaction(async (transaction) => {
        await transaction.identityState.upsert({
          where: { id: stateId },
          create: { id: stateId },
          update: {},
        })
        await transaction.$queryRaw`SELECT id FROM identity_states WHERE id = ${stateId}::uuid FOR UPDATE`
        return operation(records(transaction))
      }),
  }
}
