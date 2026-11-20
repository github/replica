import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import { openSession, type WizardDraft } from "../session/index.ts"
import { saveConfig } from "../config/index.ts"
import * as configuration from "../config/index.ts"
import * as sessionFiles from "../session/index.ts"
import * as privateFiles from "../private-files/index.ts"
import type { DeploymentConfig, WizardUI } from "../types.ts"
import { selectInstallerEntry, validateInstallerEntry } from "./index.ts"

const directories: string[] = []
const sessions: Awaited<ReturnType<typeof openSession>>[] = []

async function directory() {
  const path = resolve(`.installer-entry-test-${randomUUID()}`)
  directories.push(path)
  await mkdir(path, { mode: 0o700 })
  return path
}

function config(name = "first-hub"): DeploymentConfig {
  return {
    version: 1,
    cloud: "azure",
    name,
    owner: "platform-team",
    azure: {
      tenantId: "00000000-0000-0000-0000-000000000001",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: `${name}-rg`,
    },
  }
}

function draft(path: string, name = "first-hub"): WizardDraft {
  return {
    version: 1,
    id: randomUUID(),
    configPath: path,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
    phase: "configure",
    deploymentStarted: false,
    answers: { cloud: "azure", name, owner: "platform-team" },
  }
}

async function fixture(path: string, value: unknown) {
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value), { mode: 0o600 })
}

function uiFor(...choices: string[]): WizardUI {
  return {
    welcome: vi.fn(),
    cloud: vi.fn(),
    text: vi.fn(),
    select: vi.fn(async () => {
      if (!choices.length) throw new Error("Unexpected extra entry selection")
      return choices.shift()!
    }),
    confirm: vi.fn(),
    wait: vi.fn(),
    status: vi.fn(),
    notice: vi.fn(),
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it("offers Exit without creating even a missing local directory", async () => {
  const parent = await directory()
  const local = join(parent, "not-created")
  const ui = uiFor("exit")

  expect(await selectInstallerEntry(ui, { directory: local })).toBeUndefined()

  expect(vi.mocked(ui.select).mock.calls[0]![1].map(({ value }) => value)).toEqual([
    "create",
    "update",
    "exit",
  ])
  expect(await readdir(parent)).toEqual([])
  expect(ui.cloud).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
  expect(ui.confirm).not.toHaveBeenCalled()
})

it("exits post-setup without creating a local directory or requesting installation answers", async () => {
  const parent = await directory()
  const ui = uiFor("exit")

  expect(
    await selectInstallerEntry(ui, {
      directory: join(parent, "missing"),
      postSetup: true,
    }),
  ).toBeUndefined()

  expect(vi.mocked(ui.select).mock.calls[0]![1].map(({ value }) => value)).toEqual([
    "sign-in",
    "github",
    "restart",
    "exit",
  ])
  expect(await readdir(parent)).toEqual([])
  expect(ui.cloud).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
  expect(ui.confirm).not.toHaveBeenCalled()
})

it.each(["sign-in", "github", "restart"] as const)(
  "selects a complete saved installation for post-setup %s without changing its files",
  async (postAction) => {
    const root = await directory()
    const path = join(root, "installation.json")
    const existing = config()
    await fixture(path, existing)
    const before = await readFile(path, "utf8")
    const ui = uiFor(postAction, path)

    expect(await selectInstallerEntry(ui, { directory: root, postSetup: true })).toMatchObject({
      action: "update",
      postAction,
      path,
      existing,
    })

    expect(await readFile(path, "utf8")).toBe(before)
    expect(await readdir(root)).toEqual(["installation.json"])
    expect(ui.cloud).not.toHaveBeenCalled()
    expect(ui.confirm).not.toHaveBeenCalled()
  },
)

it("does not enter post-setup for an installation with unfinished setup", async () => {
  const root = await directory()
  const path = join(root, "installation.json")
  await fixture(path, config())
  await fixture(`${path}.draft.json`, draft(path))
  const files = await readdir(root)
  const contents = await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))
  const ui = uiFor("restart", path, "exit")

  expect(await selectInstallerEntry(ui, { directory: root, postSetup: true })).toBeUndefined()

  expect(ui.notice).toHaveBeenCalledWith("error", expect.any(String))
  expect(await readdir(root)).toEqual(files)
  expect(await Promise.all(files.map((file) => readFile(join(root, file), "utf8")))).toEqual(
    contents,
  )
  expect(ui.confirm).not.toHaveBeenCalled()
})

