import { describe, expect, it } from "vitest"

import type { SecurityAuditListRecord } from "../../../../repositories/security-audits/list-security-audits/types"
import { getSecurityAuditData } from "../../../../repositories/security-audits/get-security-audit-data"
import { parseSecurityAuditEvent } from "../../../../repositories/security-audits/parse-security-audit-event"
import { presentSecurityAudit } from "."

const actorMembershipId = "00000000-0000-4000-8000-000000000001"
const targetMembershipId = "00000000-0000-4000-8000-000000000002"
const membershipId = "00000000-0000-4000-8000-000000000003"
const assignmentId = "00000000-0000-4000-8000-000000000004"
const sessionId = "00000000-0000-4000-8000-000000000005"
const externalIdentityId = "00000000-0000-4000-8000-000000000006"
const providerId = "00000000-0000-4000-8000-000000000007"
const authorizationId = "00000000-0000-4000-8000-000000000008"
const auditId = "00000000-0000-4000-8000-000000000009"
const createdAt = new Date("2026-11-10T12:00:00.000Z")

function storedRecordFor(event: unknown): SecurityAuditListRecord {
  const parsedEvent = parseSecurityAuditEvent(event)
  const data = getSecurityAuditData(parsedEvent)
  return {
    action: data.action,
    context: JSON.parse(JSON.stringify(data.context ?? {})) as SecurityAuditListRecord["context"],
    createdAt,
    id: parsedEvent.id,
    outcome: data.outcome ?? null,
    targetId: typeof data.targetId === "string" ? data.targetId : null,
  }
}

function expectedRecord(input: {
  action: string
  actor?: { membershipId: string } | null
  context?: Record<string, number | string | string[]>
  outcome: "denied" | "failure" | "success" | null
}) {
  return {
    action: input.action,
    actor: input.actor ?? null,
    context: input.context ?? {},
    id: auditId,
    occurredAt: createdAt.toISOString(),
    outcome: input.outcome,
  }
}

