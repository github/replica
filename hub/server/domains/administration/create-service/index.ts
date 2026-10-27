import { z } from "zod"

import type {
  AdministrationDependencies,
  AdministrationService,
} from "#server/domains/administration/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
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

function requireFreshAdministrator(
  dependencies: AdministrationDependencies,
  sessionToken: string,
  fresh = true,
) {
  return dependencies.store.lock(async (records) => {
    const current = await getCurrentSession(
      {
        store: dependencies.store,
        github: null,
        configuration: null,
        providerRevisionId: null,
        admissionPolicy: { name: "hub-managed", admit: () => Promise.resolve(null) },
        now: dependencies.now,
      },
      sessionToken,
      records,
    )
    if (current.membership.role !== "administrator") {
      throw new AuthenticationError(
        403,
        "administrator_required",
        "Administrator access is required.",
      )
    }
    if (
      fresh &&
      (!current.freshAuthorizedAt ||
        dependencies.now().getTime() - current.freshAuthorizedAt.getTime() >= 5 * 60_000)
    ) {
      throw new AuthenticationError(
        403,
        "fresh_authorization_required",
        "Verify your identity again.",
      )
    }
    return current
  })
}

export function createAdministrationService(
  options: Omit<AdministrationDependencies, "now"> & { now?: () => Date },
): AdministrationService {
  const dependencies: AdministrationDependencies = {
    ...options,
    now: options.now ?? (() => new Date()),
  }

  return {
    async list(sessionToken) {
      await requireFreshAdministrator(dependencies, sessionToken, false)
      const [memberships, invitations] = await Promise.all([
        dependencies.store.read.memberships(),
        dependencies.store.read.invitations(),
      ])
      return { memberships, invitations }
    },

    async invite(sessionToken, input) {
      const parsed = invitationSchema.safeParse(input)
      if (!parsed.success) {
        throw new AuthenticationError(422, "invalid_invitation", "The invitation is invalid.")
      }
      const current = await requireFreshAdministrator(dependencies, sessionToken)
      return dependencies.store.lock(async (records) => {
        const actor = await records.sessionById(current.id)
        const actorMembership = actor ? await records.membership(actor.userId) : null
        if (
          !actor ||
          actorMembership?.status !== "active" ||
          actorMembership.role !== "administrator"
        ) {
          throw new AuthenticationError(
            403,
            "administrator_required",
            "Administrator access is required.",
          )
        }
        await records.revokeExpiredInvitations(dependencies.now())
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
          dependencies.now(),
        )
        if (existing) {
          throw new AuthenticationError(409, "invitation_exists", "An invitation already exists.")
        }
        const invitation = await records.createInvitation({
          ...parsed.data,
          createdByUserId: actor.userId,
          expiresAt: new Date(dependencies.now().getTime() + 7 * 24 * 60 * 60_000),
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

    async revokeInvitation(sessionToken, invitationId) {
      const current = await requireFreshAdministrator(dependencies, sessionToken)
      await dependencies.store.lock(async (records) => {
        const actor = await records.sessionById(current.id)
        const actorMembership = actor ? await records.membership(actor.userId) : null
        if (
          !actor ||
          actorMembership?.status !== "active" ||
          actorMembership.role !== "administrator"
        ) {
          throw new AuthenticationError(
            403,
            "administrator_required",
            "Administrator access is required.",
          )
        }
        if (!(await records.revokeInvitation(invitationId, dependencies.now()))) {
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
          invitationId,
        })
      })
    },

    async changeMembership(sessionToken, membershipId, input) {
      const parsed = membershipChangeSchema.safeParse(input)
      if (!parsed.success) {
        throw new AuthenticationError(
          422,
          "invalid_membership_change",
          "The membership change is invalid.",
        )
      }
      const current = await requireFreshAdministrator(dependencies, sessionToken)
      return dependencies.store.lock(async (records, database) => {
        const actor = await records.sessionById(current.id)
        const actorMembership = actor ? await records.membership(actor.userId) : null
        if (
          !actor ||
          actorMembership?.status !== "active" ||
          actorMembership.role !== "administrator"
        ) {
          throw new AuthenticationError(
            403,
            "administrator_required",
            "Administrator access is required.",
          )
        }
        const target = await records.membershipById(membershipId)
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
        const changed = await records.saveMembership({
          userId: target.userId,
          role: nextRole,
          status: nextStatus,
          source: target.source,
          suspendedAt: nextStatus === "suspended" ? dependencies.now() : null,
          removedAt: nextStatus === "removed" ? dependencies.now() : null,
        })
        if (nextStatus !== "active") {
          await records.deleteUserSessions(target.userId)
        }
        await records.audit({
          event: "membership.change",
          outcome: "succeeded",
          actorUserId: actor.userId,
          sessionId: actor.id,
          authenticationProviderRevisionId: actor.authenticationProviderRevisionId,
          targetMembershipId: target.id,
          context: {
            reason: nextStatus !== target.status ? `status_${nextStatus}` : `role_${nextRole}`,
          },
        })
        return changed
      })
    },
  }
}