it("creates a fresh sibling rather than reusing an occupied config hint or its draft", async () => {
  const local = await directory()
  const occupied = join(local, "installation.json")
  const other = join(local, "other.json")
  await fixture(occupied, config())
  await fixture(`${occupied}.draft.json`, draft(occupied))
  await fixture(other, config("other-hub"))
  const files = await readdir(local)
  const contents = await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))
  const ui = uiFor("create")

  const entry = await selectInstallerEntry(ui, {
    directory: local,
    configPath: occupied,
  })

  expect(entry).toEqual({ action: "create", path: expect.any(String) })
  expect(entry!.path).not.toBe(occupied)
  expect(dirname(entry!.path)).toBe(local)
  expect(await readdir(local)).toEqual(files)
  expect(await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))).toEqual(
    contents,
  )
})

it("uses an unused explicit Create path without creating files during selection", async () => {
  const local = await directory()
  const explicit = join(local, "new", "custom.json")
  const ui = uiFor("create")

  expect(await selectInstallerEntry(ui, { directory: local, configPath: explicit })).toEqual({
    action: "create",
    path: explicit,
  })
  expect(await readdir(local)).toEqual([])
})

it("opens and saves a fresh selected setup below a normal repository parent without changing its permissions", async () => {
  const parent = await directory()
  await chmod(parent, 0o755)
  const parentMode = (await stat(parent)).mode & 0o777
  const local = join(parent, "private-local")
  const entry = await selectInstallerEntry(uiFor("create"), {
    directory: local,
  })
  expect(await readdir(parent)).toEqual([])
  const session = await openSession(entry!.path, { fresh: true })
  sessions.push(session)

  await validateInstallerEntry(entry!, session)
  await session.answer("name", "first-hub")
  await saveConfig(entry!.path, config(), { exclusive: true })

  expect((await stat(parent)).mode & 0o777).toBe(parentMode)
  if (process.platform === "win32") {
    expect(await privateFiles.privateDirectory(local, { create: false })).toBe(true)
    expect(await privateFiles.privateFile(session.path)).toBe(true)
    expect(await privateFiles.privateFile(entry!.path)).toBe(true)
  } else {
    expect((await stat(local)).mode & 0o777).toBe(0o700)
    expect((await stat(session.path)).mode & 0o777).toBe(0o600)
    expect((await stat(entry!.path)).mode & 0o777).toBe(0o600)
  }
  expect(JSON.parse(await readFile(entry!.path, "utf8"))).toEqual(config())
})

it("lets Update choose a local config alongside a hint and labels saved targets without claiming deployment", async () => {
  const local = await directory()
  const elsewhere = await directory()
  const selected = join(local, "local.json")
  const hint = join(elsewhere, "hint.json")
  const existing = config()
  await fixture(selected, existing)
  await fixture(hint, config("hint-hub"))
  const ui = uiFor("update", selected)

  expect(await selectInstallerEntry(ui, { directory: local, configPath: hint })).toMatchObject({
    action: "update",
    path: selected,
    existing,
  })

  const choices = vi.mocked(ui.select).mock.calls[1]![1]
  expect(choices.map(({ value }) => value)).toEqual(
    expect.arrayContaining([selected, hint, "config-file", "back"]),
  )
  const label = choices.find(({ value }) => value === selected)!.label
  for (const part of [
    existing.name,
    existing.azure.subscriptionId,
    existing.azure.location,
    selected,
  ])
    expect(label).toContain(part)
  expect(label).toMatch(/not verified/i)
  expect(ui.cloud).not.toHaveBeenCalled()
  expect(await readdir(local)).toEqual(["local.json"])
  expect(await readdir(elsewhere)).toEqual(["hint.json"])
})

