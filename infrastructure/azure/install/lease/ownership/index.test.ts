import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it } from "vitest"
import type { DeploymentConfig } from "../../../../installer/types.ts"
import { leaseOwnership } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = resolve(`.lease-proof-${randomUUID()}`)
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
  return { directory, config }
}

it("keeps a private exact-target ownership identity without overwriting conflicting evidence", async () => {
  const context = await fixture()
  const proof = await leaseOwnership(context, "state", "terraform", "sample-hub/app.tfstate")
  expect(proof.lease).toBeUndefined()
  const id = randomUUID()
  await proof.save(id)
  expect(
    (await leaseOwnership(context, "state", "terraform", "sample-hub/app.tfstate")).lease,
  ).toBe(id)
  expect(
    (await leaseOwnership(context, "other", "terraform", "sample-hub/app.tfstate")).lease,
  ).toBeUndefined()
  const [name] = await readdir(context.directory)
  const path = join(context.directory, name!)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  const original = await readFile(path, "utf8")
  await writeFile(path, "synthetic conflicting evidence")
  await expect(proof.save(randomUUID())).rejects.toThrow(/changed/)
  await expect(
    leaseOwnership(context, "state", "terraform", "sample-hub/app.tfstate"),
  ).rejects.toThrow(/invalid/)
  expect(await readFile(path, "utf8")).not.toBe(original)
})
