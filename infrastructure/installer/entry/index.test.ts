import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import { openSession, type WizardDraft } from "../session/index.ts"
import { saveConfig } from "../config/index.ts"
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
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it("offers Exit without creating even a missing local directory", async () => {
  const parent = await directory()
  const local = join(parent, "not-created")
  const ui = uiFor("exit")

  expect(await selectInstallerEntry(ui, { directory: local })).toBeUndefined()

  expect(vi.mocked(ui.select).mock.calls[0]![1].map(({ value }) => value)).toEqual([
    "create", "update", "remove", "exit",
  ])
  expect(await readdir(parent)).toEqual([])
  expect(ui.cloud).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
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

  const entry = await selectInstallerEntry(ui, { directory: local, configPath: occupied })

  expect(entry).toEqual({ action: "create", path: expect.any(String) })
  expect(entry!.path).not.toBe(occupied)
  expect(dirname(entry!.path)).toBe(local)
  expect(await readdir(local)).toEqual(files)
  expect(await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))).toEqual(contents)
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
  const local = join(parent, "private-local")
  const entry = await selectInstallerEntry(uiFor("create"), { directory: local })
  expect(await readdir(parent)).toEqual([])
  const session = await openSession(entry!.path, { fresh: true })
  sessions.push(session)

  await validateInstallerEntry(entry!, session)
  await session.answer("name", "first-hub")
  await saveConfig(entry!.path, config(), { exclusive: true })

  expect((await stat(parent)).mode & 0o777).toBe(0o755)
  expect((await stat(local)).mode & 0o777).toBe(0o700)
  expect((await stat(session.path)).mode & 0o777).toBe(0o600)
  expect((await stat(entry!.path)).mode & 0o777).toBe(0o600)
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
  expect(choices.map(({ value }) => value)).toEqual(expect.arrayContaining([selected, hint, "config-file", "back"]))
  const label = choices.find(({ value }) => value === selected)!.label
  for (const part of [existing.name, existing.azure.subscriptionId, existing.azure.location, selected])
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
  vi.mocked(ui.text).mockResolvedValueOnce(" invalid path ").mockResolvedValueOnce(selected)

  expect(await selectInstallerEntry(ui, { directory: local })).toMatchObject({
    action: "update", path: selected, existing,
  })

  expect(ui.notice).toHaveBeenCalledWith("error", expect.any(String))
  expect(ui.text).toHaveBeenCalledTimes(2)
  expect(await readdir(local)).toEqual([])
  expect(await readdir(elsewhere)).toEqual(["explicit.json"])
})

it.each(["invalid config", "invalid draft", "misbound draft", "conflicting draft", "public config", "deployment missing config"] as const)(
  "shows a %s needing attention and refuses to load or silently discard it",
  async (kind) => {
    const local = await directory()
    const path = join(local, "installation.json")
    if (kind !== "deployment missing config")
      await fixture(path, kind === "invalid config" ? '{"version":' : config())
    if (kind === "invalid draft") await fixture(`${path}.draft.json`, '{"version":')
    if (kind === "misbound draft")
      await fixture(`${path}.draft.json`, { ...draft(path), configPath: join(local, "other.json") })
    if (kind === "conflicting draft") await fixture(`${path}.draft.json`, draft(path, "other-hub"))
    if (kind === "deployment missing config")
      await fixture(`${path}.draft.json`, { ...draft(path), phase: "provision", deploymentStarted: true })
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
    expect(await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))).toEqual(contents)
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
    action: "resume", path, draft: saved, existing: config(),
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
    action: "resume", path, existing: config(), draft: { configPath: path },
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
    action: "resume", path: selected, existing: config("selected-hub"),
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
    await fixture(changed, kind === "config" ? { ...config(), owner: "changed-team" } : {
      ...draft(path), answers: { cloud: "azure", name: "first-hub", owner: "platform-team", useProxy: false },
    })
    const contents = await readFile(changed, "utf8")
    const session = await openSession(path)
    sessions.push(session)

    await expect(validateInstallerEntry(entry!, session)).rejects.toThrow(/changed|attention/i)

    expect(await readFile(changed, "utf8")).toBe(contents)
  },
)

it("selects several removal targets without consuming compatible drafts or opening writers", async () => {
  const local = await directory()
  const first = join(local, "first.json")
  const second = join(local, "second.json")
  await fixture(first, config())
  await fixture(`${first}.draft.json`, draft(first))
  await fixture(second, config("second-hub"))
  const files = await readdir(local)
  const contents = await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))
  const ui = uiFor("remove")
  ui.multiSelect = vi.fn(async () => [second, first])

  expect(await selectInstallerEntry(ui, { directory: local })).toEqual({
    action: "remove", path: second,
    targets: [{ path: second, config: config("second-hub") }, { path: first, config: config() }],
  })

  expect(ui.confirm).not.toHaveBeenCalled()
  expect(await readdir(local)).toEqual(files)
  expect(await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))).toEqual(contents)
})