it("retries an invalid explicit path and loads the selected private file outside the local list", async () => {
  const local = await directory()
  const elsewhere = await directory()
  const selected = join(elsewhere, "explicit.json")
  const existing = config()
  await fixture(selected, existing)
  const ui = uiFor("update", "config-file", "config-file")
  vi.mocked(ui.text).mockResolvedValueOnce("invalid\u0000path").mockResolvedValueOnce(selected)

  expect(await selectInstallerEntry(ui, { directory: local })).toMatchObject({
    action: "update",
    path: selected,
    existing,
  })

  expect(ui.notice).toHaveBeenCalledWith("error", expect.any(String))
  expect(ui.text).toHaveBeenCalledTimes(2)
  expect(await readdir(local)).toEqual([])
  expect(await readdir(elsewhere)).toEqual(["explicit.json"])
})

it.each(["text", "field"] as const)(
  "prefills the failed entered path when correcting it through %s",
  async (input) => {
    const root = await directory()
    const failed = join(root, "missing config.json")
    const corrected = join(root, "corrected config.json")
    const existing = config()
    vi.spyOn(privateFiles, "privateDirectory").mockResolvedValue(false)
    vi.spyOn(sessionFiles, "readSession").mockResolvedValue({})
    vi.spyOn(configuration, "loadConfig").mockImplementation(async (path) => {
      if (path === corrected) return existing
      throw Object.assign(new Error("Not found"), { code: "ENOENT" })
    })
    const ui = uiFor("update", "config-file", "config-file")
    const answer = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(corrected)
    if (input === "field") ui.field = answer
    else ui.text = answer

    expect(await selectInstallerEntry(ui, { directory: root })).toMatchObject({
      action: "update",
      path: corrected,
      existing,
    })

    expect(answer.mock.calls[1]![1]).toBe(failed)
    expect(ui.notice).toHaveBeenCalledWith("error", expect.stringContaining(failed))
    expect(await readdir(root)).toEqual([])
  },
)

it("keeps a corrected but unreadable candidate in the picker after failure and after Back", async () => {
  const root = await directory()
  const failed = join(root, "missing.json")
  const corrected = join(root, "corrected config.json")
  vi.spyOn(privateFiles, "privateDirectory").mockResolvedValue(false)
  vi.spyOn(sessionFiles, "readSession").mockResolvedValue({})
  vi.spyOn(configuration, "loadConfig").mockRejectedValue(new Error("Unreadable configuration"))
  const ui = uiFor("update", "config-file", "config-file", "back", "update", "back", "exit")
  vi.mocked(ui.text).mockResolvedValueOnce(failed).mockResolvedValueOnce(corrected)

  expect(await selectInstallerEntry(ui, { directory: root })).toBeUndefined()

  const calls = vi.mocked(ui.select).mock.calls
  for (const call of [calls[3]!, calls[5]!])
    expect(call[1]).toContainEqual({
      value: corrected,
      label: expect.stringContaining("needs attention"),
    })
  expect(await readdir(root)).toEqual([])
})

it.each([
  "invalid config",
  "invalid draft",
  "misbound draft",
  "conflicting draft",
  ...(process.platform === "win32" ? [] : ["public config" as const]),
  "deployment missing config",
] as const)(
  "shows a %s needing attention and refuses to load or silently discard it",
  async (kind) => {
    const local = await directory()
    const path = join(local, "installation.json")
    if (kind !== "deployment missing config")
      await fixture(path, kind === "invalid config" ? '{"version":' : config())
    if (kind === "invalid draft") await fixture(`${path}.draft.json`, '{"version":')
    if (kind === "misbound draft")
      await fixture(`${path}.draft.json`, {
        ...draft(path),
        configPath: join(local, "other.json"),
      })
    if (kind === "conflicting draft") await fixture(`${path}.draft.json`, draft(path, "other-hub"))
    if (kind === "deployment missing config")
      await fixture(`${path}.draft.json`, {
        ...draft(path),
        phase: "provision",
        deploymentStarted: true,
      })
    if (kind === "public config") await chmod(path, 0o644)
    const files = await readdir(local)
    const contents = await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))
    const ui = uiFor("update", path, "back", "exit")

    expect(await selectInstallerEntry(ui, { directory: local })).toBeUndefined()

    expect(ui.notice).toHaveBeenCalledWith("error", expect.stringContaining(path))
    const calls = vi.mocked(ui.select).mock.calls
    expect(calls[0]![1].some(({ value }) => value === "resume")).toBe(false)
    expect(calls[1]![1]).toContainEqual({
      value: path,
      label: expect.stringMatching(/needs attention/i),
    })
    expect(ui.confirm).not.toHaveBeenCalled()
    expect(await readdir(local)).toEqual(files)
    expect(await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))).toEqual(
      contents,
    )
  },
)

