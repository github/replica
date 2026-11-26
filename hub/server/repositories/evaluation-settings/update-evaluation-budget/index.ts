import type { Prisma } from "../../../generated/prisma/client.ts"

import { evaluationSettingKey } from "../../../utils/evaluation-setting-key/index.ts"

export function updateEvaluationBudget(
  database: Prisma.TransactionClient,
  monthlyBudgetCredits: string,
  key = evaluationSettingKey,
) {
  return database.evaluationSetting.upsert({
    where: { key },
    create: { key, monthlyBudgetCredits, revision: 1 },
    update: { monthlyBudgetCredits, revision: { increment: 1 } },
  })
}
