import type { Prisma } from "../../../generated/prisma/client.ts"

export function advanceCopilotConnectionState(
  database: Pick<Prisma.TransactionClient, "copilotConnectionState">,
) {
  return database.copilotConnectionState.update({
    where: { key: "global" },
    data: { generation: { increment: 1 } },
  })
}
