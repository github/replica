import { join, resolve } from "node:path"
import timers from "node:timers/promises"
import { existingRoleAssignment } from "../existing-role-assignment/index.ts"

import { terraformModule } from "../../../terraform/index.ts"
import { acquireLease } from "../lease/index.ts"
import type { installationSecrets } from "../secrets/index.ts"
import type { AzureInstallation, Foundation, Installation } from "../types.ts"
import { writePrivateFile } from "../../../installer/private-files/index.ts"
import { retryableProvisioningFailure } from "../retryable-provisioning-failure/index.ts"

export async function provisionDatabase(
  context: AzureInstallation,
  installation: Installation,
  foundation: Foundation,
  secrets: Awaited<ReturnType<typeof installationSecrets>>,
  image: string,
  backend: string,
  learningBackend: string,
) {
  const { run, ui, env, config, directory, azure } = context
  const moduleFor = (name: string) =>
    terraformModule({
      directory: resolve(import.meta.dirname, "../../provision"),
      dataDirectory: join(directory, "terraform", name),
      run,
      ui,
      env,
      preapproved: context.approval !== undefined,
      retryApply: retryableProvisioningFailure,
      signal: context.signal,
      findUntracked: existingRoleAssignment(azure, config.azure.subscriptionId),
    })
  const freshModule = moduleFor("provision")
  const learningModule = moduleFor("learning-provision")
  await freshModule.init(backend)
  await learningModule.init(learningBackend)
  const lease = await acquireLease(
    context,
    installation.storage_account,
    "releases",
    "deployment.lock",
  )
  try {
    const setupExecutions = JSON.parse(
      await azure(
        "containerapp",
        "job",
        "execution",
        "list",
        "--name",
        `${config.name}-setup`,
        "--resource-group",
        installation.resource_group,
      ),
    ) as { properties: { status: string } }[]
    const terminal = ["Succeeded", "Failed", "Stopped", "Canceled"]
    if (setupExecutions.some(({ properties }) => !terminal.includes(properties.status))) {
      throw new Error(
        "A setup execution is still running. Database provisioning must wait until it has stopped.",
      )
    }
    const variables = join(directory, "provision.tfvars.json")
    const complete = await secrets.provisioned()
    const learningComplete = await secrets.learningProvisioned()
    const freshState = await freshModule.state()
    const learningState = await learningModule.state()
    if (learningState.length && (!complete || freshState.length)) {
      throw new Error(
        "Learning provisioning state conflicts with the database marker or fresh provisioning state. Inspect both states and database ownership before recovery.",
      )
    }
    const cleanup = async (module: ReturnType<typeof terraformModule>) => {
      await module.apply(variables, {
        destroy: true,
        allowedDeletions: [
          "azurerm_container_app_job.provision",
          "azurerm_user_assigned_identity.provision",
          "azurerm_role_assignment.image[0]",
          'azurerm_role_assignment.secrets["DATABASE_URL"]',
          'azurerm_role_assignment.secrets["HUB_MIGRATION_PASSWORD"]',
          'azurerm_role_assignment.secrets["HUB_RUNTIME_PASSWORD"]',
          'azurerm_role_assignment.secrets["HUB_LEARNING_PASSWORD"]',
        ],
      })
    }
    const provision = async (
      module: ReturnType<typeof terraformModule>,
      mode: "provision" | "provision-learning",
      done: boolean,
    ) => {
      const state = await module.state()
      if (done && !state.length) return
      if (!done && state.includes("azurerm_container_app_job.provision")) {
        const job = await module.output<string>("job_name")
        const executions = JSON.parse(
          await azure(
            "containerapp",
            "job",
            "execution",
            "list",
            "--name",
            job,
            "--resource-group",
            installation.resource_group,
          ),
        ) as { name: string }[]
        if (executions.length) {
          throw new Error(
            "Database provisioning has prior executions but no completion marker. Inspect the database and exact job execution; do not rerun provisioning blindly.",
          )
        }
      }
      await writePrivateFile(
        variables,
        JSON.stringify({
          subscription_id: config.azure.subscriptionId,
          name: config.name,
          location: config.azure.location,
          resource_group: installation.resource_group,
          environment_id: installation.environment_id,
          registry_id: foundation.registry_id,
          image,
          vault_id: foundation.vault_id,
          mode,
          secret_urls: mode === "provision" ? secrets.provisioning : secrets.learningProvisioning,
        }),
      )
      if (done) {
        const job = await module.output<string>("job_name")
        const executions = JSON.parse(
          await azure(
            "containerapp",
            "job",
            "execution",
            "list",
            "--name",
            job,
            "--resource-group",
            installation.resource_group,
          ),
        ) as { properties: { status: string } }[]
        if (executions.some(({ properties }) => !terminal.includes(properties.status))) {
          throw new Error(
            "A provisioning execution is still running. Temporary access cannot be removed yet.",
          )
        }
      } else {
        await module.apply(variables)
        const job = await module.output<string>("job_name")
        const executions = JSON.parse(
          await azure(
            "containerapp",
            "job",
            "execution",
            "list",
            "--name",
            job,
            "--resource-group",
            installation.resource_group,
          ),
        ) as { name: string; properties: { status: string } }[]
        if (executions.length) {
          throw new Error(
            "Database provisioning has prior executions but no completion marker. Inspect the database and exact job execution; do not rerun provisioning blindly.",
          )
        }
        await lease.verify()
        const execution = JSON.parse(
          await azure(
            "containerapp",
            "job",
            "start",
            "--name",
            job,
            "--resource-group",
            installation.resource_group,
          ),
        ) as { name: string }
        const deadline = performance.now() + 720_000
        let success = false
        while (performance.now() < deadline) {
          const result = JSON.parse(
            await azure(
              "containerapp",
              "job",
              "execution",
              "show",
              "--name",
              job,
              "--resource-group",
              installation.resource_group,
              "--job-execution-name",
              execution.name,
            ),
          ) as { properties: { status: string } }
          if (result.properties.status === "Succeeded") {
            success = true
            break
          }
          if (["Failed", "Stopped", "Canceled"].includes(result.properties.status)) {
            throw new Error(
              "Database provisioning failed. Inspect the named provisioning job and database ownership; the release lock is retained.",
            )
          }
          await timers.setTimeout(5_000)
        }
        if (!success)
          throw new Error("Provisioning timed out. Check the execution before releasing any lock.")
        await lease.verify()
        if (mode === "provision") {
          await secrets.markLearningProvisioned()
          await secrets.markProvisioned()
        } else {
          await secrets.markLearningProvisioned()
        }
      }
      await cleanup(module)
    }
    await provision(freshModule, "provision", complete)
    await provision(learningModule, "provision-learning", learningComplete || !complete)
    await lease.release()
  } finally {
    lease.reportRetained()
  }
}
