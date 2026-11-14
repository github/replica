import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it } from "vitest"

import { stageRemovalModule } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it.each(["app", "foundation", "provision"] as const)(
  "stages only trusted %s templates privately and leaves original sources unchanged",
  async (kind) => {
    const destination = resolve(`.removal-stage-test-${randomUUID()}`)
    directories.push(destination)
    const source = resolve(import.meta.dirname, "../..", kind === "app" ? "." : kind)
    const names = (await readdir(source)).filter(
      (name) => name.endsWith(".tf") || name === ".terraform.lock.hcl",
    )
    const original = new Map(
      await Promise.all(
        names.map(async (name) => [name, await readFile(join(source, name), "utf8")] as const),
      ),
    )

    await stageRemovalModule(kind, destination)

    expect((await readdir(destination)).sort()).toEqual(names.sort())
    expect((await stat(destination)).mode & 0o777).toBe(0o700)
    for (const [name, content] of original) {
      expect((await stat(join(destination, name))).mode & 0o777).toBe(0o600)
      expect(await readFile(join(source, name), "utf8")).toBe(content)
      const staged = await readFile(join(destination, name), "utf8")
      if (kind === "app" && name === "application.tf") {
        expect(content).toContain("prevent_destroy = true")
        expect(staged).toBe(content.replace("prevent_destroy = true", "prevent_destroy = false"))
      } else if (kind === "foundation" && name === "main.tf") {
        expect(staged).toContain("purge_soft_delete_on_destroy = false")
        expect(
          staged.replace(
            "    key_vault {\n      purge_soft_delete_on_destroy = false\n    }\n",
            "",
          ),
        ).toBe(content)
        expect(staged).toContain("purge_protection_enabled")
      } else expect(staged).toBe(content)
    }
  },
)

it("refuses to overwrite a previously staged trusted file", async () => {
  const destination = resolve(`.removal-stage-test-${randomUUID()}`)
  directories.push(destination)
  await mkdir(destination, { mode: 0o700 })
  await stageRemovalModule("app", destination)
  const previous = await readFile(join(destination, "application.tf"), "utf8")
  await expect(stageRemovalModule("app", destination)).rejects.toThrow()
  expect(await readFile(join(destination, "application.tf"), "utf8")).toBe(previous)
})
