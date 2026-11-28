import { describe, expect, it } from "vitest"

import { listingDeniedCondition } from "../plan/index.ts"
import { verifyPreviewGrants, type ExpectedGrants } from "./index.ts"

const subscriptionId = "00000000-0000-0000-0000-000000000001"
const readerPrincipalId = "11111111-1111-4111-8111-111111111111"
const hubPrincipalId = "22222222-2222-4222-8222-222222222222"
const containerId = `/subscriptions/${subscriptionId}/resourceGroups/sample/providers/Microsoft.Storage/storageAccounts/samplehub/blobServices/default/containers/private-preview-artifacts`
const acrId = `/subscriptions/${subscriptionId}/resourceGroups/foundation/providers/Microsoft.ContainerRegistry/registries/sample`
const writerRole = "Replica sample private preview writer"
const expected: ExpectedGrants = {
  subscriptionId,
  reader: "disabled",
  readerPrincipalId,
  hubPrincipalId,
  writer: false,
  writerRole,
  acrId,
  containerId,
}

let next = 0
function grant(principalId: string, roleDefinitionName: string, scope: string, condition: string | null = null, conditionVersion: string | null = null) {
  next += 1
  return { id: `${scope}/providers/Microsoft.Authorization/roleAssignments/${next}`, scope, principalId, roleDefinitionName, condition, conditionVersion }
}
const acrPull = () => grant(readerPrincipalId, "AcrPull", acrId)
const readerArtifacts = (condition: string | null = listingDeniedCondition, version: string | null = "2.0") =>
  grant(readerPrincipalId, "Storage Blob Data Reader", containerId, condition, version)

// Azure returns each identity's effective grants, including those made to its groups.
function azure(reader: ReturnType<typeof grant>[], hub: ReturnType<typeof grant>[] = []) {
  return async (...args: string[]) => {
    const assignee = args[args.indexOf("--assignee-object-id") + 1]
    if (assignee === readerPrincipalId) return reader
    if (assignee === hubPrincipalId) return hub
    throw new Error(`Unexpected role assignment query: ${args.join(" ")}`)
  }
}
const groupId = "33333333-3333-4333-8333-333333333333"
const accountId = containerId.replace(/\/blobServices\/.*$/, "")
const hubArtifacts = () =>
  grant(hubPrincipalId, "Storage Blob Data Contributor", containerId.replace(/private-preview-artifacts$/, "artifacts"))

