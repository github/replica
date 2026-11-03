import childProcess from "node:child_process"
import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import timers from "node:timers/promises"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

import type { ContainerApp, DeploymentPlan, Installation, JobExecution, Revision } from "./types.ts"

export async function deployHub(args: string[] = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      subscription: { type: "string" },
      backend: { type: "string" },
      variables: { type: "string" },
      image: { type: "string" },
      "accept-maintenance": { type: "boolean" },
      confirm: { type: "string" },
      help: { type: "boolean" },
    },
  })
  if (values.help) {
    console.log(
      "Usage: node infrastructure/azure/deploy-hub/index.ts bootstrap|release|destroy " +
        "--subscription ID --backend FILE --variables FILE --image REGISTRY/IMAGE@sha256:DIGEST " +
        "[--accept-maintenance] [--confirm INSTALLATION]",
    )
    return
  }
  const operation = positionals[0]
  if (
    positionals.length !== 1 ||
    !operation ||
    !["bootstrap", "release", "destroy"].includes(operation)
  ) {
    throw new Error("Choose exactly one operation: bootstrap, release, or destroy.")
  }
  const { subscription, backend, variables, image } = values
  if (!subscription || !backend || !variables || !image) {
    throw new Error("Supply --subscription, --backend, --variables, and --image.")
  }
  if (!/^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error("--image must name an immutable SHA-256 digest.")
  }
  if (operation !== "bootstrap" && !values["accept-maintenance"]) {
    throw new Error("Releases and destruction stop Hub. Supply --accept-maintenance.")
  }

  const subscriptionId = subscription
  const variablesPath = resolve(variables)
  const root = resolve(import.meta.dirname, "..")
  const planPath = resolve(root, ".terraform", `deployment-${randomUUID()}.tfplan`)
  const previousMask = process.umask(0o077)
  let lease: string | undefined

  function command(executable: string, arguments_: string[], capture = false): string {
    try {
      const output = childProcess.execFileSync(executable, arguments_, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      })
      return capture ? (output?.trim() ?? "") : ""
    } catch {
      // Child errors and output can contain credentials and release lease arguments.
      throw new Error(
        executable === "terraform"
          ? "Terraform command failed; inspect the installation through authorized tooling."
          : "Azure command failed; inspect the installation through authorized tooling.",
      )
    }
  }
  function terraform(arguments_: string[], capture = false): string {
    return command("terraform", [`-chdir=${root}`, ...arguments_], capture)
  }
  function parseOutput<T>(output: string): T {
    try {
      return JSON.parse(output) as T
    } catch {
      throw new Error("Deployment tooling returned an invalid response.")
    }
  }
  function azure<T>(...arguments_: string[]): T {
    return parseOutput<T>(
      command(
        "az",
        [...arguments_, "--subscription", subscriptionId, "--only-show-errors", "--output", "json"],
        true,
      ),
    )
  }
  function readInstallation(): Installation {
    const installation = parseOutput<Installation>(
      terraform(["output", "-json", "installation"], true),
    )
    if (installation.subscription_id !== subscription) {
      throw new Error("The selected subscription does not match this Terraform state.")
    }
    return installation
  }
  function verifyOwnership(installation: Installation): void {
    const group = azure<{ tags?: Record<string, string> }>(
      "group",
      "show",
      "--name",
      installation.resource_group,
    )
    const expected = {
      application: "replica-hub",
      managed_by: "terraform",
      installation: installation.name,
      owner: installation.owner,
    }
    if (Object.entries(expected).some(([key, value]) => group.tags?.[key] !== value)) {
      throw new Error("Resource group ownership does not match this installation.")
    }
  }
  function appArguments(installation: Installation): string[] {
    return ["--name", installation.app_name, "--resource-group", installation.resource_group]
  }
  function jobArguments(installation: Installation): string[] {
    return ["--name", installation.setup_job_name, "--resource-group", installation.resource_group]
  }
  function blobArguments(installation: Installation, deleting = false): string[] {
    return [
      "--account-name",
      installation.storage_account,
      "--container-name",
      installation.release_container,
      deleting ? "--name" : "--blob-name",
      installation.release_blob,
      "--auth-mode",
      "login",
    ]
  }
  function plan(
    deploy: boolean,
    installation?: Installation,
    target?: string,
    destroy = false,
  ): void {
    const arguments_ = [
      "plan",
      "-input=false",
      "-lock-timeout=60s",
      `-var-file=${variablesPath}`,
      `-var=image=${image}`,
      `-var=deploy_hub=${deploy}`,
      `-out=${planPath}`,
    ]
    if (target) arguments_.push(`-target=${target}`)
    if (destroy) arguments_.push("-destroy")
    terraform(arguments_)
    const planned = parseOutput<DeploymentPlan>(terraform(["show", "-json", planPath], true))
    if (!destroy) {
      if (planned.resource_changes?.some(({ change }) => change.actions.includes("delete"))) {
        throw new Error(
          "Release plans cannot delete or replace resources. Review recovery separately.",
        )
      }
      if (planned.variables.subscription_id?.value !== subscription) {
        throw new Error("The variable file selects a different subscription.")
      }
      if (installation && planned.variables.name?.value !== installation.name) {
        throw new Error("The variable file selects a different installation.")
      }
    }
  }
  function apply(): void {
    terraform(["apply", "-input=false", "-lock-timeout=60s", planPath])
  }
  async function stopHub(installation: Installation): Promise<void> {
    if (!installation.app_created) return
    const revisions = azure<Revision[]>(
      "containerapp",
      "revision",
      "list",
      ...appArguments(installation),
    )
    for (const revision of revisions) {
      if (revision.properties.active) {
        azure(
          "containerapp",
          "revision",
          "deactivate",
          ...appArguments(installation),
          "--revision",
          revision.name,
        )
      }
    }
    const deadline = performance.now() + 300_000
    // Inactive revisions may still have terminating replicas.
    for (const revision of revisions) {
      while (
        azure<unknown[]>(
          "containerapp",
          "replica",
          "list",
          ...appArguments(installation),
          "--revision",
          revision.name,
        ).length
      ) {
        if (performance.now() >= deadline) {
          throw new Error("Old replicas have not stopped. Hub remains in maintenance.")
        }
        await timers.setTimeout(5_000)
      }
    }
  }
  async function setup(installation: Installation): Promise<void> {
    const execution = azure<JobExecution>(
      "containerapp",
      "job",
      "start",
      ...jobArguments(installation),
    )
    const deadline = performance.now() + 1_920_000
    while (performance.now() < deadline) {
      const result = azure<JobExecution>(
        "containerapp",
        "job",
        "execution",
        "show",
        ...jobArguments(installation),
        "--job-execution-name",
        execution.name,
      )
      if (result.properties.status === "Succeeded") return
      if (["Failed", "Stopped", "Canceled"].includes(result.properties.status)) {
        throw new Error("Setup failed. Hub remains stopped; inspect the setup execution.")
      }
      await timers.setTimeout(5_000)
    }
    throw new Error("Setup timed out. Check or stop the execution before releasing the lock.")
  }
  async function waitReady(installation: Installation): Promise<void> {
    const app = azure<ContainerApp>("containerapp", "show", ...appArguments(installation))
    const revision = app.properties.latestRevisionName
    azure(
      "containerapp",
      "revision",
      "activate",
      ...appArguments(installation),
      "--revision",
      revision,
    )
    const deadline = performance.now() + 300_000
    while (performance.now() < deadline) {
      const latest = azure<ContainerApp>("containerapp", "show", ...appArguments(installation))
      if (latest.properties.latestReadyRevisionName === revision) {
        try {
          const response = await fetch(`${installation.url}/api/ready`, {
            signal: AbortSignal.timeout(10_000),
          })
          await response.body?.cancel()
          if (response.status === 200) return
          console.warn(`Hub readiness returned HTTP ${response.status}; retrying.`)
        } catch (error) {
          if (
            !(error instanceof TypeError) &&
            !(error instanceof DOMException && error.name === "TimeoutError")
          )
            throw error
          console.warn("Hub readiness request failed; retrying.")
        }
      }
      await timers.setTimeout(5_000)
    }
    throw new Error("Hub did not become ready. Keep the release lock and investigate.")
  }

  try {
    terraform(["init", "-input=false", `-backend-config=${resolve(backend)}`])
    if (azure<{ id: string }>("account", "show").id !== subscription) {
      throw new Error("Azure returned a different subscription.")
    }
    if (operation === "bootstrap") {
      if (terraform(["state", "list"], true).trim()) {
        throw new Error(
          "Infrastructure already exists. Use release; review partial bootstrap recovery separately.",
        )
      }
      plan(false)
      apply()
      console.log("Infrastructure is ready. Hub is not running. Run release to apply setup first.")
      return
    }
    let installation = readInstallation()
    verifyOwnership(installation)
    if (operation === "destroy" && values.confirm !== installation.name) {
      throw new Error("Destroy requires --confirm with the exact installation name.")
    }
    const acquired = azure<unknown>(
      "storage",
      "blob",
      "lease",
      "acquire",
      ...blobArguments(installation),
      "--lease-duration",
      "-1",
    )
    if (typeof acquired !== "string" || !acquired) {
      throw new Error("Azure did not return a release lease ID.")
    }
    lease = acquired
    installation = readInstallation()
    verifyOwnership(installation)
    const executions = azure<JobExecution[]>(
      "containerapp",
      "job",
      "execution",
      "list",
      ...jobArguments(installation),
    )
    if (
      executions.some(
        ({ properties }) =>
          !["Succeeded", "Failed", "Stopped", "Canceled"].includes(properties.status),
      )
    ) {
      throw new Error("A setup execution is still running; do not start another release.")
    }
    await stopHub(installation)
    if (operation === "destroy") {
      plan(installation.app_created, installation, undefined, true)
      azure("storage", "blob", "delete", ...blobArguments(installation, true), "--lease-id", lease)
      lease = undefined
      apply()
      console.log("Terraform-tracked installation resources were destroyed.")
      return
    }
    // Terraform must not update the app until the entire setup sequence succeeds.
    plan(installation.app_created, installation, "azurerm_container_app_job.setup")
    apply()
    await setup(installation)
    plan(true, installation)
    apply()
    installation = readInstallation()
    await waitReady(installation)
    azure(
      "storage",
      "blob",
      "lease",
      "release",
      ...blobArguments(installation),
      "--lease-id",
      lease,
    )
    lease = undefined
    console.log("Hub is ready. The maintenance window is complete.")
  } catch (error) {
    if (lease)
      console.error(
        "The infinite release lease is retained. Verify all processes and setup executions have stopped before an operator breaks the lease.",
      )
    throw error
  } finally {
    try {
      await rm(planPath, { force: true })
    } finally {
      process.umask(previousMask)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await deployHub()
  } catch (error) {
    console.error("Deployment stopped:", error instanceof Error ? error.message : "Unknown failure")
    process.exitCode = 1
  }
}
