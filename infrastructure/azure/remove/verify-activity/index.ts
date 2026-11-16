import type { RemovalContext } from "../types.ts"

export async function verifyRemovalActivity(
  context: RemovalContext,
  locks: readonly { held: boolean; verify(): Promise<void> }[] = [],
): Promise<void> {
  context.signal?.throwIfAborted()
  for (const lock of locks) {
    if (!lock.held) throw new Error("Removal no longer holds its deployment lock.")
    await lock.verify()
  }
  const jobs: unknown = JSON.parse(
    await context.azure(
      "containerapp",
      "job",
      "list",
      "--resource-group",
      context.config.azure.resourceGroup,
    ),
  )
  if (!Array.isArray(jobs)) throw new Error("Removal could not verify setup job activity.")
  for (const job of jobs) {
    if (!job || typeof job !== "object" || typeof job.name !== "string")
      throw new Error("Removal could not verify setup job identity.")
    if (![`${context.config.name}-setup`, `${context.config.name}-provision`].includes(job.name))
      continue
    const executions: unknown = JSON.parse(
      await context.azure(
        "containerapp",
        "job",
        "execution",
        "list",
        "--name",
        job.name,
        "--resource-group",
        context.config.azure.resourceGroup,
        "--query",
        "[].{name:name,status:properties.status}",
      ),
    )
    if (
      !Array.isArray(executions) ||
      executions.some(
        (execution) =>
          !execution ||
          typeof execution !== "object" ||
          typeof execution.name !== "string" ||
          !["Succeeded", "Failed", "Stopped", "Canceled"].includes(execution.status),
      )
    )
      throw new Error("Removal blocked: a setup or provisioning job is running or unverifiable.")
  }
}
