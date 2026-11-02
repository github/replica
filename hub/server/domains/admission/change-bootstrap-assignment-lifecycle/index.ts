import { randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { changeBootstrapAssignmentLifecycle as changeLifecycle } from "../../../repositories/membership-assignments/change-bootstrap-assignment-lifecycle/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { classifyPrismaTransactionError } from "../../../utils/classify-prisma-transaction-error/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"

const inputSchema = z
  .object({
    id: z.uuid(),
    lifecycle: z.enum(["ACTIVE", "REVOKED"]),
  })
  .strict()

export function changeBootstrapAssignmentLifecycle(
  input: z.input<typeof inputSchema>,
  database: {
    $transaction<Result>(
      operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel },
    ): Promise<Result>
  },
) {
  const parsed = inputSchema.parse(input)
  return runWithBoundedRetries(
    () =>
      database
        .$transaction(
          async (transaction) => {
            const result = await changeLifecycle(transaction, parsed)
            if (!result || result.transition === "unchanged") return result
            await createSecurityAudit(transaction, {
              id: randomUUID(),
              type:
                parsed.lifecycle === "ACTIVE"
                  ? "membership_assignment_restored"
                  : "membership_assignment_revoked",
              membershipId: result.membershipId,
              source: "bootstrap",
              role: "administrator",
            })
            return result
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
        .catch((error: unknown) => {
          if (classifyPrismaTransactionError(error) === "retryable") {
            throw new AdmissionTransactionConflictError({ cause: error })
          }
          throw error
        }),
    (error) => error instanceof AdmissionTransactionConflictError,
  )
}
