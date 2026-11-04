import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { afterEach, describe, it, mock } from "node:test"
import timers from "node:timers/promises"

import { deployHub } from "./index.ts"

afterEach(() => {
  mock.restoreAll()
})

function installationScenario({
  appCreated = true,
  setupStatus = "Succeeded",
  lockAvailable = true,
  releaseError,
}: {
  appCreated?: boolean
  setupStatus?: string
  lockAvailable?: boolean
  releaseError?: Error
} = {}) {
  const installation = {
    name: "test-hub",
    owner: "test-team",
    subscription_id: "test-subscription",
    resource_group: "test-hub",
    app_name: "test-hub",
    setup_job_name: "test-setup",
    storage_account: "testhub",
    release_container: "releases",
    release_blob: "deployment.lock",
    app_created: appCreated,
    url: "https://hub.example.com",
  }
  const events: string[][] = []
  const commandOptions: childProcess.ExecFileSyncOptions[] = []
  const replicaReads = new Map<string, number>()
  let targeted = false
  function execute(
    file: string,
    args: readonly string[],
    options: childProcess.ExecFileSyncOptions,
  ) {
    const command: string[] = [file, ...args]
    events.push(command)
    commandOptions.push(options)
    if (file === "terraform") {
      switch (args[1]) {
        case "output":
          return JSON.stringify(installation)
        case "state":
          return appCreated ? "azurerm_container_app.hub[0]" : ""
        case "plan":
          targeted = args.some((argument: string) => argument.startsWith("-target="))
          return ""
        case "show":
          return JSON.stringify({
            variables: {
              name: { value: installation.name },
              subscription_id: { value: installation.subscription_id },
            },
            resource_changes: [],
          })
        case "apply":
          if (!targeted) installation.app_created = true
          return ""
        case "init":
          return ""
        default:
          throw new Error(`Unexpected Terraform command: ${command.join(" ")}`)
      }
    }
    if (file !== "az") throw new Error(`Unexpected executable: ${file}`)
    const operation = args.slice(0, 3).join(" ")
    if (args.slice(0, 2).join(" ") === "account show") {
      return JSON.stringify({ id: installation.subscription_id })
    }
    if (args.slice(0, 2).join(" ") === "group show") {
      return JSON.stringify({
        tags: {
          application: "replica-hub",
          managed_by: "terraform",
          installation: installation.name,
          owner: installation.owner,
        },
      })
    }
    switch (operation) {
      case "storage blob lease":
        if (args.includes("acquire")) {
          if (!lockAvailable) throw new Error("Release lease is already held")
          return JSON.stringify("lease-id")
        }
        if (args.includes("release") && releaseError) throw releaseError
        return "null"
      case "containerapp revision list":
        return JSON.stringify([
          { name: "old-active", properties: { active: true } },
          { name: "old-terminating", properties: { active: false } },
        ])
      case "containerapp replica list": {
        const revision = args[args.indexOf("--revision") + 1]
        const reads = (replicaReads.get(revision) ?? 0) + 1
        replicaReads.set(revision, reads)
        return JSON.stringify(reads === 1 ? [{ name: `${revision}-replica` }] : [])
      }
      case "containerapp job execution":
        return JSON.stringify(args.includes("list") ? [] : { properties: { status: setupStatus } })
      case "containerapp job start":
        return JSON.stringify({ name: "setup-execution" })
      case "containerapp revision deactivate":
      case "containerapp revision activate":
        return "null"
      default:
        if (args.slice(0, 2).join(" ") === "containerapp show") {
          return JSON.stringify({
            properties: {
              latestRevisionName: "new",
              latestReadyRevisionName: "new",
            },
          })
        }
        throw new Error(`Unexpected Azure command: ${command.join(" ")}`)
    }
  }
  mock.method(childProcess, "execFileSync", execute)
  mock.method(timers, "setTimeout", async () => undefined)
  mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    events.push(["HTTPS", String(url)])
    return new Response(null, { status: 200 })
  })
  const args = [
    "release",
    "--subscription",
    installation.subscription_id,
    "--backend",
    "backend.hcl",
    "--variables",
    "installation.tfvars",
    "--image",
    `example.azurecr.io/hub@sha256:${"a".repeat(64)}`,
    "--accept-maintenance",
  ]
  return { args, events, replicaReads, commandOptions }
}

