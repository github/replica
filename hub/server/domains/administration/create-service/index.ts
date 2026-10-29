import { z } from "zod"

import type {
  AdministrationDependencies,
  AdministrationService,
} from "#server/domains/administration/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import type { IdentityRecords } from "#server/domains/identity/create-store/types"
import { ensureProductAdministrationContinuity } from "#server/domains/prototype-authorization/ensure-administration-continuity"
import { AuthenticationError } from "#server/utils/authentication-error"

const invitationSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  issuer: z.url().max(500),
  subject: z.string().trim().min(1).max(500),
  role: z.enum(["member", "administrator"]),
})

const membershipChangeSchema = z
  .object({
    role: z.enum(["member", "administrator"]).optional(),
    status: z.enum(["active", "suspended", "removed"]).optional(),
  })
  .refine(({ role, status }) => role !== undefined || status !== undefined)

const idSchema = z.uuid()
const cursorSchema = z.object({
  memberships: z.uuid().nullable().optional(),
  invitations: z.uuid().nullable().optional(),
})

type CurrentSession = Awaited<ReturnType<typeof getCurrentSession>>

interface DenialAudit {
  event: string
}

async function getAdministrationSession(
  dependencies: AdministrationDependencies,
  sessionToken: string,
) {
  return dependencies.store.lock(async (records) => {
    return getCurrentSession(
      {
        store: dependencies.store,
        github: null,
        configuration: null,
        providerRevisionId: null,
        admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve(false) },
        now: dependencies.now,
      },
      sessionToken,
      records,
    )
  })
}

function requireAdministrator(
  dependencies: AdministrationDependencies,
  current: CurrentSession,
  fresh = true,
) {
  if (current.membership.role !== "administrator") {
    throw new AuthenticationError(
      403,
      "administrator_required",
      "Administrator access is required.",
    )
  }
  const freshnessAge = current.freshAuthorizedAt
    ? dependencies.now().getTime() - current.freshAuthorizedAt.getTime()
    : null
  if (fresh && (freshnessAge === null || freshnessAge < 0 || freshnessAge >= 5 * 60_000)) {
    throw new AuthenticationError(
      403,
      "fresh_authorization_required",
      "Verify your identity again.",
    )
  }
}

async function getLockedAdministrator(
  dependencies: AdministrationDependencies,
  sessionToken: string,
  records: IdentityRecords,
) {
  const current = await getCurrentSession(
    {
      store: dependencies.store,
      github: null,
      configuration: null,
      providerRevisionId: null,
      admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve(false) },
      now: dependencies.now,
    },
    sessionToken,
    records,
  )
  requireAdministrator(dependencies, current)
  return current
}

async function runAuditedMutation<T>(
  dependencies: AdministrationDependencies,
  sessionToken: string,
  audit: DenialAudit,
  operation: () => Promise<T>,
): Promise<T> {
  let current: CurrentSession | null = null
  try {
    current = await getAdministrationSession(dependencies, sessionToken)
    requireAdministrator(dependencies, current)
    return await operation()
  } catch (error) {
    if (current && error instanceof AuthenticationError) {
      const deniedBy = current
      await dependencies.store.lock((records) =>
        records.audit({
          event: audit.event,
          outcome: "denied",
          actorUserId: deniedBy.userId,
          sessionId: deniedBy.id,
          authenticationProviderRevisionId: deniedBy.authenticationProviderRevisionId,
          context: { reason: error.code },
        }),
      )
    }
    throw error
  }
}

