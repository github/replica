import type { CreateSecurityAuditDatabase, CreateSecurityAuditInput } from "./types.ts"

import { normalizeSecretFreeJson } from "../../../utils/normalize-secret-free-json/index.ts"

function assertBoundedText(name: string, value: string, maximum: number) {
  if (!value.length || value.length > maximum) {
    throw new Error(`${name} must contain between 1 and ${maximum} characters.`)
  }
}

function validateContext(context: CreateSecurityAuditInput["context"]) {
  try {
    return normalizeSecretFreeJson(context, {
      maxArrayItems: 16,
      maxBytes: 4_096,
      maxDepth: 4,
      maxEntries: 64,
      maxKeyLength: 100,
      maxObjectFields: 16,
      maxStringLength: 500,
    })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const message = error.message
      .replace("JSON data", "Security audit context")
      .replace("JSON arrays", "Security audit context arrays")
      .replace("JSON objects", "Security audit context objects")
      .replace("JSON keys", "Security audit context keys")
      .replace("JSON string values", "Security audit context values")
      .replace("JSON numbers", "Security audit context numbers")
      .replace("JSON values", "Security audit context values")
    throw new Error(message, { cause: error })
  }
}

export function createSecurityAudit(
  database: CreateSecurityAuditDatabase,
  input: CreateSecurityAuditInput,
) {
  assertBoundedText("Security audit action", input.action, 100)
  assertBoundedText("Security audit target type", input.targetType, 100)
  if (input.targetId !== undefined) {
    assertBoundedText("Security audit target ID", input.targetId, 100)
  }
  const context = validateContext(input.context)

  return database.securityAudit.create({ data: { ...input, context } })
}