describe("presentSecurityAudit()", () => {
  it.each([
    {
      label: "bootstrap denial",
      event: { id: auditId, reason: "invalid_secret", type: "bootstrap_attempt_denied" },
      expected: expectedRecord({
        action: "admission.bootstrap.denied",
        context: { reason: "invalid_secret" },
        outcome: "denied",
      }),
    },
    ...(["created", "restored"] as const).map((state) => ({
      label: `bootstrap membership assignment ${state}`,
      event: {
        id: auditId,
        membershipId,
        type: `membership_assignment_${state}`,
      },
      expected: expectedRecord({
        action: `membership.assignment.${state}`,
        context: { role: "administrator", source: "bootstrap", targetId: membershipId },
        outcome: "success",
      }),
    })),
    ...(["created", "restored"] as const).map((state) => ({
      label: `membership ${state}`,
      event: { id: auditId, membershipId, type: `membership_${state}` },
      expected: expectedRecord({
        action: `membership.${state}`,
        context: { targetId: membershipId },
        outcome: "success",
      }),
    })),
    ...(["created", "revoked", "superseded"] as const).map((state) => ({
      label: `provider membership assignment ${state}`,
      event: {
        assignmentId,
        id: auditId,
        membershipId,
        role: "ADMINISTRATOR",
        type: `provider_membership_assignment_${state}`,
      },
      expected: expectedRecord({
        action: `provider.membership.assignment.${state}`,
        context: {
          membershipId,
          role: "administrator",
          source: "authentication_provider",
          targetId: assignmentId,
        },
        outcome: "success",
      }),
    })),
    ...(["created", "revoked"] as const).map((state) => ({
      label: `administrator membership assignment ${state}`,
      event: {
        actorMembershipId,
        assignmentId,
        id: auditId,
        targetMembershipId,
        type: `administrator_membership_assignment_${state}`,
      },
      expected: expectedRecord({
        action: `membership.assignment.administrator_${state}`,
        actor: { membershipId: actorMembershipId },
        context: {
          source: "hub_administrator",
          targetId: assignmentId,
          targetMembershipId,
        },
        outcome: "success",
      }),
    })),
    {
      label: "administrator management denial without a known actor",
      event: {
        actorMembershipId: null,
        id: auditId,
        operation: "designate",
        reason: "invalid_selection",
        type: "administrator_management_denied",
      },
      expected: expectedRecord({
        action: "membership.administrator_management.denied",
        context: { operation: "designate", reason: "invalid_selection" },
        outcome: "denied",
      }),
    },
    {
      label: "administrator management failure",
      event: {
        actorMembershipId,
        id: auditId,
        operation: "revoke",
        reason: "transaction_error",
        type: "administrator_management_failed",
      },
      expected: expectedRecord({
        action: "membership.administrator_management.failed",
        actor: { membershipId: actorMembershipId },
        context: { operation: "revoke", reason: "transaction_error" },
        outcome: "failure",
      }),
    },
    ...(
      [
        ["requested", "success"],
        ["verified", "success"],
        ["completed", "success"],
        ["denied", "denied"],
        ["expired", "denied"],
        ["cancelled", "success"],
      ] as const
    ).map(([phase, outcome]) => ({
      label: `administrator authorization ${phase}`,
      event: {
        actorMembershipId,
        authorizationId,
        id: auditId,
        operation: "DESIGNATE_ADMINISTRATORS",
        phase,
        reason: phase === "denied" ? "role_changed" : undefined,
        targetCount: 2,
        type: "administrator_authorization",
      },
      expected: expectedRecord({
        action: `administrator.authorization.${phase}`,
        actor: { membershipId: actorMembershipId },
        context: {
          operation: "designate_administrators",
          phase,
          ...(phase === "denied" ? { reason: "role_changed" } : {}),
          targetCount: 2,
          targetId: authorizationId,
        },
        outcome,
      }),
    })),
    {
      label: "session creation",
      event: { id: auditId, membershipId, sessionId, type: "session_created" },
      expected: expectedRecord({
        action: "session.created",
        actor: { membershipId },
        context: { targetId: sessionId },
        outcome: "success",
      }),
    },
    {
      label: "session end",
      event: { id: auditId, membershipId, sessionId, type: "session_ended" },
      expected: expectedRecord({
        action: "session.ended",
        context: { membershipId, targetId: sessionId },
        outcome: "success",
      }),
    },
    {
      label: "admission denial",
      event: {
        externalIdentityId,
        id: auditId,
        reason: "membership_missing",
        type: "admission_denied",
      },
      expected: expectedRecord({
        action: "admission.denied",
        context: { reason: "membership_missing", targetId: externalIdentityId },
        outcome: "denied",
      }),
    },
    {
      label: "admission failure",
      event: {
        externalIdentityId,
        id: auditId,
        reason: "transaction_error",
        type: "admission_failed",
      },
      expected: expectedRecord({
        action: "admission.failed",
        context: { reason: "transaction_error", targetId: externalIdentityId },
        outcome: "failure",
      }),
    },
    {
      label: "authentication denial with a custom provider",
      event: {
        id: auditId,
        provider: "custom+提供者",
        reason: "provider_failed",
        type: "authentication_attempt_denied",
      },
      expected: expectedRecord({
        action: "authentication.attempt.denied",
        context: { provider: "custom+提供者", reason: "provider_failed" },
        outcome: "denied",
      }),
    },
    {
      label: "external identity creation omits the issuer",
      event: {
        externalIdentityId,
        id: auditId,
        issuer: "https://issuer.example/private-tenant",
        provider: "custom+workforce",
        type: "external_identity_created",
      },
      expected: expectedRecord({
        action: "identity.external.created",
        context: { provider: "custom+workforce", targetId: externalIdentityId },
        outcome: "success",
      }),
    },
    {
      label: "external identity creation failure omits the issuer",
      event: {
        id: auditId,
        issuer: "https://issuer.example/private-tenant",
        provider: "custom+workforce",
        reason: "retry_exhausted",
        type: "external_identity_create_failed",
      },
      expected: expectedRecord({
        action: "identity.external.create_failed",
        context: { provider: "custom+workforce", reason: "retry_exhausted" },
        outcome: "failure",
      }),
    },
    {
      label: "provider revision selection",
      event: {
        id: auditId,
        providerId,
        providerKey: "custom+workforce",
        revision: 3,
        type: "provider_revision_selected",
      },
      expected: expectedRecord({
        action: "identity.provider_revision.selected",
        context: { provider: "custom+workforce", revision: 3, targetId: providerId },
        outcome: "success",
      }),
    },
    {
      label: "provider revision validation failure",
      event: {
        id: auditId,
        providerKey: "custom+workforce",
        revision: 4,
        type: "provider_revision_validation_failed",
      },
      expected: expectedRecord({
        action: "identity.provider_revision.validation_failed",
        context: { provider: "custom+workforce", reason: "validation_failed", revision: 4 },
        outcome: "failure",
      }),
    },
    {
      label: "provider revision denial",
      event: {
        id: auditId,
        providerKey: "custom+workforce",
        reason: "revision_gap",
        revision: 5,
        type: "provider_revision_denied",
      },
      expected: expectedRecord({
        action: "identity.provider_revision.denied",
        context: { provider: "custom+workforce", reason: "revision_gap", revision: 5 },
        outcome: "denied",
      }),
    },
    {
      label: "provider revision persistence failure",
      event: {
        id: auditId,
        providerKey: "custom+workforce",
        reason: "transaction_error",
        revision: 6,
        type: "provider_revision_persist_failed",
      },
      expected: expectedRecord({
        action: "identity.provider_revision.persist_failed",
        context: {
          provider: "custom+workforce",
          reason: "transaction_error",
          revision: 6,
        },
        outcome: "failure",
      }),
    },
    ...(["disabled", "enabled"] as const).map((state) => ({
      label: `authentication provider ${state}`,
      event: {
        id: auditId,
        providerId,
        providerKey: "custom+workforce",
        type: `authentication_provider_${state}`,
      },
      expected: expectedRecord({
        action: `identity.authentication_provider.${state}`,
        context: { provider: "custom+workforce", targetId: providerId },
        outcome: "success",
      }),
    })),
    {
      label: "authentication provider reconciliation failure",
      event: {
        id: auditId,
        providerKeys: ["github", "custom+workforce"],
        reason: "retry_exhausted",
        type: "authentication_providers_reconcile_failed",
      },
      expected: expectedRecord({
        action: "identity.authentication_providers.reconcile_failed",
        context: {
          providerKeys: ["github", "custom+workforce"],
          reason: "retry_exhausted",
        },
        outcome: "failure",
      }),
    },
    {
      label: "failed global session revocation",
      event: {
        actorMembershipId: membershipId,
        id: auditId,
        reason: "retry_exhausted",
        type: "all_hub_sessions_end_failed",
      },
      expected: expectedRecord({
        action: "session.revocation.end_all_failed",
        actor: { membershipId },
        context: { reason: "retry_exhausted" },
        outcome: "failure",
      }),
    },
    {
      label: "session revocation advancement",
      event: {
        id: auditId,
        reason: "provider_removed",
        revision: 7,
        type: "session_revocation_advanced",
      },
      expected: expectedRecord({
        action: "session.revocation.advanced",
        context: { reason: "provider_removed", revision: 7 },
        outcome: "success",
      }),
    },
    ...(
      [
        ["connected", "success", true, undefined],
        ["disconnected", "success", true, undefined],
        ["denied", "denied", false, "token_missing"],
        ["failed", "failure", false, "status_check_failed"],
      ] as const
    ).map(([phase, outcome, hasConnectionId, reason]) => ({
      label: `Copilot connection ${phase}`,
      event: {
        actorMembershipId,
        ...(hasConnectionId ? { connectionId: providerId } : {}),
        id: auditId,
        phase,
        ...(reason ? { reason } : {}),
        type: "copilot_connection",
      },
      expected: expectedRecord({
        action: `copilot.connection.${phase}`,
        actor: { membershipId: actorMembershipId },
        context: {
          phase,
          ...(reason ? { reason } : {}),
          ...(hasConnectionId ? { targetId: providerId } : {}),
        },
        outcome,
      }),
    })),
  ])("presents the stored projection for $label", ({ event, expected }) => {
    const presented = presentSecurityAudit(storedRecordFor(event))

    expect(presented).toEqual(expected)
    expect(JSON.stringify(presented)).not.toContain("https://issuer.example/private-tenant")
  })

  it.each([
    {
      label: "an unknown action",
      record: {
        ...storedRecordFor({
          id: auditId,
          membershipId,
          sessionId,
          type: "session_created",
        }),
        action: "unknown.future.action",
        context: { accessToken: "unknown-action-secret" },
      },
      expected: expectedRecord({ action: "unknown.future.action", outcome: "success" }),
    },
    {
      label: "malformed context for a recognized action",
      record: {
        ...storedRecordFor({
          id: auditId,
          membershipId,
          sessionId,
          type: "session_ended",
        }),
        context: { membershipId: "not-a-uuid" },
      },
      expected: expectedRecord({ action: "session.ended", outcome: "success" }),
    },
    {
      label: "extra secret-like context for a recognized action",
      record: {
        ...storedRecordFor({
          id: auditId,
          providerId,
          providerKey: "custom+workforce",
          revision: 3,
          type: "provider_revision_selected",
        }),
        context: {
          accessToken: "recognized-action-secret",
          provider: "custom+workforce",
          revision: 3,
        },
      },
      expected: expectedRecord({
        action: "identity.provider_revision.selected",
        outcome: "success",
      }),
    },
  ])("redacts $label", ({ record, expected }) => {
    const presented = presentSecurityAudit(record)

    expect(presented).toEqual(expected)
    expect(JSON.stringify(presented)).not.toContain("secret")
  })
})
