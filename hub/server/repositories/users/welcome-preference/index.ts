import type { Prisma } from "../../../generated/prisma/client.ts"

export async function isWelcomeHidden(
  database: Pick<Prisma.TransactionClient, "user">,
  userId: string,
) {
  const user = await database.user.findUniqueOrThrow({
    where: { id: userId },
    select: { welcomeHiddenAt: true },
  })
  return user.welcomeHiddenAt !== null
}

export async function hideWelcome(
  database: Pick<Prisma.TransactionClient, "user">,
  userId: string,
) {
  await database.user.updateMany({
    where: { id: userId, welcomeHiddenAt: null },
    data: { welcomeHiddenAt: new Date() },
  })
}
