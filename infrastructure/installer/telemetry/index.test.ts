import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat } from "node:fs/promises"
import http from "node:http"
import https from "node:https"
import { dirname, join, relative, resolve } from "node:path"
import { trace } from "@opentelemetry/api"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../command/index.ts"
import type { InstallerUI, RunCommand, WizardUI } from "../types.ts"
import { startInstallerTelemetry } from "./index.ts"

type Telemetry = Awaited<ReturnType<typeof startInstallerTelemetry>>
interface Record {
  event: string
  name: string
  trace_id: string
  span_id: string
  parent_span_id?: string
  duration_ms?: number
  status?: "ok" | "error"
  attributes: { [key: string]: unknown }
}

const directories: string[] = []
const sessions: Telemetry[] = []

async function target() {
  const directory = resolve(`.installer-telemetry-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  return join(directory, "installation.json")
}

async function start(configPath: string) {
  const telemetry = await startInstallerTelemetry(configPath)
  sessions.push(telemetry)
  return telemetry
}

async function records(path: string): Promise<Record[]> {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record)
}

function completed(entries: Record[], name: string) {
  const matches = entries.filter((entry) => entry.event === "span.completed" && entry.name === name)
  expect(matches).toHaveLength(1)
  return matches[0]!
}

afterEach(async () => {
  try {
    await Promise.all(sessions.splice(0).map((telemetry) => telemetry.close()))
  } finally {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    )
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  }
})

describe("private installer telemetry", () => {
  it("uses a private per-run file beside the selected config and closes only once without replacing the global provider", async () => {
    const configPath = await target()
    const otherConfig = await target()
    const provider = trace.getTracerProvider()
    const telemetry = await start(relative(process.cwd(), configPath))
    const nextRun = await start(configPath)
    const otherRun = await start(otherConfig)

    expect(dirname(telemetry.path)).toBe(join(dirname(configPath), "logs"))
    expect(dirname(nextRun.path)).toBe(dirname(telemetry.path))
    expect(dirname(otherRun.path)).toBe(join(dirname(otherConfig), "logs"))
    expect(new Set([telemetry.path, nextRun.path, otherRun.path]).size).toBe(3)
    expect((await stat(dirname(telemetry.path))).mode & 0o777).toBe(0o700)
    expect((await stat(telemetry.path)).mode & 0o777).toBe(0o600)
    expect(trace.getTracerProvider()).toBe(provider)

    await telemetry.close()
    const saved = await readFile(telemetry.path, "utf8")
    await telemetry.close(new Error("A second close must not change the result"))

    expect(await readFile(telemetry.path, "utf8")).toBe(saved)
    expect(completed(await records(telemetry.path), "installer.run").status).toBe("ok")
    await nextRun.close()
    await otherRun.close()
    expect(trace.getTracerProvider()).toBe(provider)
  })

  it("correlates commands with their phases and marks the active phase and root failed on close", async () => {
    const telemetry = await start(await target())
    const ui: InstallerUI = {
      status: vi.fn(),
      phase: vi.fn(),
      confirm: vi.fn(async () => true),
      wait: vi.fn(async () => undefined),
    }
    const observed = telemetry.observe(ui)
    const failure = new CommandExecutionError("Synthetic command failure", false, 23)
    const runner = vi.fn<RunCommand>(async (executable) => {
      if (executable === "terraform") throw failure
      return "created"
    })
    const run = telemetry.command(runner)
    const args = ["storage", "account", "create", "--name", "synthetic-account"]
    const options = { label: "Create state storage", env: { SYNTHETIC_OPTION: "value" } }

    await observed.phase?.("checks")
    await observed.phase?.("provision")
    await expect(run("az", args, options)).resolves.toBe("created")
    await expect(run("terraform", ["apply"])).rejects.toBe(failure)
    await telemetry.close(failure)

    expect(runner).toHaveBeenNthCalledWith(1, "az", args, options)
    expect(runner).toHaveBeenCalledTimes(2)
    expect(runner.mock.calls[1]!.slice(0, 2)).toEqual(["terraform", ["apply"]])
    expect(ui.phase).toHaveBeenNthCalledWith(1, "checks")
    expect(ui.phase).toHaveBeenNthCalledWith(2, "provision")
    const entries = await records(telemetry.path)
    const root = completed(entries, "installer.run")
    const checks = completed(entries, "installer.phase.checks")
    const provision = completed(entries, "installer.phase.provision")
    const success = completed(entries, "installer.command.az.storage.account.create")
    const failed = completed(entries, "installer.command.terraform.apply")

    expect(root.status).toBe("error")
    expect(checks.status).toBe("ok")
    expect(provision.status).toBe("error")
    expect(success.status).toBe("ok")
    expect(failed.status).toBe("error")
    expect(failed.attributes).toMatchObject({ exit_code: 23, outcome: "failed" })
    for (const phase of [checks, provision]) expect(phase.parent_span_id).toBe(root.span_id)
    for (const command of [success, failed]) expect(command.parent_span_id).toBe(provision.span_id)
    const spans = [root, checks, provision, success, failed]
    expect(new Set(spans.map((span) => span.span_id)).size).toBe(spans.length)
    for (const span of spans) {
      expect(span.trace_id).toBe(root.trace_id)
      expect(span.trace_id).toMatch(/^[a-f0-9]{32}$/)
      expect(span.span_id).toMatch(/^[a-f0-9]{16}$/)
      expect(span.duration_ms).toEqual(expect.any(Number))
      expect(span.duration_ms).toBeGreaterThanOrEqual(0)
    }
  })

  it("persists a correlated started breadcrumb while a command is still pending", async () => {
    const telemetry = await start(await target())
    const entered = Promise.withResolvers<void>()
    const result = Promise.withResolvers<string>()
    const run = telemetry.command(async () => {
      entered.resolve()
      return result.promise
    })
    const pending = run("az", ["storage", "account", "create"])

    try {
      await entered.promise
      const entries = await records(telemetry.path)
      const root = entries.find(
        (entry) => entry.event === "step.started" && entry.name === "installer.run",
      )
      const command = entries.find(
        (entry) =>
          entry.event === "step.started" &&
          entry.name === "installer.command.az.storage.account.create",
      )
      expect(root).toBeDefined()
      expect(command).toMatchObject({
        trace_id: root!.trace_id,
        parent_span_id: root!.span_id,
      })
      expect(command!.span_id).toMatch(/^[a-f0-9]{16}$/)
      expect(entries.some((entry) => entry.event === "span.completed")).toBe(false)
    } finally {
      result.resolve("ready")
      await pending
    }
    await telemetry.close()

    const entries = await records(telemetry.path)
    const started = entries.find(
      (entry) =>
        entry.event === "step.started" &&
        entry.name === "installer.command.az.storage.account.create",
    )!
    expect(completed(entries, started.name)).toMatchObject({
      trace_id: started.trace_id,
      span_id: started.span_id,
      parent_span_id: started.parent_span_id,
      status: "ok",
    })
  })

  it("preserves UI calls and results while recording pending, completed, and rejected prompt lifetimes", async () => {
    const telemetry = await start(await target())
    const entered = Promise.withResolvers<void>()
    const answer = Promise.withResolvers<string>()
    const failure = new Error("Synthetic prompt failure")
    const ui: WizardUI = {
      status: vi.fn(),
      notice: vi.fn(),
      welcome: vi.fn(),
      complete: vi.fn(),
      cloud: vi.fn(async () => "azure" as const),
      text: vi.fn(async () => {
        entered.resolve()
        return answer.promise
      }),
      field: vi.fn(async () => "field answer"),
      select: vi.fn(async () => "selected value"),
      confirm: vi.fn(async () => {
        throw failure
      }),
      wait: vi.fn(async () => undefined),
    }
    const observed = telemetry.observe(ui)
    const pending = observed.text("Question", "Initial answer")
    let prompt: Record
    try {
      await entered.promise
      const entries = await records(telemetry.path)
      const prompts = entries.filter(
        (entry) => entry.event === "step.started" && entry.name !== "installer.run",
      )
      expect(prompts).toHaveLength(1)
      prompt = prompts[0]!
      expect(entries.some((entry) => entry.event === "span.completed")).toBe(false)
    } finally {
      answer.resolve("accepted answer")
      await pending
    }

    await expect(pending).resolves.toBe("accepted answer")
    observed.status("Activity")
    observed.notice?.("warning", "Notice")
    observed.welcome?.(true)
    observed.complete?.()
    await expect(observed.cloud()).resolves.toBe("azure")
    const field = {
      id: "owner",
      label: "Owner",
      help: "Help",
      parse: (value: unknown) => String(value),
    }
    await expect(observed.field?.(field, "original")).resolves.toBe("field answer")
    const choices = [{ label: "Choice", value: "selected value" }]
    await expect(observed.select("Select", choices)).resolves.toBe("selected value")
    await expect(observed.wait("Wait")).resolves.toBeUndefined()
    await expect(observed.confirm("Confirm")).rejects.toBe(failure)
    await telemetry.close(failure)

    expect(ui.text).toHaveBeenCalledWith("Question", "Initial answer")
    expect(ui.status).toHaveBeenCalledWith("Activity")
    expect(ui.notice).toHaveBeenCalledWith("warning", "Notice")
    expect(ui.welcome).toHaveBeenCalledWith(true)
    expect(ui.complete).toHaveBeenCalledOnce()
    expect(ui.field).toHaveBeenCalledWith(field, "original")
    expect(ui.select).toHaveBeenCalledWith("Select", choices)
    expect(ui.wait).toHaveBeenCalledWith("Wait")
    expect(ui.confirm).toHaveBeenCalledWith("Confirm")
    const entries = await records(telemetry.path)
    const prompts = entries.filter(
      (entry) => entry.event === "span.completed" && entry.name !== "installer.run",
    )
    expect(prompts).toHaveLength(6)
    expect(prompts.filter((entry) => entry.status === "error")).toHaveLength(1)
    expect(completed(entries, prompt!.name)).toMatchObject({
      span_id: prompt!.span_id,
      trace_id: prompt!.trace_id,
      status: "ok",
    })
  })

  it("never persists command or UI secrets or enables environment-driven network export, including on cancellation", async () => {
    const secret = {
      argv: "synthetic-argv-secret",
      env: "synthetic-environment-secret",
      label: "synthetic-label-secret",
      stdout: "synthetic-stdout-secret",
      stderr: "synthetic-stderr-secret",
      error: "synthetic-error-secret",
      executable: "synthetic-executable-secret",
      subcommand: "synthetic-subcommand-secret",
      message: "synthetic-ui-message-secret",
      answer: "synthetic-answer-secret",
      choice: "synthetic-choice-secret",
      fieldId: "synthetic-field-id-secret",
      endpoint: "synthetic-otel-endpoint-secret",
      headers: "synthetic-otel-header-secret",
      resource: "synthetic-otel-resource-secret",
      service: "synthetic-otel-service-secret",
    }
    vi.stubEnv("OTEL_TRACES_EXPORTER", "otlp")
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", `http://127.0.0.1:1/${secret.endpoint}`)
    vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", `authorization=Bearer ${secret.headers}`)
    vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", `private.value=${secret.resource}`)
    vi.stubEnv("OTEL_SERVICE_NAME", secret.service)
    vi.stubEnv("REPLICA_TELEMETRY_SECRET", secret.env)
    const refuseNetwork = () => {
      throw new Error("Telemetry must not open a network connection")
    }
    const httpRequest = vi.spyOn(http, "request").mockImplementation(refuseNetwork)
    const httpsRequest = vi.spyOn(https, "request").mockImplementation(refuseNetwork)
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(refuseNetwork)
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    const telemetry = await start(await target())
    const cancellation = new CommandExecutionError(`${secret.stderr}: ${secret.error}`, true)
    Object.assign(cancellation, { cause: new Error(secret.env), output: secret.stdout })
    const run = telemetry.command(async (executable) => {
      if (executable === secret.executable) throw cancellation
      return secret.stdout
    })
    const ui: WizardUI = {
      status: vi.fn(),
      notice: vi.fn(),
      phase: vi.fn(),
      cloud: vi.fn(async () => "azure" as const),
      text: vi.fn(async () => secret.answer),
      field: vi.fn(async () => secret.answer),
      select: vi.fn(async () => secret.choice),
      confirm: vi.fn(async () => {
        throw new Error(secret.error)
      }),
      wait: vi.fn(async () => undefined),
    }
    const observed = telemetry.observe(ui)
    await observed.phase?.("configure")
    observed.status(secret.message)
    observed.notice?.("error", secret.message)
    await observed.cloud()
    await observed.text(secret.message, secret.answer)
    const field = {
      id: "npmRegistry",
      label: secret.message,
      help: secret.message,
      parse: () => secret.answer,
    }
    await observed.field?.(field, secret.answer)
    await observed.field?.({ ...field, id: secret.fieldId }, secret.answer)
    await observed.select(secret.message, [{ label: secret.message, value: secret.choice }])
    await observed.wait(secret.message)
    await expect(observed.confirm(secret.message)).rejects.toThrow(secret.error)
    await expect(
      run("az", ["storage", "account", "create", "--name", secret.argv], {
        label: secret.label,
        env: { SYNTHETIC_SECRET: secret.env },
      }),
    ).resolves.toBe(secret.stdout)
    await expect(
      run(secret.executable, [secret.subcommand, secret.argv], { label: secret.label }),
    ).rejects.toBe(cancellation)
    await telemetry.close(cancellation)

    const saved = await readFile(telemetry.path, "utf8")
    for (const value of Object.values(secret)) expect(saved).not.toContain(value)
    const entries = await records(telemetry.path)
    expect(completed(entries, "installer.command.az.storage.account.create").status).toBe("ok")
    const cancelled = completed(entries, "installer.command.other")
    expect(cancelled.status).toBe("error")
    expect(JSON.stringify(cancelled.attributes)).toMatch(/cancel|abort/i)
    expect(completed(entries, "installer.phase.configure").status).toBe("error")
    expect(completed(entries, "installer.run").status).toBe("error")
    for (const entry of entries.filter((entry) => entry.event === "span.completed")) {
      expect(entry.attributes).toEqual(expect.any(Object))
      for (const key of Object.keys(entry.attributes)) {
        expect(key).not.toMatch(
          /exception|stack|message|argv|env|stdout|stderr|label|answer|value|path/i,
        )
      }
    }
    expect(httpRequest).not.toHaveBeenCalled()
    expect(httpsRequest).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })
})
