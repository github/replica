import type {
  CreateSecurityAuditDatabase,
  CreateSecurityAuditInput,
  SecurityAuditContext,
} from "./types.ts"

const sensitiveKey = /(?:authorization|cookie|credential|password|secret|token)/i

function assertBoundedText(name: string, value: string, maximum: number) {
  if (!value.length || value.length > maximum) {
    throw new Error(`${name} must contain between 1 and ${maximum} characters.`)
  }
}

function validateContext(context: SecurityAuditContext) {
  const entries = Object.entries(context)
  if (entries.length > 16) {
    throw new Error("Security audit context cannot contain more than 16 fields.")
  }
  for (const [key, value] of entries) {
    assertBoundedText("Security audit context keys", key, 100)
    if (sensitiveKey.test(key)) {
      throw new Error("Security audit context cannot contain secret-bearing fields.")
    }
    if (typeof value === "string" && value.length > 500) {
      throw new Error("Security audit context values cannot exceed 500 characters.")
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Security audit context numbers must be finite.")
    }
  }
  if (Buffer.byteLength(JSON.stringify(context), "utf8") > 4_096) {
    throw new Error("Security audit context cannot exceed 4096 bytes.")
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
  validateContext(input.context)

  return database.securityAudit.create({ data: input })
}
