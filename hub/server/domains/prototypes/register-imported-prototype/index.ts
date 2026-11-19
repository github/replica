import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { lockImportedPrototype } from "../../../repositories/prototypes/lock-imported-prototype/index.ts"
import { updatePrototypeMetadata } from "../../../repositories/prototypes/update-prototype-metadata/index.ts"

/** Registers successful hosted prototypes without taking ownership of user metadata. */
export function registerImportedPrototype(database: PrismaClient, buildId: string) {
  return database.$transaction(async (transaction) => {
    const prototype = await lockImportedPrototype(transaction, buildId)
    if (!prototype || !prototype.branchName.startsWith("proto/")) return false
    if (prototype.registeredAt) return true

    await updatePrototypeMetadata(transaction, prototype.id, {
      name: prototype.name ?? prototype.branchName,
      registeredAt: new Date(),
    })
    return true
  })
}
