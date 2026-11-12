import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveCopilotConnectionState(
  database: Pick<Prisma.TransactionClient, "$executeRaw">,
  input:
    | { operation: "connect"; membershipId: string; tokenDigest: string }
    | { operation: "disconnect" },
) {
  if (input.operation === "connect") {
    await database.$executeRaw`
      UPDATE "copilot_connection_states"
      SET
        "connected_by_membership_id" = ${input.membershipId}::uuid,
        "token_digest" = ${input.tokenDigest},
        "verified_at" = clock_timestamp(),
        "refused_at" = NULL,
        "generation" = "generation" + 1,
        "updated_at" = clock_timestamp()
      WHERE "key" = 'global'
    `
    return
  }
  await database.$executeRaw`
    UPDATE "copilot_connection_states"
    SET
      "connected_by_membership_id" = NULL,
      "token_digest" = NULL,
      "verified_at" = NULL,
      "refused_at" = NULL,
      "generation" = "generation" + 1,
      "updated_at" = clock_timestamp()
    WHERE "key" = 'global'
  `
}
