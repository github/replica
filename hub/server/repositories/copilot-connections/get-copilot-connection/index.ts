import type { Prisma } from "../../../generated/prisma/client.ts"

export function getCopilotConnection(
  database: Pick<Prisma.TransactionClient, "copilotConnection">,
) {
  return database.copilotConnection.findUnique({
    where: { key: "global" },
    include: {
      connectedByMembership: {
        include: { user: { include: { profile: true } } },
      },
    },
  })
}
