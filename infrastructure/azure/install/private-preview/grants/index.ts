import { listingDeniedCondition } from "../plan/index.ts"
import type { ReaderMode } from "../settings/index.ts"

interface Assignment {
  id: string
  scope: string
  principalId: string
  roleDefinitionName: string
  condition: string | null
  conditionVersion: string | null
}

export interface ExpectedGrants {
  subscriptionId: string
  reader: ReaderMode
  readerPrincipalId: string
  hubPrincipalId: string
  writer: boolean
  writerRole: string
  acrId: string
  containerId: string
  secretScope?: string
}

const query =
  "[].{id:id,scope:scope,principalId:principalId,roleDefinitionName:roleDefinitionName,condition:condition,conditionVersion:conditionVersion}"
const same = (left: string, right: string) =>
  left.replace(/\/+$/, "").toLowerCase() === right.replace(/\/+$/, "").toLowerCase()
const compact = (value: string | null) => value?.replace(/\s+/g, "") ?? ""
const listingDenied = (grant: Assignment) =>
  compact(grant.condition) === compact(listingDeniedCondition) && grant.conditionVersion === "2.0"

// Checks role, scope, and the ABAC condition and version of every grant, not only role names.
export async function verifyPreviewGrants(
  read: (...args: string[]) => Promise<unknown>,
  expected: ExpectedGrants,
  // Before a change, only grants the wizard would never create are problems.
  { unexpectedOnly = false }: { unexpectedOnly?: boolean } = {},
): Promise<string[]> {
  const list = async (...args: string[]) => {
    const value = await read("role", "assignment", "list", ...args, "--fill-principal-name", "false", "--query", query)
    if (!Array.isArray(value) ||
        value.some((item) => !item || typeof item.id !== "string" || typeof item.scope !== "string" ||
          typeof item.principalId !== "string" || typeof item.roleDefinitionName !== "string"))
      throw new Error("Private preview grants could not be verified: Azure returned incomplete role assignments.")
    return value as Assignment[]
  }
  const problems: string[] = []
  // --all does not inspect parent management groups; a scoped query does not inspect children.
  const reader = [
    ...(await list("--assignee-object-id", expected.readerPrincipalId, "--all", "--include-groups")),
    ...(await list(
      "--assignee-object-id", expected.readerPrincipalId, "--scope", `/subscriptions/${expected.subscriptionId}`,
      "--include-inherited", "--include-groups",
    )),
  ].filter((grant, index, all) => all.findIndex((other) => same(other.id, grant.id)) === index)
  const wanted: [string, string, (grant: Assignment) => boolean][] = []
  if (expected.reader !== "absent") {
    wanted.push(["AcrPull", expected.acrId, () => true])
    wanted.push(["Storage Blob Data Reader", expected.containerId, listingDenied])
  }
  if (expected.reader === "enabled" && expected.secretScope)
    wanted.push(["Key Vault Secrets User", expected.secretScope, () => true])
  for (const grant of reader) {
    const match = wanted.find(([role, scope]) => grant.roleDefinitionName === role && same(grant.scope, scope))
    if (!match) problems.push(`The reader identity has an unexpected grant: ${grant.id}.`)
    else if (!unexpectedOnly && !match[2](grant))
      problems.push(`The reader grant ${grant.id} does not deny blob listing with condition version 2.0.`)
  }
  for (const [role, scope] of unexpectedOnly ? [] : wanted)
    if (!reader.some((grant) => grant.roleDefinitionName === role && same(grant.scope, scope)))
      problems.push(`The reader identity is missing ${role} on ${scope}.`)
  const hub = (await list("--scope", expected.containerId, "--include-inherited"))
    .filter((grant) => same(grant.principalId, expected.hubPrincipalId))
  const writers = hub.filter((grant) => grant.roleDefinitionName === expected.writerRole && same(grant.scope, expected.containerId))
  for (const grant of hub)
    if (!expected.writer || !writers.includes(grant))
      problems.push(`The Hub identity has access to the private preview container that the wizard does not manage: ${grant.id}.`)
  if (!unexpectedOnly && expected.writer && (writers.length !== 1 || !listingDenied(writers[0]!)))
    problems.push("The Hub identity does not have exactly one listing-denied private preview writer grant.")
  return problems
}
