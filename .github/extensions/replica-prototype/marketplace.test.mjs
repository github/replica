import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it } from "node:test"
import { promisify } from "node:util"

it("resolves the marketplace's relative source to the shipped plugin", async () => {
  const root = new URL("../../../", import.meta.url)
  const catalog = JSON.parse(await readFile(new URL(".github/plugin/marketplace.json", root)))
  assert.equal(catalog.name, "replica")
  assert.equal(catalog.plugins.length, 1)
  const plugin = catalog.plugins[0]
  assert.equal(plugin.name, "replica-prototype")
  assert.equal(plugin.source, "./.github/extensions/replica-prototype")
  assert.equal(
    await realpath(new URL(plugin.source, root)),
    await realpath(new URL(".", import.meta.url)),
  )
  const manifest = JSON.parse(await readFile(new URL(`${plugin.source}/plugin.json`, root)))
  assert.equal(manifest.name, plugin.name)
  assert.equal(manifest.version, "1.4.0")
  for (const name of ["replica-publish-prototype", "replica-setup-checks"]) {
    const location = new URL(`${plugin.source}/skills/${name}/SKILL.md`, root)
    const skill = await readFile(location, "utf8")
    assert.equal(skill.replaceAll("\r\n", "\n").split("\n")[1], `name: ${name}`)
    for (const [, resource] of skill.matchAll(/\]\((\.\.\/[^)]+)\)/g))
      await realpath(new URL(resource, location))
  }
})

it("installs the setup skill's validation resources without a starter or dependencies", async (test) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "replica-plugin-checks-"))
  test.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, ".replica"))
  await copyFile(
    new URL("checks-config/schema.v2.json", import.meta.url),
    path.join(root, ".replica/checks.schema.json"),
  )
  await copyFile(
    new URL("checks-config/standalone.js", import.meta.url),
    path.join(root, ".replica/validate-checks.mjs"),
  )
  await writeFile(
    path.join(root, ".replica/checks.json"),
    JSON.stringify({
      $schema: "./checks.schema.json",
      version: 2,
      base: "main",
      checks: [
        {
          id: "lint",
          name: "Lint",
          runner: {
            type: "command",
            image: "checks:local",
            command: ["eslint", "src"],
            report: "exit-code",
          },
        },
      ],
    }),
  )
  const { stdout } = await promisify(execFile)(process.execPath, [".replica/validate-checks.mjs"], {
    cwd: root,
  })
  assert.match(stdout, /Valid .replica\/checks.json/)
})
