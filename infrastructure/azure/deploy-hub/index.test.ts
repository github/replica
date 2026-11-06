import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { afterEach, beforeEach, describe, it, mock } from "node:test"
import timers from "node:timers/promises"
import { inspect } from "node:util"

import { describeCommand } from "../../installer/command/describe/index.ts"
import { deployHub } from "./index.ts"

const terraformRoot = resolve(import.meta.dirname, "..")
let fixtureDirectory: string
let previousDataDirectory: string | undefined
let previousMask: number
let defaultDirectoryExisted: boolean

beforeEach(() => {
  previousDataDirectory = process.env.TF_DATA_DIR
  previousMask = process.umask()
  defaultDirectoryExisted = existsSync(resolve(terraformRoot, ".terraform"))
  fixtureDirectory = resolve(terraformRoot, `.deploy-hub-test-${randomUUID()}`)
  mkdirSync(fixtureDirectory, { mode: 0o700 })
  process.env.TF_DATA_DIR = resolve(fixtureDirectory, "terraform")
})

afterEach(() => {
  mock.restoreAll()
  if (previousDataDirectory === undefined) delete process.env.TF_DATA_DIR
  else process.env.TF_DATA_DIR = previousDataDirectory
  process.umask(previousMask)
  rmSync(fixtureDirectory, { recursive: true, force: true })
  const callerDirectory = resolve(basename(fixtureDirectory))
  if (callerDirectory !== fixtureDirectory)
    rmSync(callerDirectory, { recursive: true, force: true })
  if (!defaultDirectoryExisted)
    rmSync(resolve(terraformRoot, ".terraform"), { recursive: true, force: true })
})

