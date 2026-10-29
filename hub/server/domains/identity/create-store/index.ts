import { createIdentityRecords } from "#server/domains/identity/create-records"
import { withIdentityStoreLock } from "#server/domains/identity/with-store-lock"
import type { IdentityQueries, IdentityStore } from "#server/domains/identity/create-store/types"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function createIdentityStore(client: PrismaClient): IdentityStore {
  const records = createIdentityRecords(client)
  const read: IdentityQueries = {
    githubIntegrationCredentials: () => records.githubIntegrationCredentials(),
    identityStoreState: () => records.identityStoreState(),
    hasFreshGitHubAdmission: (userId, now) => records.hasFreshGitHubAdmission(userId, now),
    user: (id) => records.user(id),
    externalIdentity: (provider, issuer, subject) =>
      records.externalIdentity(provider, issuer, subject),
    membership: (userId) => records.membership(userId),
    memberships: (cursor) => records.memberships(cursor),
    invitations: (cursor) => records.invitations(cursor),
    session: (tokenDigest) => records.session(tokenDigest),
    sessionById: (id) => records.sessionById(id),
    audits: () => records.audits(),
  }
  return {
    read,
    lock: (operation) => withIdentityStoreLock(client, operation),
  }
}
