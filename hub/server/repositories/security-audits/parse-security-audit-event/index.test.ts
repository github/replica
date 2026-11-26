import { describe, expect, it } from "vitest"

import { parseSecurityAuditEvent } from "."

describe("parseSecurityAuditEvent()", () => {
  it("accepts typed decision training and promotion events", () => {
    const actorMembershipId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    const repositoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

    expect(
      parseSecurityAuditEvent({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        type: "decision_training",
        actorMembershipId,
        repositoryId,
        jobId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        outcome: "requested",
      }),
    ).toMatchObject({ type: "decision_training", outcome: "requested" })
    expect(
      parseSecurityAuditEvent({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        type: "decision_promotion",
        actorMembershipId,
        repositoryId,
        candidateId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        generation: 2,
        operation: "promote",
        outcome: "succeeded",
      }),
    ).toMatchObject({ type: "decision_promotion", generation: 2 })
    expect(
      parseSecurityAuditEvent({
        id: "12121212-1212-4121-8121-121212121212",
        type: "decision_candidate_rejection",
        actorMembershipId,
        repositoryId,
        candidateId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      }),
    ).toMatchObject({ type: "decision_candidate_rejection" })
  })

  it("uses the shared opaque provider key contract", () => {
    const event = {
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      type: "provider_revision_selected",
      providerId: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      providerKey: "GitHub.App/V2",
      revision: 1,
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
    expect(() => parseSecurityAuditEvent({ ...event, providerKey: "provider key" })).toThrow()
  })

  it("rejects unknown event fields", () => {
    expect(() =>
      parseSecurityAuditEvent({
        id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
        type: "provider_revision_validation_failed",
        providerKey: "workforce",
        revision: 1,
        context: {},
      }),
    ).toThrow()
  })

  it("accepts verification-state denial as a bounded authentication audit reason", () => {
    const event = {
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      type: "authentication_attempt_denied",
      provider: "github",
      reason: "verification_state_invalid",
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
  })

  it("accepts bootstrap assignment events without caller-supplied invariant metadata", () => {
    const event = {
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      type: "membership_assignment_created",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
  })

  it.each([
    "provider_membership_assignment_created",
    "provider_membership_assignment_superseded",
    "provider_membership_assignment_revoked",
  ] as const)("accepts bounded provider assignment lifecycle event %s", (type) => {
    const event = {
      assignmentId: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      id: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
      role: "ADMINISTRATOR" as const,
      type,
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
  })

  it("accepts a content-free repository learning decision audit", () => {
    const event = {
      actorMembershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
      decision: "accept" as const,
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      learningId: "mem_1",
      operationId: "e02c9c4c-f661-4618-8ff5-ab9cf10eaece",
      outcome: "succeeded" as const,
      repositoryId: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      type: "learning_decision" as const,
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
    expect(parseSecurityAuditEvent({ ...event, outcome: "requested" })).toEqual({
      ...event,
      outcome: "requested",
    })
  })

  it("accepts a bounded learning run request audit", () => {
    const event = {
      actorMembershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      outcome: "requested" as const,
      repositoryId: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      runId: "e02c9c4c-f661-4618-8ff5-ab9cf10eaece",
      type: "learning_run" as const,
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
  })

  it("accepts a content-free learning share audit", () => {
    const event = {
      actorMembershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      learningId: "mem_1",
      repositoryId: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      shared: false,
      type: "learning_share" as const,
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
    expect(() => parseSecurityAuditEvent({ ...event, content: "Use red buttons." })).toThrow()
  })
})
