import type { Prisma } from "../../../generated/prisma/client.ts"

export function getCopilotConnectionState(
  database: Pick<Prisma.TransactionClient, "copilotConnectionState">,
) {
  return database.copilotConnectionState.findUnique({ where: { key: "global" } })
}
