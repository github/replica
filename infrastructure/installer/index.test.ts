import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { expect, it, vi } from "vitest"

import type { DeploymentConfig, WizardUI } from "./types.ts"

it("keeps synthetic command diagnostics out of unattended CLI output and local telemetry", async () => {
  const directory = resolve(`.installer-cli-test-${randomUUID()}`)
  await mkdir(directory, { mode: 0o700 })
  const configPath = join(directory, "installation.json")
  const secret = "synthetic-unattended-stderr-secret"
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      cloud: "azure",
      name: "test-hub",
      owner: "platform-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000001",
        tenantId: "00000000-0000-0000-0000-000000000002",
        location: "eastus2",
        resourceGroup: "test-hub-rg",
      },
    }),
    { mode: 0o600 },
  )
  const commands = join(directory, "offline-commands.mjs")
  await writeFile(
    commands,
    `
    import { createRequire, syncBuiltinESMExports } from "node:module";
    const childProcess = createRequire(import.meta.url)("node:child_process");
    const spawn = childProcess.spawn;
    const programs = ${JSON.stringify({
      az: `process.stderr.write(${JSON.stringify(secret)}, () => process.exit(37))`,
      terraform: 'process.stdout.write(JSON.stringify({ terraform_version: "1.17.1" }))',
      docker: "process.exit(0)",
    })};
    childProcess.spawn = (executable, args, options) => {
      if (!Object.hasOwn(programs, executable)) throw new Error("Unexpected offline command");
      return spawn(process.execPath, ["--eval", programs[executable]], options);
    };
    syncBuiltinESMExports();
  `,
    { mode: 0o600 },
  )
  const draft = `${configPath}.draft.json`
  const draftContents = "synthetic draft that unattended execution must not consume\n"
  await writeFile(draft, draftContents, { mode: 0o600 })

  try {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        commands,
        "installer/index.tsx",
        "--config",
        configPath,
        "--non-interactive",
        "--approve-deployment",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: "", TSX_DISABLE_CACHE: "1" },
        encoding: "utf8",
        timeout: 15_000,
      },
    )

    expect(child.error).toBeUndefined()
    expect(child.status).not.toBe(0)
    expect(child.signal).toBeNull()
    const output = `${child.stdout}\n${child.stderr}`
    expect(output).toMatch(/Azure|failed|prerequisite/i)
    expect(output).not.toContain(secret)
    const logs = join(directory, "logs")
    const files = await readdir(logs)
    expect(files.length).toBeGreaterThan(0)
    const telemetry = (
      await Promise.all(files.map((filename) => readFile(join(logs, filename), "utf8")))
    ).join("\n")
    expect(telemetry).not.toContain(secret)
    const records = telemetry
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string
            status?: string
            attributes?: { exit_code?: number }
          },
      )
    expect(records).toContainEqual(
      expect.objectContaining({
        event: "span.completed",
        status: "error",
        attributes: expect.objectContaining({ exit_code: 37 }),
      }),
    )
    expect(await readFile(draft, "utf8")).toBe(draftContents)
    expect(await readdir(directory)).not.toContain("installation.json.draft.json.lock")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it.each(["exit", "create"] as const)(
  "runs the actual CLI entry %s before local writers, diagnostics, or commands",
  async (action) => {
    vi.resetModules()
    const directory = resolve(`.installer-cli-entry-test-${randomUUID()}`)
    await mkdir(directory, { mode: 0o700 })
    const path = join(directory, "new.json")
    const argv = process.argv
    const exitCode = process.exitCode
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    const events: string[] = []
    try {
      process.argv = [process.execPath, resolve("installer/index.tsx"), "--config", path]
      process.exitCode = undefined
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: true,
      })
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: true,
      })
      const entry = await import("./entry/index.ts")
      const terminal = await import("./terminal/index.tsx")
      const session = await import("./session/index.ts")
      const telemetry = await import("./telemetry/index.ts")
      const command = await import("./command/index.ts")
      const wizard = await import("./wizard/index.ts")
      const select = entry.selectInstallerEntry
      const open = session.openSession
      const validate = entry.validateInstallerEntry
      const startTelemetry = telemetry.startInstallerTelemetry
      const ui: WizardUI & { close(): Promise<void>; summary(): undefined } = {
        cloud: vi.fn(),
        text: vi.fn(),
        confirm: vi.fn(),
        wait: vi.fn(),
        status: vi.fn(),
        welcome: vi.fn(),
        select: vi.fn<WizardUI["select"]>(async (_message, options) => {
          events.push("entry menu")
          expect(options.map(({ value }) => value)).toContain(action)
          expect(await readdir(directory)).toEqual([])
          return action
        }),
        close: vi.fn(async () => {
          events.push("terminal restored")
        }),
        summary: () => undefined,
      }
      let controller: AbortController | undefined
      vi.spyOn(terminal, "createTerminalUI").mockImplementation((abort) => {
        controller = abort
        return ui
      })
      vi.spyOn(entry, "selectInstallerEntry").mockImplementation(async (terminalUI, options) => {
        expect(options.configPath).toBe(path)
        return select(terminalUI, { ...options, directory })
      })
      const writer = vi.spyOn(session, "openSession").mockImplementation(async (...args) => {
        events.push("writer opened")
        return open(...args)
      })
      const validation = vi
        .spyOn(entry, "validateInstallerEntry")
        .mockImplementation(async (...args) => {
          await validate(...args)
          events.push("selection validated")
        })
      const diagnostics = vi
        .spyOn(telemetry, "startInstallerTelemetry")
        .mockImplementation(async (...args) => {
          events.push("diagnostics started")
          return startTelemetry(...args)
        })
      const run = vi.spyOn(command, "runCommand").mockImplementation(async () => {
        throw new Error("Startup test must not invoke a real command")
      })
      const questionnaire = vi.spyOn(wizard, "runWizard").mockImplementation(async (options) => {
        events.push("questionnaire")
        expect(options.entryAction).toBe("create")
        expect(options.path).toBe(path)
        expect(options.existing).toBeUndefined()
        expect(options.session?.draft).toBeUndefined()
        expect(controller).toBeInstanceOf(AbortController)
        expect(options.signal).toBe(controller!.signal)
        return "Synthetic questionnaire completed"
      })
      const output = vi.spyOn(console, "log").mockImplementation(() => {
        events.push("shell report")
      })
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)

      await import("./index.tsx")

      expect(process.exitCode ?? 0).toBe(0)
      expect(run).not.toHaveBeenCalled()
      expect(ui.close).toHaveBeenCalledOnce()
      expect(events.indexOf("shell report")).toBeGreaterThan(events.indexOf("terminal restored"))
      if (action === "exit") {
        expect(events).toEqual(["entry menu", "terminal restored", "shell report"])
        expect(writer).not.toHaveBeenCalled()
        expect(validation).not.toHaveBeenCalled()
        expect(diagnostics).not.toHaveBeenCalled()
        expect(questionnaire).not.toHaveBeenCalled()
        expect(errors).not.toHaveBeenCalled()
        expect(output).toHaveBeenCalledWith(expect.stringMatching(/exited|no local files/i))
        expect(await readdir(directory)).toEqual([])
      } else {
        expect(events).toEqual([
          "entry menu",
          "writer opened",
          "selection validated",
          "diagnostics started",
          "questionnaire",
          "terminal restored",
          "shell report",
        ])
        expect(writer).toHaveBeenCalledWith(path, { fresh: true })
        expect(diagnostics).toHaveBeenCalledWith(path)
        expect(await readdir(directory)).toEqual(["logs"])
      }
    } finally {
      process.argv = argv
      process.exitCode = exitCode
      if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY)
      else Reflect.deleteProperty(process.stdin, "isTTY")
      if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY)
      else Reflect.deleteProperty(process.stdout, "isTTY")
      vi.restoreAllMocks()
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it.each([
  "remove",
  "failure",
  "acknowledgement cancellation",
  "cleanup failure",
  "unattended",
] as const)(
  "routes %s without consuming drafts or bypassing the destructive interactive flow",
  async (action) => {
    vi.resetModules()
    const directory = resolve(`.installer-cli-removal-test-${randomUUID()}`)
    await mkdir(directory, { mode: 0o700 })
    const path = join(directory, "selected.json")
    const config: DeploymentConfig = {
      version: 1,
      cloud: "azure",
      name: "sample-hub",
      owner: "sample-team",
      azure: {
        subscriptionId: "00000000-0000-0000-0000-000000000001",
        tenantId: "00000000-0000-0000-0000-000000000002",
        location: "eastus2",
        resourceGroup: "sample-hub-rg",
      },
    }
    await writeFile(path, JSON.stringify(config), { mode: 0o600 })
    const draft = `${path}.draft.json`
    const savedDraft = JSON.stringify({
      version: 1,
      id: randomUUID(),
      configPath: path,
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-02T10:00:00.000Z",
      phase: "configure",
      deploymentStarted: false,
      answers: { cloud: "azure", name: config.name },
    })
    await writeFile(draft, savedDraft, { mode: 0o600 })
    const argv = process.argv
    const exitCode = process.exitCode
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    const events: string[] = []
    try {
      process.argv = [
        process.execPath,
        resolve("installer/index.tsx"),
        "--config",
        path,
        ...(action === "unattended" ? ["--non-interactive", "--approve-deployment"] : []),
      ]
      process.exitCode = undefined
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: true,
      })
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: true,
      })
      const entry = await import("./entry/index.ts")
      const terminal = await import("./terminal/index.tsx")
      const session = await import("./session/index.ts")
      const command = await import("./command/index.ts")
      const wizard = await import("./wizard/index.ts")
      const install = await import("../azure/install/index.ts")
      const preflight = await import("../azure/install/preflight/index.ts")
      const removal = await import("../azure/remove/index.ts")
      const telemetry = await import("./telemetry/index.ts")
      const acknowledgements: (() => void)[] = []
      const terminals: (WizardUI & {
        close(): Promise<void>
        summary(): undefined
      })[] = []
      const renderer = vi.spyOn(terminal, "createTerminalUI").mockImplementation((abort) => {
        const operation = terminals.length + 1
        events.push(`terminal opened:${operation}`)
        const ui: WizardUI & {
          close(): Promise<void>
          summary(): undefined
        } = {
          cloud: vi.fn(),
          text: vi.fn(async () => {
            events.push(`typed:${operation}`)
            return config.name
          }),
          confirm: vi.fn(async () => {
            events.push(`consent:${operation}`)
            return true
          }),
          wait: vi.fn(async () => {
            events.push(`result acknowledged:${operation}`)
            if (action === "remove")
              await new Promise<void>((resolve) => acknowledgements.push(resolve))
            if (action === "acknowledgement cancellation") {
              abort.abort()
              throw abort.signal.reason
            }
          }),
          status: vi.fn(),
          select: vi.fn(async () => "exit"),
          removal: vi.fn(),
          close: vi.fn(async () => {
            events.push(`terminal restored:${operation}`)
            if (action === "cleanup failure") throw new Error("Synthetic terminal cleanup failure")
          }),
          summary: () => undefined,
        }
        terminals.push(ui)
        return ui
      })
      const choose = vi
        .spyOn(entry, "selectInstallerEntry")
        .mockResolvedValueOnce({
          action: "remove",
          path,
          target: { path, config },
        })
        .mockResolvedValueOnce({
          action: "remove",
          path,
          target: { path, config },
        })
        .mockResolvedValue(undefined)
      const writer = vi.spyOn(session, "openSession")
      const activate = vi.spyOn(entry, "validateInstallerEntry")
      const run = vi.spyOn(command, "runCommand").mockImplementation(async (executable, args) => {
        expect(executable).toBe("az")
        if (args[0] === "account")
          return JSON.stringify({
            id: config.azure.subscriptionId,
            tenantId: config.azure.tenantId,
          })
        if (args[0] === "group" && args[1] === "exists") return "false"
        throw new Error("Routing tests must not invoke real commands or modify Azure")
      })
      const startTelemetry = telemetry.startInstallerTelemetry
      const diagnostics = vi
        .spyOn(telemetry, "startInstallerTelemetry")
        .mockImplementation(async (...args) => {
          const operation = terminals.length
          const observer = await startTelemetry(...args)
          const close = observer.close.bind(observer)
          vi.spyOn(observer, "close").mockImplementation(async (...closeArgs) => {
            await close(...closeArgs)
            events.push(`telemetry closed:${operation}`)
          })
          return observer
        })
      const questionnaire = vi.spyOn(wizard, "runWizard")
      const check = vi.spyOn(preflight, "azurePreflight").mockResolvedValue([])
      const setup = vi
        .spyOn(install, "installAzure")
        .mockRejectedValue(new Error("Synthetic unattended setup stop"))
      const remove = vi.spyOn(removal, "removeAzureDeployment")
      if (action === "failure") remove.mockRejectedValue(new Error("Synthetic removal failure"))
      const output = vi.spyOn(console, "log").mockImplementation(() => {
        events.push("shell report")
      })
      vi.spyOn(console, "error").mockImplementation(() => undefined)

      const pending = import("./index.tsx")
      if (action === "remove") {
        for (const operation of [1, 2]) {
          await vi.waitFor(() => expect(acknowledgements).toHaveLength(operation))
          expect(renderer).toHaveBeenCalledTimes(operation)
          expect(terminals[operation - 1]!.close).not.toHaveBeenCalled()
          expect(events).not.toContain(`telemetry closed:${operation}`)
          expect(output).toHaveBeenCalledTimes(operation - 1)
          acknowledgements[operation - 1]!()
        }
      }
      await pending

      expect(activate).not.toHaveBeenCalled()
      expect(questionnaire).not.toHaveBeenCalled()
      expect(await readFile(draft, "utf8")).toBe(savedDraft)
      expect(await readdir(directory)).not.toContain("selected.json.draft.json.lock")
      if (action === "remove") {
        expect(remove).toHaveBeenCalledTimes(2)
        expect(choose).toHaveBeenCalledTimes(3)
        expect(diagnostics).toHaveBeenCalledTimes(2)
        expect(writer).toHaveBeenCalledTimes(2)
        expect(setup).not.toHaveBeenCalled()
        expect(check).not.toHaveBeenCalled()
        for (const operation of [1, 2]) {
          const ui = terminals[operation - 1]!
          expect(ui.confirm).toHaveBeenCalledOnce()
          expect(ui.text).toHaveBeenCalledOnce()
          expect(vi.mocked(ui.text).mock.calls[0]![1]).toBeUndefined()
          expect(ui.wait).toHaveBeenCalledWith(expect.stringContaining(config.name))
          expect(ui.close).toHaveBeenCalledOnce()
          expect(events.indexOf(`terminal restored:${operation}`)).toBeLessThan(
            events.indexOf(`telemetry closed:${operation}`),
          )
          expect(events.indexOf(`telemetry closed:${operation}`)).toBeLessThan(
            events.indexOf(`terminal opened:${operation + 1}`),
          )
          const report = events.indexOf(
            "shell report",
            events.indexOf(`telemetry closed:${operation}`),
          )
          expect(report).toBeLessThan(events.indexOf(`terminal opened:${operation + 1}`))
          expect(remove.mock.calls[operation - 1]![0]).toEqual({
            path,
            config,
          })
          expect(remove.mock.calls[operation - 1]![1].signal).toBeInstanceOf(AbortSignal)
          expect(vi.mocked(ui.confirm).mock.invocationCallOrder[0]).toBeLessThan(
            writer.mock.invocationCallOrder[operation - 1]!,
          )
          expect(vi.mocked(ui.text).mock.invocationCallOrder[0]).toBeLessThan(
            writer.mock.invocationCallOrder[operation - 1]!,
          )
        }
        expect(remove.mock.calls[0]![1].signal).not.toBe(remove.mock.calls[1]![1].signal)
        expect(terminals[2]!.close).toHaveBeenCalledOnce()
        expect(output).toHaveBeenLastCalledWith(expect.stringMatching(/Setup exited/i))
        expect(output.mock.calls.at(-1)![0]).not.toMatch(/no.*Azure|no.*resources.*changed/i)
        expect(
          output.mock.calls
            .slice(0, 2)
            .every(
              ([message]) =>
                String(message).includes(config.name) &&
                String(message).includes("local files retained"),
            ),
        ).toBe(true)
        expect(process.exitCode ?? 0).toBe(0)
      } else if (
        action === "failure" ||
        action === "acknowledgement cancellation" ||
        action === "cleanup failure"
      ) {
        expect(remove).toHaveBeenCalledOnce()
        expect(choose).toHaveBeenCalledOnce()
        expect(renderer).toHaveBeenCalledOnce()
        expect(terminals[0]!.close).toHaveBeenCalledOnce()
        expect(events).toContain("telemetry closed:1")
        if (action === "failure") {
          expect(terminals[0]!.wait).not.toHaveBeenCalled()
          expect(writer).not.toHaveBeenCalled()
          expect(run).not.toHaveBeenCalled()
          expect(output).not.toHaveBeenCalled()
        } else {
          expect(terminals[0]!.wait).toHaveBeenCalledWith(expect.stringContaining(config.name))
          expect(output).toHaveBeenCalledWith(expect.stringContaining(config.name))
          expect(events.indexOf("shell report")).toBeGreaterThan(
            events.indexOf("terminal restored:1"),
          )
          expect(events.indexOf("shell report")).toBeGreaterThan(
            events.indexOf("telemetry closed:1"),
          )
        }
        expect(process.exitCode).toBe(action === "acknowledgement cancellation" ? 130 : 1)
      } else {
        expect(remove).not.toHaveBeenCalled()
        expect(choose).not.toHaveBeenCalled()
        expect(renderer).not.toHaveBeenCalled()
        expect(writer).not.toHaveBeenCalled()
        expect(run).not.toHaveBeenCalled()
        expect(setup).toHaveBeenCalledOnce()
        expect(check).toHaveBeenCalledOnce()
        expect(process.exitCode).toBe(1)
      }
    } finally {
      process.argv = argv
      process.exitCode = exitCode
      if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY)
      else Reflect.deleteProperty(process.stdin, "isTTY")
      if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY)
      else Reflect.deleteProperty(process.stdout, "isTTY")
      vi.restoreAllMocks()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