describe("verifyPreviewGrants", () => {
  it("accepts a disabled reader with image pull and a listing-denied artifact grant", async () => {
    await expect(verifyPreviewGrants(azure([acrPull(), readerArtifacts()]), expected)).resolves.toEqual([])
  })

  it.each([
    ["no condition", readerArtifacts(null, null)],
    ["another condition", readerArtifacts("(@Resource[name] StringEquals 'x')", "2.0")],
    ["another condition version", readerArtifacts(listingDeniedCondition, "1.0")],
  ])("flags a reader artifact grant with %s", async (_, artifacts) => {
    const problems = await verifyPreviewGrants(azure([acrPull(), artifacts]), expected)

    expect(problems).toEqual([expect.stringContaining("does not deny blob listing")])
  })

  it("accepts a condition that differs from the template only in whitespace", async () => {
    const artifacts = readerArtifacts(listingDeniedCondition.replace(/\s+/g, " "), "2.0")

    await expect(verifyPreviewGrants(azure([acrPull(), artifacts]), expected)).resolves.toEqual([])
  })

  it("flags an unexpected reader grant", async () => {
    const extra = grant(readerPrincipalId, "Storage Blob Data Reader", `/subscriptions/${subscriptionId}`)

    const problems = await verifyPreviewGrants(azure([acrPull(), readerArtifacts(), extra]), expected)

    expect(problems).toEqual([expect.stringContaining(`unexpected grant: ${extra.id}`)])
  })

  it("flags remaining reader grants after the reader is removed", async () => {
    const problems = await verifyPreviewGrants(azure([acrPull()]), { ...expected, reader: "absent" })

    expect(problems).toEqual([expect.stringContaining("unexpected grant")])
  })

  it("before a change, flags only grants the wizard would never create", async () => {
    const legacy = readerArtifacts(null, null)
    const extra = grant(readerPrincipalId, "Storage Blob Data Contributor", containerId)
    const check = (grants: ReturnType<typeof grant>[]) =>
      verifyPreviewGrants(azure(grants), { ...expected, writer: true }, { unexpectedOnly: true })

    await expect(check([legacy])).resolves.toEqual([])
    await expect(check([legacy, extra])).resolves.toEqual([expect.stringContaining(`unexpected grant: ${extra.id}`)])
  })

  it("flags Hub access to the container when the writer is off", async () => {
    const writer = grant(hubPrincipalId, writerRole, containerId, listingDeniedCondition, "2.0")

    const problems = await verifyPreviewGrants(azure([acrPull(), readerArtifacts()], [writer]), expected)

    expect(problems).toEqual([expect.stringContaining(`Hub identity has access`)])
  })

  it("accepts exactly one listing-denied writer grant for Hub when the writer is on", async () => {
    const writer = grant(hubPrincipalId, writerRole, containerId, listingDeniedCondition, "2.0")

    // Hub's grant on its own artifacts container does not reach the private preview container.
    await expect(
      verifyPreviewGrants(azure([acrPull(), readerArtifacts()], [writer, hubArtifacts()]), { ...expected, writer: true }),
    ).resolves.toEqual([])
  })

  it.each([
    ["no condition", grant(hubPrincipalId, writerRole, containerId)],
    ["an inherited broader role", grant(hubPrincipalId, "Storage Blob Data Contributor", `/subscriptions/${subscriptionId}`)],
  ])("flags a writer setup with %s", async (_, hubGrant) => {
    const problems = await verifyPreviewGrants(azure([acrPull(), readerArtifacts()], [hubGrant]), {
      ...expected,
      writer: true,
    })

    expect(problems.length).toBeGreaterThan(0)
  })

  it.each([
    ["a grant to one of its groups", grant(groupId, "Storage Blob Data Reader", containerId)],
    ["a grant on the storage account", grant(hubPrincipalId, "Storage Blob Data Reader", accountId)],
    ["a grant on a management group", grant(hubPrincipalId, "Storage Blob Data Reader", "/providers/Microsoft.Management/managementGroups/sample")],
  ])("flags Hub reaching the container through %s", async (_, hubGrant) => {
    const problems = await verifyPreviewGrants(azure([acrPull(), readerArtifacts()], [hubGrant]), expected)

    expect(problems).toEqual([expect.stringContaining(`Hub identity has access to the private preview container that the wizard does not manage: ${hubGrant.id}`)])
  })

  it("does not accept a writer grant that Hub receives through a group", async () => {
    const indirect = grant(groupId, writerRole, containerId, listingDeniedCondition, "2.0")

    const problems = await verifyPreviewGrants(azure([acrPull(), readerArtifacts()], [indirect]), { ...expected, writer: true })

    expect(problems).toEqual([
      expect.stringContaining(`does not manage: ${indirect.id}`),
      expect.stringContaining("exactly one listing-denied private preview writer grant"),
    ])
  })

  it("checks only Hub before the reader identity exists", async () => {
    const { readerPrincipalId: _, ...withoutReader } = expected
    const writer = grant(hubPrincipalId, writerRole, containerId, listingDeniedCondition, "2.0")

    await expect(verifyPreviewGrants(azure([], []), { ...withoutReader, reader: "enabled" })).resolves.toEqual([])
    await expect(verifyPreviewGrants(azure([], [writer]), { ...withoutReader, reader: "enabled" })).resolves.toEqual([
      expect.stringContaining("Hub identity has access"),
    ])
  })
})
