import { randomUUID } from "node:crypto"
import { chmod, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

import { openSession } from "./index.ts"

type Session = Awaited<ReturnType<typeof openSession>>
const directories: string[] = []
const sessions: Session[] = []

async function target() {
  const directory = resolve(`.installer-session-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  return { directory, configPath: join(directory, "installation.json") }
}

async function track(configPath: string) {
  const session = await openSession(configPath)
  sessions.push(session)
  return session
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe("wizard draft sessions", () => {
  it("round-trips validated answers and phase beside the resolved config with private atomic checkpoints", async () => {
    const { configPath } = await target()
    const session = await track(relative(process.cwd(), configPath))
    await session.answer("cloud", "azure")
    await session.answer("name", "team-hub")
    await session.answer("owner", "platform-team")
    await session.answer("useProxy", true)
    await session.answer("npmRegistry", "https://packages.example/npm")
    await session.phase("configure")
    const previous = await readFile(session.path, "utf8")
    const reader = await open(session.path, "r")

    try {
      await session.answer("owner", "new-team")

      expect(await reader.readFile("utf8")).toBe(previous)
    } finally {
      await reader.close()
    }

    expect(session.path).toBe(`${resolve(configPath)}.draft.json`)
    expect((await stat(session.path)).mode & 0o777).toBe(0o600)
    const saved = JSON.parse(await readFile(session.path, "utf8"))
    expect(saved).toMatchObject({
      version: 1,
      configPath: resolve(configPath),
      phase: "configure",
      deploymentStarted: false,
      answers: {
        cloud: "azure",
        name: "team-hub",
        owner: "new-team",
        useProxy: true,
        npmRegistry: "https://packages.example/npm/",
      },
    })
    expect(saved.id).toEqual(expect.any(String))
    expect(Number.isFinite(Date.parse(saved.createdAt))).toBe(true)
    expect(Number.isFinite(Date.parse(saved.updatedAt))).toBe(true)
    await session.close()

    const reopened = await track(configPath)
    expect(reopened.problem).toBeUndefined()
    expect(reopened.draft).toEqual(saved)
  })

  it("serializes concurrent checkpoints so the last accepted answer and phase survive reopening", async () => {
    const { configPath } = await target()
    const session = await track(configPath)

    await Promise.all([
      session.answer("name", "team-hub"),
      session.answer("owner", "first-team"),
      session.answer("owner", "last-team"),
      session.phase("review"),
    ])
    await session.close()

    expect((await track(configPath)).draft).toMatchObject({
      phase: "review",
      answers: { name: "team-hub", owner: "last-team" },
    })
  })

  it.each([
    ["unknown secret", "accessToken", "synthetic-private-value"],
    ["deployment consent", "approveDeployment", true],
    ["invalid name", "name", "../other"],
    ["invalid tenant", "tenantId", "not-a-uuid"],
    ["wrong boolean type", "useProxy", "true"],
    [
      "registry credentials",
      "npmRegistry",
      "https://synthetic-user:synthetic-password@packages.example/",
    ],
    ["registry token", "npmRegistry", "https://packages.example/?token=synthetic-private-value"],
  ])("refuses %s without replacing the previous good draft", async (_label, key, value) => {
    const { configPath } = await target()
    const session = await track(configPath)
    await session.answer("owner", "platform-team")
    const previous = await readFile(session.path, "utf8")

    await expect(Reflect.apply(session.answer, session, [key, value])).rejects.toThrow()

    expect(await readFile(session.path, "utf8")).toBe(previous)
    expect(session.draft?.answers).toEqual({ owner: "platform-team" })
  })

  it.each([
    {
      parent: "tenantId",
      value: "00000000-0000-0000-0000-000000000003",
      removed: ["subscriptionId", "location"],
    },
    {
      parent: "subscriptionId",
      value: "00000000-0000-0000-0000-000000000004",
      removed: ["location"],
    },
    { parent: "name", value: "other-hub", removed: ["resourceGroup"] },
    { parent: "useProxy", value: false, removed: ["npmRegistry"] },
  ])(
    "invalidates only dependent answers when $parent changes",
    async ({ parent, value, removed }) => {
      const { configPath } = await target()
      const session = await track(configPath)
      const answers = {
        cloud: "azure",
        tenantId: "00000000-0000-0000-0000-000000000001",
        subscriptionId: "00000000-0000-0000-0000-000000000002",
        location: "eastus2",
        name: "team-hub",
        resourceGroup: "team-hub-rg",
        owner: "platform-team",
        useProxy: true,
        npmRegistry: "https://packages.example/npm/",
      }
      for (const [key, answer] of Object.entries(answers)) {
        await Reflect.apply(session.answer, session, [key, answer])
      }

      await Reflect.apply(session.answer, session, [parent, value])
      await session.close()

      const expected: Record<string, unknown> = { ...answers, [parent]: value }
      for (const key of removed) delete expected[key]
      expect((await track(configPath)).draft?.answers).toEqual(expected)
    },
  )

  it("keeps dependent choices when revalidating an unchanged parent and persists explicit clearing", async () => {
    const { configPath } = await target()
    const session = await track(configPath)
    await session.answer("name", "team-hub")
    await session.answer("resourceGroup", "team-hub-rg")
    await session.answer("owner", "platform-team")

    await session.answer("name", "team-hub")
    expect(session.draft?.answers.resourceGroup).toBe("team-hub-rg")
    await session.clear(["name", "resourceGroup"])
    await session.close()

    expect((await track(configPath)).draft?.answers).toEqual({ owner: "platform-team" })
  })

  it("normalizes draft Azure UUIDs and retains dependent choices when only identifier case changes", async () => {
    const { configPath } = await target()
    const session = await track(configPath)
    const tenantId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    const subscriptionId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
    await session.answer("tenantId", tenantId.toUpperCase())
    await session.answer("subscriptionId", subscriptionId.toUpperCase())
    await session.answer("location", "eastus2")

    await session.answer("tenantId", tenantId)
    await session.answer("subscriptionId", subscriptionId)
    await session.close()

    expect((await track(configPath)).draft?.answers).toEqual({
      tenantId,
      subscriptionId,
      location: "eastus2",
    })
  })

  it("refuses another active writer and an already closed writer cannot release its successor's ownership", async () => {
    const { configPath } = await target()
    const first = await track(configPath)
    await first.answer("name", "team-hub")

    await expect(openSession(relative(process.cwd(), configPath))).rejects.toThrow()
    await first.close()
    const successor = await track(configPath)
    await first.close()
    await expect(openSession(configPath)).rejects.toThrow()

    await successor.answer("owner", "successor-team")
    expect(successor.draft?.answers).toEqual({ name: "team-hub", owner: "successor-team" })
  })

  it("reclaims a dead local writer without allowing two simultaneous recovery writers", async () => {
    const { configPath } = await target()
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { openSession } from "./installer/session/index.ts";
         const session = await openSession(${JSON.stringify(configPath)});
         await session.answer("owner", "interrupted-team");
         process.exit(0);`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    )
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)

    const attempts = await Promise.allSettled([openSession(configPath), openSession(configPath)])
    const winners = attempts.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    )
    sessions.push(...winners)

    expect(winners).toHaveLength(1)
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(winners[0]!.draft?.answers).toEqual({ owner: "interrupted-team" })
  })

  it.each(["malformed", "unsupported version", "different config path", "unknown secret"])(
    "preserves a %s draft until an explicit restart archives it",
    async (problem) => {
      const { directory, configPath } = await target()
      const draftPath = `${resolve(configPath)}.draft.json`
      const valid = {
        version: 1,
        id: randomUUID(),
        configPath: resolve(configPath),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phase: "configure",
        answers: { owner: "platform-team" },
        deploymentStarted: false,
      }
      const contents =
        problem === "malformed"
          ? '{"version":'
          : JSON.stringify({
              ...valid,
              ...(problem === "unsupported version" ? { version: 99 } : {}),
              ...(problem === "different config path"
                ? { configPath: join(directory, "other.json") }
                : {}),
              ...(problem === "unknown secret"
                ? { answers: { accessToken: "synthetic-private-value" } }
                : {}),
            })
      await writeFile(draftPath, contents, { mode: 0o600 })
      const session = await track(configPath)

      expect(session.draft).toBeUndefined()
      expect(session.problem).toEqual(expect.any(String))
      expect(session.problem).not.toContain("synthetic-private-value")
      expect(await readFile(draftPath, "utf8")).toBe(contents)

      await session.restart()
      await session.answer("name", "fresh-hub")
      expect(session.problem).toBeUndefined()
      expect(session.draft?.answers).toEqual({ name: "fresh-hub" })
      const archives = (await readdir(directory)).filter(
        (name) => name !== "installation.json.draft.json",
      )
      const preserved = await Promise.all(
        archives.map(async (name) => {
          const path = join(directory, name)
          return (await stat(path)).isFile() ? readFile(path, "utf8") : undefined
        }),
      )
      expect(preserved).toContain(contents)
    },
  )

  it("preserves the prior checkpoint after a filesystem failure and can save again after repair", async () => {
    const { directory, configPath } = await target()
    const session = await track(configPath)
    await session.answer("owner", "platform-team")
    const previous = await readFile(session.path, "utf8")
    await chmod(directory, 0o500)

    try {
      await expect(session.answer("name", "team-hub")).rejects.toThrow()
      expect(await readFile(session.path, "utf8")).toBe(previous)
    } finally {
      await chmod(directory, 0o700)
    }

    await session.answer("name", "team-hub")
    await session.close()
    expect((await track(configPath)).draft?.answers).toEqual({
      owner: "platform-team",
      name: "team-hub",
    })
  })

  it("isolates config targets and completes only the selected draft, never the saved configuration", async () => {
    const { directory, configPath } = await target()
    const otherConfig = join(directory, "other.json")
    const configContents = '{"saved":"configuration is preserved byte for byte"}\n'
    await writeFile(configPath, configContents, { mode: 0o600 })
    const first = await track(configPath)
    const second = await track(otherConfig)
    await first.answer("name", "first-hub")
    await second.answer("name", "other-hub")
    await first.phase("provision")
    expect(first.draft?.deploymentStarted).toBe(true)
    const otherDraft = await readFile(second.path, "utf8")

    await first.complete()

    await expect(readFile(first.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(configPath, "utf8")).toBe(configContents)
    expect(await readFile(second.path, "utf8")).toBe(otherDraft)
    await first.close()
    expect((await track(configPath)).draft).toBeUndefined()
  })
})