it("refuses Update over an unfinished draft and returns to the entry menu for Resume", async () => {
  const local = await directory()
  const path = join(local, "installation.json")
  await fixture(path, config())
  const saved = draft(path)
  await fixture(`${path}.draft.json`, saved)
  const previous = await readFile(`${path}.draft.json`, "utf8")
  const ui = uiFor("update", path, "resume", path)

  expect(await selectInstallerEntry(ui, { directory: local })).toMatchObject({
    action: "resume",
    path,
    draft: saved,
    existing: config(),
  })

  expect(ui.notice).toHaveBeenCalledWith("error", expect.stringMatching(/resume/i))
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(await readFile(`${path}.draft.json`, "utf8")).toBe(previous)
})

it("reveals Resume for an externally entered config with an unfinished draft rather than consuming it in Update", async () => {
  const local = await directory()
  const elsewhere = await directory()
  const path = join(elsewhere, "external.json")
  await fixture(path, config())
  await fixture(`${path}.draft.json`, draft(path))
  const previous = await readFile(`${path}.draft.json`, "utf8")
  const ui = uiFor("update", "config-file", "resume", path)
  vi.mocked(ui.text).mockResolvedValue(path)

  expect(await selectInstallerEntry(ui, { directory: local })).toMatchObject({
    action: "resume",
    path,
    existing: config(),
    draft: { configPath: path },
  })

  const calls = vi.mocked(ui.select).mock.calls
  expect(calls[0]![1].some(({ value }) => value === "resume")).toBe(false)
  expect(calls[2]![1].some(({ value }) => value === "resume")).toBe(true)
  expect(ui.notice).toHaveBeenCalledWith("error", expect.stringMatching(/resume/i))
  expect(await readFile(`${path}.draft.json`, "utf8")).toBe(previous)
  expect(await readdir(local)).toEqual([])
})

it("resumes the chosen associated config and draft while leaving another unfinished setup untouched", async () => {
  const local = await directory()
  const selected = join(local, "selected.json")
  const other = join(local, "other.json")
  await fixture(selected, config("selected-hub"))
  await fixture(`${selected}.draft.json`, draft(selected, "selected-hub"))
  await fixture(other, config("other-hub"))
  await fixture(`${other}.draft.json`, draft(other, "other-hub"))
  const untouched = await readFile(`${other}.draft.json`, "utf8")
  const ui = uiFor("resume", selected)

  const entry = await selectInstallerEntry(ui, { directory: local })
  const session = await openSession(entry!.path)
  sessions.push(session)
  await validateInstallerEntry(entry!, session)

  expect(entry).toMatchObject({
    action: "resume",
    path: selected,
    existing: config("selected-hub"),
    draft: { configPath: selected, answers: { name: "selected-hub" } },
  })
  await session.complete()
  expect(await readFile(`${other}.draft.json`, "utf8")).toBe(untouched)
  expect(JSON.parse(await readFile(selected, "utf8"))).toEqual(config("selected-hub"))
})

it.each(["config", "draft"] as const)(
  "refuses a selected %s changed before opening the writer",
  async (kind) => {
    const local = await directory()
    const path = join(local, "installation.json")
    await fixture(path, config())
    if (kind === "draft") await fixture(`${path}.draft.json`, draft(path))
    const ui = uiFor(kind === "draft" ? "resume" : "update", path)
    const entry = await selectInstallerEntry(ui, { directory: local })
    const changed = kind === "config" ? path : `${path}.draft.json`
    await fixture(
      changed,
      kind === "config"
        ? { ...config(), owner: "changed-team" }
        : {
            ...draft(path),
            answers: {
              cloud: "azure",
              name: "first-hub",
              owner: "platform-team",
              useProxy: false,
            },
          },
    )
    const contents = await readFile(changed, "utf8")
    const session = await openSession(path)
    sessions.push(session)

    await expect(validateInstallerEntry(entry!, session)).rejects.toThrow(/changed|attention/i)

    expect(await readFile(changed, "utf8")).toBe(contents)
  },
)