function installationScenario({
  appCreated = true,
  setupStatus = "Succeeded",
  lockAvailable = true,
  releaseError,
  appResponse = {
    properties: {
      latestRevisionName: "test-hub--latest",
      latestReadyRevisionName: "test-hub--latest",
    },
  },
  revisionResponse = { name: "test-hub--latest", properties: { active: true } },
  httpStatuses = [200],
  commandFailure,
  commandOutput,
  onPlan,
}: {
  appCreated?: boolean
  setupStatus?: string
  lockAvailable?: boolean
  releaseError?: Error
  appResponse?: unknown
  revisionResponse?: unknown
  httpStatuses?: number[]
  commandFailure?: { args: string[]; error: Error; occurrence?: number }
  commandOutput?: { args: string[]; stdout: string }
  onPlan?: (path: string) => void
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
  let matchingCommands = 0
  let targeted = false
  function execute(
    file: string,
    args: readonly string[],
    options: childProcess.ExecFileSyncOptions,
  ) {
    const command: string[] = [file, ...args]
    events.push(command)
    commandOptions.push(options)
    if (commandFailure?.args.every((argument, index) => args[index] === argument)) {
      matchingCommands += 1
      if (matchingCommands === (commandFailure.occurrence ?? 1)) throw commandFailure.error
    }
    if (file === "az" && commandOutput?.args.every((argument, index) => args[index] === argument))
      return commandOutput.stdout
    if (file === "terraform") {
      switch (args[1]) {
        case "output":
          return JSON.stringify(installation)
        case "state":
          return appCreated ? "azurerm_container_app.hub[0]" : ""
        case "plan":
          targeted = args.some((argument: string) => argument.startsWith("-target="))
          onPlan?.(args.find((argument) => argument.startsWith("-out="))!.slice(5))
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
        return ""
      case "containerapp revision list": {
        const revisions = [
          { name: "old-active", properties: { active: true } },
          { name: "old-terminating", properties: { active: false } },
        ]
        return JSON.stringify(
          args.includes("--all")
            ? revisions
            : revisions.filter((revision) => revision.properties.active),
        )
      }
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
        return ""
      case "containerapp revision show":
        return JSON.stringify(revisionResponse)
      default:
        if (args.slice(0, 2).join(" ") === "containerapp show") {
          return JSON.stringify(appResponse)
        }
        throw new Error(`Unexpected Azure command: ${command.join(" ")}`)
    }
  }
  mock.method(childProcess, "execFileSync", execute)
  mock.method(timers, "setTimeout", async () => undefined)
  let readinessRequests = 0
  mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    events.push(["HTTPS", String(url)])
    const status = httpStatuses[Math.min(readinessRequests, httpStatuses.length - 1)]
    readinessRequests += 1
    return new Response(null, { status })
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
  for (const dataDirectory of ["relative", "absolute", "empty", "unset"]) {
    it(`keeps sensitive plans in Terraform's data directory when TF_DATA_DIR is ${dataDirectory}`, async () => {
      if (dataDirectory === "relative")
        process.env.TF_DATA_DIR = `${basename(fixtureDirectory)}/relative`
      else if (dataDirectory === "empty") process.env.TF_DATA_DIR = ""
      else if (dataDirectory === "unset") delete process.env.TF_DATA_DIR
      const expectedDirectory =
        dataDirectory === "relative"
          ? resolve(fixtureDirectory, "relative")
          : dataDirectory === "absolute"
            ? resolve(fixtureDirectory, "terraform")
            : resolve(terraformRoot, ".terraform")
      const directoryExisted = existsSync(expectedDirectory)
      const planFiles: { path: string; directoryMode: number; fileMode: number }[] = []
      const { args, events } = installationScenario({
        onPlan(path) {
          writeFileSync(path, "synthetic-sensitive-plan")
          planFiles.push({
            path,
            directoryMode: statSync(dirname(path)).mode & 0o777,
            fileMode: statSync(path).mode & 0o777,
          })
        },
      })
      process.umask(0o022)

      await deployHub(args)

      assert.equal(process.umask(), 0o022)
      assert.equal(planFiles.length, 2)
      for (const { path, directoryMode, fileMode } of planFiles) {
        assert.equal(dirname(path), expectedDirectory)
        if (!directoryExisted) assert.equal(directoryMode, 0o700)
        assert.equal(fileMode, 0o600)
        assert.equal(existsSync(path), false)
      }
      assert.ok(
        events
          .filter((event) => event[0] === "terraform")
          .every((event) => event[1] === `-chdir=${terraformRoot}`),
      )
    })
  }

  it("deletes a sensitive saved plan and restores the umask after plan inspection fails", async () => {
    let planPath: string | undefined
    const { args } = installationScenario({
      onPlan(path) {
        planPath = path
        writeFileSync(path, "synthetic-sensitive-plan")
      },
      commandFailure: {
        args: [`-chdir=${terraformRoot}`, "show"],
        error: new Error("Synthetic plan inspection failure"),
      },
    })
    mock.method(console, "error", () => undefined)
    process.umask(0o022)

    await assert.rejects(deployHub(args), /Terraform command failed/)

    assert.ok(planPath)
    assert.equal(existsSync(planPath), false)
    assert.equal(process.umask(), 0o022)
  })

  it("drains all old revisions and completes setup before rollout, readiness, and lease release", async () => {
    const { args, events, replicaReads, commandOptions } = installationScenario()
    const output: unknown[][] = []
    mock.method(console, "error", (...args: unknown[]) => output.push(args))
    const completion = mock.method(console, "log", () => events.push(["complete"]))

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
    const inspected = events.findIndex(
      (event) => event.slice(0, 4).join(" ") === "az containerapp revision show",
    )
    assert.ok(inspected > rolloutApplied)
    assert.equal(events[inspected][events[inspected].indexOf("--revision") + 1], "test-hub--latest")
    assert.ok(!events.some((event) => event.includes("activate")))
    const ready = events.findIndex((event) => event[0] === "HTTPS")
    const release = events.findIndex(
      (event) => event.slice(0, 5).join(" ") === "az storage blob lease release",
    )
    assert.deepEqual(events[ready], ["HTTPS", "https://hub.example.com/api/ready"])
    assert.ok(ready > inspected)
    assert.ok(
      events.some(
        (event, index) =>
          index > inspected &&
          index < ready &&
          event.slice(0, 3).join(" ") === "az containerapp show",
      ),
    )
    assert.ok(release > ready)
    assert.equal(completion.mock.callCount(), 1)
    assert.ok(events.findIndex((event) => event[0] === "complete") > release)
    assert.doesNotMatch(JSON.stringify(output), /lease is retained/)
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

  it("runs setup before the first Hub app and verifies its already-active revision without activating it again", async () => {
    const { args, events } = installationScenario({ appCreated: false, httpStatuses: [503, 200] })
    mock.method(console, "warn", () => undefined)

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
    const inspected = events.filter(
      (event) => event.slice(0, 4).join(" ") === "az containerapp revision show",
    )
    assert.equal(inspected.length, 1)
    assert.equal(inspected[0][inspected[0].indexOf("--revision") + 1], "test-hub--latest")
    assert.ok(!events.some((event) => event.includes("activate")))
    const ready = events.findIndex((event) => event[0] === "HTTPS")
    const readinessRequests = events.filter((event) => event[0] === "HTTPS")
    const release = events.findIndex(
      (event) => event.slice(0, 5).join(" ") === "az storage blob lease release",
    )
    assert.ok(ready > events.indexOf(inspected[0]))
    assert.equal(readinessRequests.length, 2)
    assert.ok(release > events.indexOf(readinessRequests[1]))
  })

  it("activates an inactive latest revision only after successful setup and the full rollout apply", async () => {
    const { args, events } = installationScenario({
      revisionResponse: { name: "test-hub--latest", properties: { active: false } },
    })

    await deployHub(args)

    const setupSucceeded = events.findIndex(
      (event) => event.slice(0, 5).join(" ") === "az containerapp job execution show",
    )
    const rollout = events.findIndex(
      (event) =>
        event[0] === "terraform" &&
        event[2] === "plan" &&
        !event.some((argument) => argument.startsWith("-target=")),
    )
    const applied = events.findIndex(
      (event, index) => index > rollout && event[0] === "terraform" && event[2] === "apply",
    )
    const inspections = events.filter(
      (event) => event.slice(0, 4).join(" ") === "az containerapp revision show",
    )
    const activations = events.filter(
      (event) => event.slice(0, 4).join(" ") === "az containerapp revision activate",
    )
    assert.equal(inspections.length, 1)
    assert.equal(activations.length, 1)
    for (const event of [...inspections, ...activations]) {
      assert.equal(event[event.indexOf("--revision") + 1], "test-hub--latest")
    }
    assert.ok(setupSucceeded >= 0)
    assert.ok(rollout > setupSucceeded)
    assert.ok(applied > rollout)
    assert.ok(events.indexOf(inspections[0]) > applied)
    assert.ok(events.indexOf(activations[0]) > events.indexOf(inspections[0]))
    const ready = events.findIndex((event) => event[0] === "HTTPS")
    const released = events.findIndex(
      (event) => event.slice(0, 5).join(" ") === "az storage blob lease release",
    )
    assert.ok(ready > events.indexOf(activations[0]))
    assert.ok(released > ready)
  })

  for (const { name, scenario, inspectRevision } of [
    {
      name: "missing latest revision name",
      scenario: { appResponse: { properties: {} } },
      inspectRevision: false,
    },
    {
      name: "non-string latest revision name",
      scenario: {
        appResponse: { properties: { latestRevisionName: 17, latestReadyRevisionName: 17 } },
      },
      inspectRevision: false,
    },
    {
      name: "empty latest revision name",
      scenario: {
        appResponse: { properties: { latestRevisionName: "", latestReadyRevisionName: "" } },
      },
      inspectRevision: false,
    },
    {
      name: "whitespace-only latest revision name",
      scenario: {
        appResponse: { properties: { latestRevisionName: " ", latestReadyRevisionName: " " } },
        revisionResponse: { name: " ", properties: { active: false } },
      },
      inspectRevision: false,
    },
    {
      name: "latest revision name containing whitespace",
      scenario: {
        appResponse: {
          properties: {
            latestRevisionName: "test-hub--latest\nprivate-value",
            latestReadyRevisionName: "test-hub--latest\nprivate-value",
          },
        },
        revisionResponse: {
          name: "test-hub--latest\nprivate-value",
          properties: { active: false },
        },
      },
      inspectRevision: false,
    },
    {
      name: "mismatched inactive revision response",
      scenario: { revisionResponse: { name: "old-active", properties: { active: false } } },
      inspectRevision: true,
    },
    {
      name: "missing activation state",
      scenario: { revisionResponse: { name: "test-hub--latest", properties: {} } },
      inspectRevision: true,
    },
    {
      name: "non-boolean activation state",
      scenario: {
        revisionResponse: { name: "test-hub--latest", properties: { active: "false" } },
      },
      inspectRevision: true,
    },
    {
      name: "absent revision response",
      scenario: { revisionResponse: null },
      inspectRevision: true,
    },
  ]) {
    it(`retains the lease without activation or readiness when Azure returns ${name}`, async () => {
      const { args, events } = installationScenario(scenario)
      const output: unknown[][] = []
      mock.method(console, "error", (...args: unknown[]) => output.push(args))
      const completion = mock.method(console, "log", (...args: unknown[]) => output.push(args))

      await assert.rejects(deployHub(args), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.cause, undefined)
        const rendered = inspect([error, output], { depth: 10, showHidden: true })
        assert.ok(!rendered.includes("test-hub"))
        assert.ok(!rendered.includes("private-value"))
        return true
      })

      const revisionInspections = events.filter(
        (event) => event.slice(0, 4).join(" ") === "az containerapp revision show",
      )
      assert.equal(revisionInspections.length, inspectRevision ? 1 : 0)
      assert.ok(!events.some((event) => event.includes("activate")))
      assert.ok(!events.some((event) => event[0] === "HTTPS"))
      assert.ok(!events.some((event) => event.includes("release")))
      assert.match(JSON.stringify(output), /lease is retained/)
      assert.equal(completion.mock.callCount(), 0)
    })
  }

  for (const failure of [
    { name: "revision inspection", args: ["containerapp", "revision", "show"], active: true },
    { name: "revision activation", args: ["containerapp", "revision", "activate"], active: false },
    {
      name: "Azure readiness inspection of an active revision",
      args: ["containerapp", "show"],
      occurrence: 2,
      active: true,
    },
  ]) {
    it(`reports safe operation and status and stops after a genuine ${failure.name} failure`, async () => {
      const privateOutput = "synthetic-private-child-output"
      const childError = Object.assign(new Error(privateOutput), {
        status: 17,
        stdout: Buffer.from(privateOutput),
        stderr: Buffer.from(privateOutput),
        cause: new Error(privateOutput),
      })
      const { args, events } = installationScenario({
        revisionResponse: { name: "test-hub--latest", properties: { active: failure.active } },
        commandFailure: { ...failure, error: childError },
      })
      const output: unknown[][] = []
      mock.method(console, "error", (...args: unknown[]) => output.push(args))
      const completion = mock.method(console, "log", (...args: unknown[]) => output.push(args))

      await assert.rejects(deployHub(args), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(describeCommand("az", failure.args).label))
        assert.match(error.message, /\bexit(?:ed with)?(?: code| status)?[: ]+17\b/i)
        assert.equal(error.cause, undefined)
        const rendered = inspect([error, output], { depth: 10, showHidden: true })
        for (const value of [
          privateOutput,
          "lease-id",
          "test-subscription",
          "test-hub",
          "hub.example.com",
        ]) {
          assert.ok(!rendered.includes(value))
        }
        return true
      })

      assert.ok(
        events.some((event) => event.slice(0, 5).join(" ") === "az storage blob lease acquire"),
      )
      assert.equal(
        events.filter((event) => event.slice(0, 4).join(" ") === "az containerapp job start")
          .length,
        1,
      )
      assert.equal(
        events.filter((event) => event[0] === "terraform" && event[2] === "apply").length,
        2,
      )
      assert.equal(
        events.filter((event) =>
          failure.args.every((argument, index) => event[index + 1] === argument),
        ).length,
        failure.occurrence ?? 1,
      )
      assert.equal(
        events.filter((event) => event.includes("activate")).length,
        failure.active ? 0 : 1,
      )
      assert.ok(!events.some((event) => event[0] === "HTTPS"))
      assert.ok(!events.some((event) => event.includes("release")))
      assert.match(JSON.stringify(output), /lease is retained/)
      assert.equal(completion.mock.callCount(), 0)
    })
  }

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

  for (const response of [
    {
      name: "empty lease acquisition output",
      args: ["storage", "blob", "lease", "acquire"],
      stdout: "",
      retainsLease: false,
    },
    {
      name: "malformed job start output",
      args: ["containerapp", "job", "start"],
      stdout:
        'synthetic-private-output {"credential":"synthetic-private-credential","lease":"lease-id"}',
      retainsLease: true,
    },
  ]) {
    it(`rejects ${response.name} with a safe operation label and no deployment completion`, async () => {
      const { args, events } = installationScenario({ commandOutput: response })
      const output: unknown[][] = []
      mock.method(console, "error", (...args: unknown[]) => output.push(args))
      const completion = mock.method(console, "log", (...args: unknown[]) => output.push(args))

      await assert.rejects(deployHub(args), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(describeCommand("az", response.args).label))
        assert.equal(error.cause, undefined)
        const rendered = inspect([error, output], { depth: 10, showHidden: true })
        for (const value of [
          "synthetic-private-output",
          "synthetic-private-credential",
          "lease-id",
          "test-subscription",
          "test-hub",
          "hub.example.com",
        ])
          assert.ok(!rendered.includes(value))
        return true
      })

      assert.ok(
        events.some((event) =>
          response.args.every((argument, index) => event[index + 1] === argument),
        ),
      )
      assert.equal(
        events.filter((event) => event.slice(0, 4).join(" ") === "az containerapp job start")
          .length,
        response.retainsLease ? 1 : 0,
      )
      assert.equal(
        events.filter((event) => event[0] === "terraform" && event[2] === "apply").length,
        response.retainsLease ? 1 : 0,
      )
      assert.equal(JSON.stringify(output).includes("lease is retained"), response.retainsLease)
      assert.ok(!events.some((event) => event.includes("activate")))
      assert.ok(!events.some((event) => event[0] === "HTTPS"))
      assert.ok(!events.some((event) => event.includes("release")))
      assert.equal(completion.mock.callCount(), 0)
    })
  }

  it("redacts child diagnostics and retains the lock warning when lease release fails", async () => {
    const leaseId = "lease-id"
    const privateOutput = `private-credential ${leaseId}`
    const releaseError = Object.assign(new Error(`az --lease-id ${privateOutput}`), {
      status: 23,
      stdout: Buffer.from(privateOutput),
      stderr: Buffer.from(privateOutput),
      cause: new Error(privateOutput),
    })
    const { args, events } = installationScenario({ releaseError })
    const output: unknown[][] = []
    mock.method(console, "error", (...args: unknown[]) => output.push(args))
    const completion = mock.method(console, "log", (...args: unknown[]) => output.push(args))

    await assert.rejects(deployHub(args), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.ok(
        error.message.includes(
          describeCommand("az", ["storage", "blob", "lease", "release"]).label,
        ),
      )
      assert.match(error.message, /\bexit(?:ed with)?(?: code| status)?[: ]+23\b/i)
      assert.equal(error.cause, undefined)
      const rendered = inspect([error, output], { depth: 10, showHidden: true })
      assert.ok(!rendered.includes(leaseId))
      assert.ok(!rendered.includes("private-credential"))
      return true
    })

    assert.ok(events.some((event) => event[0] === "HTTPS"))
    assert.ok(events.some((event) => event.includes("--lease-id") && event.includes(leaseId)))
    assert.match(JSON.stringify(output), /lease is retained/)
    assert.equal(completion.mock.callCount(), 0)
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

  it("completes confirmed teardown after a successful blob deletion with empty output", async () => {
    const { args, events } = installationScenario({
      appCreated: false,
      commandOutput: { args: ["storage", "blob", "delete"], stdout: "" },
    })
    args[0] = "destroy"
    args.push("--confirm", "test-hub")
    mock.method(console, "log", () => events.push(["complete"]))

    await deployHub(args)

    const plan = events.findIndex((event) => event[0] === "terraform" && event[2] === "plan")
    const deleted = events.findIndex(
      (event) => event.slice(0, 4).join(" ") === "az storage blob delete",
    )
    const applied = events.findIndex((event) => event[0] === "terraform" && event[2] === "apply")
    assert.ok(plan >= 0 && events[plan].includes("-destroy"))
    assert.ok(deleted > plan)
    assert.ok(applied > deleted)
    assert.ok(events.findIndex((event) => event[0] === "complete") > applied)
    assert.ok(!events.some((event) => event.includes("release") || event.includes("activate")))
    assert.ok(!events.some((event) => event.slice(0, 4).join(" ") === "az containerapp job start"))
    assert.ok(!events.some((event) => event[0] === "HTTPS"))
  })
})
