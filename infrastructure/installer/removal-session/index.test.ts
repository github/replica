import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it } from "vitest"
import type { DeploymentConfig } from "../types.ts"
import { removalSession } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = resolve(`.removal-session-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "sample-hub",
    owner: "sample-team",
    azure: {
      tenantId: "00000000-0000-0000-0000-000000000001",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "sample-hub-rg",
    },
  }
  return { directory, path: join(directory, "config.json"), config }
}

it("discovers without writes and persists private removal progress bound to the exact target", async () => {
  const target = await fixture()
  const session = await removalSession(target)
  expect(session.phase).toBeUndefined()
  expect(await readdir(target.directory)).toEqual([])
  await session.save("removing")
  await session.save("retained")
  expect(session.phase).toBe("retained")
  expect((await stat(`${target.path}.removal.json`)).mode & 0o777).toBe(0o600)
  expect((await removalSession(target)).phase).toBe("retained")
  await expect(
    removalSession({
      ...target,
      config: { ...target.config, owner: "changed" },
    }),
  ).rejects.toThrow(/conflicts/)
})

it("does not overwrite changed or invalid removal evidence", async () => {
  const target = await fixture()
  const session = await removalSession(target)
  await session.save("removing")
  await writeFile(`${target.path}.removal.json`, "synthetic invalid evidence")
  await expect(session.save("complete")).rejects.toThrow(/changed/)
  await expect(removalSession(target)).rejects.toThrow(/invalid/)
  expect(await readFile(`${target.path}.removal.json`, "utf8")).toBe("synthetic invalid evidence")
})
