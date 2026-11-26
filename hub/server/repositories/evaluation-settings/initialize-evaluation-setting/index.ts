import type { PrismaClient, Prisma } from "../../../generated/prisma/client.ts"

import { evaluationSettingKey } from "../../../utils/evaluation-setting-key/index.ts"

export function initializeEvaluationSetting(
  database: PrismaClient | Prisma.TransactionClient,
  key = evaluationSettingKey,
) {
  return database.evaluationSetting.upsert({ where: { key }, create: { key }, update: {} })
}
