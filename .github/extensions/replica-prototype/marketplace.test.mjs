import assert from "node:assert/strict"
import { readFile, realpath } from "node:fs/promises"
import { it } from "node:test"

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

it("resolves the setup skill's canonical schema inside the shipped plugin", async () => {
  const location = new URL("skills/replica-setup-checks/SKILL.md", import.meta.url)
  const skill = await readFile(location, "utf8")
  assert.match(skill, /\bvalidate_checks\b/)
  const schema = [...skill.matchAll(/\]\(([^)]+\/checks-config\/schema\.v2\.json)\)/g)]
  assert.ok(schema.length > 0, "Setup must reference the framework's canonical schema.")
  for (const [, resource] of schema)
    assert.equal(
      await realpath(new URL(resource, location)),
      await realpath(new URL("checks-config/schema.v2.json", import.meta.url)),
    )
  assert.doesNotMatch(skill, /validate-checks\.mjs|checks:validate|standalone\.js/)
})