describe("deployHub()", () => {
  it("drains all old revisions and completes setup before rollout, readiness, and lease release", async () => {
    const { args, events, replicaReads, commandOptions } = installationScenario()

    await deployHub(args)

    const setup = events.findIndex(
      (event) => event.slice(0, 4).join(" ") === "az containerapp job start",
    )
    const drained = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.slice(0, 4).join(" ") === "az containerapp replica list")
    const deactivate = events.findIndex(
      (event) => event.includes("deactivate") && event.includes("old-active"),
    )
    assert.ok(deactivate >= 0)
    assert.ok(deactivate < drained[0].index)
    assert.equal(replicaReads.get("old-active"), 2)
    assert.equal(replicaReads.get("old-terminating"), 2)
    assert.ok(Math.max(...drained.map(({ index }) => index)) < setup)
    const setupSucceeded = events.findIndex(
      (event) => event.slice(0, 5).join(" ") === "az containerapp job execution show",
    )
    const rollout = events.findIndex(
      (event) =>
        event[0] === "terraform" &&
        event[2] === "plan" &&
        event.includes("-var=deploy_hub=true") &&
        !event.some((argument) => argument.startsWith("-target=")),
    )
    assert.ok(setupSucceeded > setup)
    assert.ok(rollout > setupSucceeded)
    const rolloutApplied = events.findIndex(
      (event, index) => index > rollout && event[0] === "terraform" && event[2] === "apply",
    )
    assert.ok(rolloutApplied > rollout)
    const ready = events.findIndex((event) => event[0] === "HTTPS")
    const release = events.findIndex(
      (event) => event.slice(0, 5).join(" ") === "az storage blob lease release",
    )
    assert.deepEqual(events[ready], ["HTTPS", "https://hub.example.com/api/ready"])
    assert.ok(ready > rolloutApplied)
    assert.ok(release > ready)
    assert.ok(
      commandOptions.every(
        ({ stdio }) =>
          stdio === "pipe" || (Array.isArray(stdio) && stdio[1] === "pipe" && stdio[2] === "pipe"),
      ),
    )
  })

  it("leaves Hub stopped and retains its lease when setup fails", async () => {
    const { args, events } = installationScenario({ setupStatus: "Failed" })

    await assert.rejects(deployHub(args), /Setup failed/)

    assert.ok(events.some((event) => event.includes("deactivate")))
    const plans = events.filter((event) => event[0] === "terraform" && event[2] === "plan")
    assert.equal(plans.length, 1)
    assert.ok(plans[0].includes("-target=azurerm_container_app_job.setup"))
    assert.ok(!events.some((event) => event.includes("activate")))
    assert.ok(!events.some((event) => event.includes("release")))
    assert.ok(!events.some((event) => event[0] === "HTTPS"))
  })

  it("runs setup before creating the first Hub app", async () => {
    const { args, events } = installationScenario({ appCreated: false })

    await deployHub(args)

    assert.ok(!events.some((event) => event.includes("deactivate")))
    const plans = events.filter((event) => event[0] === "terraform" && event[2] === "plan")
    assert.equal(plans.length, 2)
    assert.ok(plans[0].includes("-var=deploy_hub=false"))
    assert.ok(plans[0].includes("-target=azurerm_container_app_job.setup"))
    assert.ok(plans[1].includes("-var=deploy_hub=true"))
    const setup = events.findIndex(
      (event) => event.slice(0, 4).join(" ") === "az containerapp job start",
    )
    assert.ok(setup > events.indexOf(plans[0]))
    assert.ok(events.indexOf(plans[1]) > setup)
  })

  it("does not stop Hub or run setup while another release holds the lease", async () => {
    const { args, events } = installationScenario({ lockAvailable: false })

    await assert.rejects(deployHub(args), /Azure command failed/)

    assert.ok(
      events.some((event) => event.slice(0, 5).join(" ") === "az storage blob lease acquire"),
    )
    assert.ok(!events.some((event) => event.includes("deactivate")))
    assert.ok(!events.some((event) => event.slice(0, 4).join(" ") === "az containerapp job start"))
    assert.ok(!events.some((event) => event[0] === "terraform" && event[2] === "apply"))
  })

  it("redacts child diagnostics and retains the lock warning when lease release fails", async () => {
    const leaseId = "lease-id"
    const privateOutput = `private-credential ${leaseId}`
    const releaseError = Object.assign(new Error(`az --lease-id ${privateOutput}`), {
      stdout: Buffer.from(privateOutput),
      stderr: Buffer.from(privateOutput),
      cause: new Error(privateOutput),
    })
    const { args, events } = installationScenario({ releaseError })
    const output: unknown[][] = []
    mock.method(console, "error", (...args: unknown[]) => output.push(args))
    mock.method(console, "log", (...args: unknown[]) => output.push(args))

    await assert.rejects(deployHub(args), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Azure command failed/)
      assert.equal(error.cause, undefined)
      const rendered = `${error.stack} ${JSON.stringify(error)} ${JSON.stringify(output)}`
      assert.ok(!rendered.includes(leaseId))
      assert.ok(!rendered.includes("private-credential"))
      return true
    })

    assert.ok(events.some((event) => event[0] === "HTTPS"))
    assert.ok(events.some((event) => event.includes("--lease-id") && event.includes(leaseId)))
    assert.match(JSON.stringify(output), /lease is retained/)
    assert.ok(!JSON.stringify(output).includes("maintenance window is complete"))
  })

  it("refuses bootstrap when Terraform state already contains resources", async () => {
    const { args, events } = installationScenario()
    args[0] = "bootstrap"

    await assert.rejects(deployHub(args), /Infrastructure already exists/)

    assert.ok(
      events.some(
        (event) => event[0] === "terraform" && event[2] === "state" && event[3] === "list",
      ),
    )
    assert.ok(!events.some((event) => event[0] === "terraform" && event[2] === "apply"))
  })
})