it("retains selected local targets while adding a private external configuration", async () => {
  const local = await directory()
  const elsewhere = await directory()
  const first = join(local, "first.json")
  const second = join(elsewhere, "second.json")
  await fixture(first, config())
  await fixture(second, config("second-hub"))
  const ui = uiFor("remove")
  ui.multiSelect = vi.fn().mockResolvedValueOnce([first, "config-file"]).mockResolvedValueOnce([first, second])
  vi.mocked(ui.text).mockResolvedValue(second)

  expect(await selectInstallerEntry(ui, { directory: local })).toMatchObject({
    action: "remove", targets: [{ path: first }, { path: second }],
  })

  expect(ui.multiSelect).toHaveBeenNthCalledWith(2, expect.any(String),
    expect.arrayContaining([expect.objectContaining({ value: second })]), [first, second])
  expect(await readdir(elsewhere)).toEqual(["second.json"])
})

it("keeps an empty removal submission in the picker with selection guidance", async () => {
  const local = await directory()
  const path = join(local, "installation.json")
  await fixture(path, config())
  const ui = uiFor("remove", "exit")
  ui.multiSelect = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([path])

  expect(await selectInstallerEntry(ui, { directory: local })).toMatchObject({
    action: "remove", targets: [{ path }],
  })

  expect(ui.select).toHaveBeenCalledOnce()
  expect(ui.multiSelect).toHaveBeenCalledTimes(2)
  expect(ui.notice).toHaveBeenCalledWith("warning", expect.stringMatching(/Space.*Enter/i))
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(await readdir(local)).toEqual(["installation.json"])
})

it("returns from an explicit removal Back choice to Exit without any writable activity", async () => {
  const local = await directory()
  const ui = uiFor("remove", "exit")
  ui.multiSelect = vi.fn(async () => ["back"])
  ui.removal = vi.fn()

  expect(await selectInstallerEntry(ui, { directory: local })).toBeUndefined()

  expect(vi.mocked(ui.removal!).mock.calls.map(([active]) => active)).toEqual([false, true, false])
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(await readdir(local)).toEqual([])
})

it("omits destructive removal from configuration-only setup", async () => {
  const local = await directory()
  const ui = uiFor("exit")

  await selectInstallerEntry(ui, { directory: local, configureOnly: true })

  expect(vi.mocked(ui.select).mock.calls[0]![1].map(({ value }) => value)).toEqual(["create", "update", "exit"])
  const forged = uiFor("remove")
  forged.multiSelect = vi.fn()
  await expect(selectInstallerEntry(forged, { directory: local, configureOnly: true })).rejects.toThrow(/configur.*only/i)
  expect(forged.multiSelect).not.toHaveBeenCalled()
})

it.each(["invalid config", "conflicting draft", "public config"])(
  "keeps a removal candidate with %s visible as needing attention but out of selectable targets",
  async (problem) => {
    const local = await directory()
    const path = join(local, "installation.json")
    await fixture(path, problem === "invalid config" ? "invalid synthetic JSON" : config())
    if (problem === "conflicting draft") await fixture(`${path}.draft.json`, draft(path, "different-hub"))
    if (problem === "public config") await chmod(path, 0o644)
    const files = await readdir(local)
    const before = await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))
    const ui = uiFor("remove", "exit")
    ui.multiSelect = vi.fn<NonNullable<WizardUI["multiSelect"]>>(async (_message, options) => {
      expect(options.some(({ value }) => value === path)).toBe(false)
      return ["back"]
    })

    expect(await selectInstallerEntry(ui, { directory: local })).toBeUndefined()

    expect(ui.notice).toHaveBeenCalledWith("error", expect.stringContaining(path))
    expect(await readdir(local)).toEqual(files)
    expect(await Promise.all(files.map((name) => readFile(join(local, name), "utf8")))).toEqual(before)
  },
)

it("reinspects selected removal files instead of trusting an earlier picker result", async () => {
  const local = await directory()
  const path = join(local, "installation.json")
  await fixture(path, config())
  const ui = uiFor("remove")
  ui.multiSelect = vi.fn(async () => {
    await fixture(path, { ...config(), owner: "changed-team" })
    return [path]
  })

  await expect(selectInstallerEntry(ui, { directory: local })).rejects.toThrow(/changed|attention/i)

  expect(JSON.parse(await readFile(path, "utf8")).owner).toBe("changed-team")
  expect(await readdir(local)).toEqual(["installation.json"])
})

it("rejects unlisted removal paths and setup-session activation of destructive targets", async () => {
  const local = await directory()
  const path = join(local, "installation.json")
  await fixture(path, config())
  const ui = uiFor("remove")
  ui.multiSelect = vi.fn(async () => [join(local, "not-listed.json")])
  await expect(selectInstallerEntry(ui, { directory: local })).rejects.toThrow(/listed/i)
  const session = await openSession(path)
  sessions.push(session)
  await expect(validateInstallerEntry({
    action: "remove", path, targets: [{ path, config: config() }],
  }, session)).rejects.toThrow(/destructive|removal/i)
})