export function createAdministrationService(
  options: Omit<AdministrationDependencies, "now"> & { now?: () => Date },
): AdministrationService {
  const dependencies: AdministrationDependencies = {
    ...options,
    now: options.now ?? (() => new Date()),
  }

  return {
    async list(sessionToken, cursors = {}) {
      const parsedCursors = cursorSchema.safeParse(cursors)
      if (!parsedCursors.success) {
        throw new AuthenticationError(
          422,
          "invalid_administration_cursor",
          "The administration cursor is invalid.",
        )
      }
      const current = await getAdministrationSession(dependencies, sessionToken)
      requireAdministrator(dependencies, current, false)
      const [memberships, invitations] = await Promise.all([
        dependencies.store.read.memberships(parsedCursors.data.memberships),
        dependencies.store.read.invitations(parsedCursors.data.invitations),
      ])
      return { memberships, invitations }
    },

    async invite(sessionToken, input) {
      return runAuditedMutation(
        dependencies,
        sessionToken,
        { event: "membership.invitation.create" },
        async () => {
          const parsed = invitationSchema.safeParse(input)
          if (!parsed.success) {
            throw new AuthenticationError(422, "invalid_invitation", "The invitation is invalid.")
          }
          return dependencies.store.lock(async (records) => {
            const actor = await getLockedAdministrator(dependencies, sessionToken, records)
            const now = dependencies.now()
            await records.revokeExpiredInvitations(now)
            const identity = await records.externalIdentity(
              parsed.data.provider,
              parsed.data.issuer,
              parsed.data.subject,
            )
            const membership = identity ? await records.membership(identity.userId) : null
            if (membership && membership.status !== "removed") {
              throw new AuthenticationError(
                409,
                "identity_already_assigned",
                "This identity already has a membership.",
              )
            }
            const existing = await records.usableInvitation(
              parsed.data.provider,
              parsed.data.issuer,
              parsed.data.subject,
              now,
            )
            if (existing) {
              throw new AuthenticationError(
                409,
                "invitation_exists",
                "An invitation already exists.",
              )
            }
            const invitation = await records.createInvitation({
              ...parsed.data,
              createdByUserId: actor.userId,
              expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
            })
            await records.audit({
              event: "membership.invitation.create",
              outcome: "succeeded",
              actorUserId: actor.userId,
              sessionId: actor.id,
              authenticationProviderRevisionId: actor.authenticationProviderRevisionId,
              invitationId: invitation.id,
            })
            return invitation
          })
        },
      )
    },

    async revokeInvitation(sessionToken, invitationId) {
      const parsedId = idSchema.safeParse(invitationId)
      await runAuditedMutation(
        dependencies,
        sessionToken,
        { event: "membership.invitation.revoke" },
        async () => {
          if (!parsedId.success) {
            throw new AuthenticationError(
              409,
              "invitation_changed",
              "The invitation is no longer available.",
            )
          }
          await dependencies.store.lock(async (records) => {
            const actor = await getLockedAdministrator(dependencies, sessionToken, records)
            if (!(await records.revokeInvitation(parsedId.data, dependencies.now()))) {
              throw new AuthenticationError(
                409,
                "invitation_changed",
                "The invitation is no longer available.",
              )
            }
            await records.audit({
              event: "membership.invitation.revoke",
              outcome: "succeeded",
              actorUserId: actor.userId,
              sessionId: actor.id,
              authenticationProviderRevisionId: actor.authenticationProviderRevisionId,
              invitationId: parsedId.data,
            })
          })
        },
      )
    },

    async changeMembership(sessionToken, membershipId, input) {
      const parsedId = idSchema.safeParse(membershipId)
      return runAuditedMutation(
        dependencies,
        sessionToken,
        { event: "membership.change" },
        async () => {
          const parsed = membershipChangeSchema.safeParse(input)
          if (!parsed.success) {
            throw new AuthenticationError(
              422,
              "invalid_membership_change",
              "The membership change is invalid.",
            )
          }
          if (!parsedId.success) {
            throw new AuthenticationError(
              404,
              "membership_not_found",
              "The membership was not found.",
            )
          }
          return dependencies.store.lock(async (records, database) => {
            const actor = await getLockedAdministrator(dependencies, sessionToken, records)
            const target = await records.membershipById(parsedId.data)
            if (!target) {
              throw new AuthenticationError(
                404,
                "membership_not_found",
                "The membership was not found.",
              )
            }
            if (target.status === "removed") {
              throw new AuthenticationError(
                409,
                "membership_removed",
                "Removed memberships require a new invitation.",
              )
            }
            const nextRole = parsed.data.role ?? target.role
            const nextStatus = parsed.data.status ?? target.status
            if (nextRole === target.role && nextStatus === target.status) {
              throw new AuthenticationError(
                409,
                "membership_unchanged",
                "The membership already has this role and status.",
              )
            }
            const removesAdministrator =
              target.status === "active" &&
              target.role === "administrator" &&
              (nextStatus !== "active" || nextRole !== "administrator")
            if (removesAdministrator && (await records.activeAdministratorCount()) <= 1) {
              throw new AuthenticationError(
                409,
                "last_administrator",
                "The final active administrator cannot be changed.",
              )
            }
            if (target.status === "active" && nextStatus !== "active") {
              await ensureProductAdministrationContinuity(database, target.userId)
            }
            const now = dependencies.now()
            const changed = await records.saveMembership({
              userId: target.userId,
              role: nextRole,
              status: nextStatus,
              source: target.source,
              suspendedAt:
                nextStatus === "suspended"
                  ? target.status === "suspended"
                    ? target.suspendedAt
                    : now
                  : null,
              removedAt: nextStatus === "removed" ? now : null,
            })
            if (nextStatus !== "active") {
              await records.deleteUserSessions(target.userId)
            }
            const reasons = [
              nextRole !== target.role ? `role_${nextRole}` : null,
              nextStatus !== target.status ? `status_${nextStatus}` : null,
            ].filter((reason): reason is string => reason !== null)
            for (const reason of reasons) {
              await records.audit({
                event: "membership.change",
                outcome: "succeeded",
                actorUserId: actor.userId,
                sessionId: actor.id,
                authenticationProviderRevisionId: actor.authenticationProviderRevisionId,
                targetMembershipId: target.id,
                context: { reason },
              })
            }
            return changed
          })
        },
      )
    },
  }
}
