import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const script = join(root, "starters/shared/scripts/setup-replica-plugin.mjs")
const installed = {
  name: "replica-prototype",
  marketplace: "replica",
  source: "installed",
  enabled: true,
}
const pluginList = ["plugin", "list", "--json"]
const marketplaceList = ["plugin", "marketplace", "list", "--json"]
const install = ["plugin", "install", "replica-prototype@replica"]
const enable = ["plugin", "enable", "replica-prototype@replica"]

function run(
  t,
  steps,
  { missingCli = false, missingNpm = false, cliMode = 0o755, startup = false, repeat = 1 } = {},
) {
  const directory = mkdtempSync(join(root, ".replica-plugin-test-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const state = join(directory, "state.json")
  const prefix = join(directory, "npm global")
  writeFileSync(state, JSON.stringify(steps))
  const executable = `#!${process.execPath}
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
assert.equal(process.env.PATH, path.dirname(process.env.REPLICA_TEST_STATE))
const steps = JSON.parse(fs.readFileSync(process.env.REPLICA_TEST_STATE, "utf8"))
const step = steps.shift()
assert.ok(step, "Unexpected extra CLI call")
assert.equal(path.basename(process.argv[1]), step.command ?? "copilot")
assert.deepEqual(process.argv.slice(2), step.args)
fs.writeFileSync(process.env.REPLICA_TEST_STATE, JSON.stringify(steps))
if (step.error) {
  console.error(step.error)
  process.exit(1)
}
if (step.installCli) {
  const bin = path.join(process.env.REPLICA_TEST_PREFIX, "bin")
  fs.mkdirSync(bin, { recursive: true })
  fs.copyFileSync(__filename, path.join(bin, "copilot"))
}
console.log(step.raw ?? (step.command === "npm" && step.args[0] === "prefix"
  ? process.env.REPLICA_TEST_PREFIX
  : JSON.stringify(step.result ?? [])))
`
  for (const command of ["copilot", "npm"]) {
    if ((command === "copilot" && missingCli) || (command === "npm" && missingNpm)) continue
    writeFileSync(join(directory, command), executable, {
      mode: command === "copilot" ? cliMode : 0o755,
    })
  }
  let command = process.execPath
  let args = [script]
  if (startup) {
    mkdirSync(join(directory, "scripts"))
    copyFileSync(script, join(directory, "scripts/setup-replica-plugin.mjs"))
    symlinkSync(process.execPath, join(directory, "node"))
    const config = readFileSync(join(root, "starters/shared/.github/github-app.yml"), "utf8").replaceAll("\r\n", "\n")
    command = "/bin/sh"
    args = ["-c", config.match(/^\s+command: (.+)$/m)[1]]
  }
  let result
  for (let attempt = 0; attempt < repeat; attempt++) {
    result = spawnSync(command, args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
      env: { PATH: directory, REPLICA_TEST_STATE: state, REPLICA_TEST_PREFIX: prefix },
    })
    assert.ifError(result.error)
    if (attempt < repeat - 1) assert.equal(result.status, 0, result.stderr)
  }
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), [], result.stderr)
  return result
}

test("an enabled plugin exits silently after one local check", (t) => {
  const result = run(t, [{ args: pluginList, result: [installed] }])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "")
})

test("a disabled plugin is enabled and verified without marketplace or network commands", (t) => {
  const result = run(t, [
    { args: pluginList, result: [{ ...installed, enabled: false }] },
    { args: enable },
    { args: pluginList, result: [installed] },
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /future sessions/)
  assert.match(result.stdout, /both the Replica plugin and the Replica extension/)
})

test("a missing plugin registers the marketplace, installs and verifies", (t) => {
  const result = run(t, [
    { args: pluginList, result: [] },
    { args: marketplaceList, result: [] },
    { args: ["plugin", "marketplace", "add", "github/replica"] },
    { args: install },
    { args: pluginList, result: [installed] },
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /fresh Copilot session/)
})

for (const source of [
  "GitHub: github/replica",
  "GitHub: github/replica#main",
  "GitHub: github/replica#hub-v1.0.0",
]) {
  test(`installation preserves the registered source ${source}`, (t) => {
    const result = run(t, [
      { args: pluginList, result: [] },
      { args: marketplaceList, result: [{ name: "replica", source }] },
      { args: install },
      { args: pluginList, result: [installed] },
    ])
    assert.equal(result.status, 0, result.stderr)
  })
}

test("conflicting or unverifiable marketplace sources stop before installation", (t) => {
  for (const source of ["GitHub: other/replica", "GitHub: github/replica-other", undefined]) {
    const result = run(t, [
      { args: pluginList, result: [] },
      { args: marketplaceList, result: [{ name: "replica", source }] },
    ])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /marketplace source could not be verified/)
  }
})

test("direct, external and duplicate installations are left unchanged", (t) => {
  for (const plugins of [
    [{ ...installed, marketplace: "" }],
    [{ ...installed, source: "external" }],
    [installed, installed],
  ]) {
    const result = run(t, [{ args: pluginList, result: plugins }])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /different or ambiguous Replica installation/)
  }
})

test("startup installs a missing CLI outside PATH, the plugin and app dependencies", (t) => {
  const result = run(
    t,
    [
      { command: "npm", args: ["prefix", "--global"] },
      { command: "npm", args: ["install", "-g", "@github/copilot"], installCli: true },
      { args: pluginList, result: [] },
      { args: marketplaceList, result: [] },
      { args: ["plugin", "marketplace", "add", "github/replica"] },
      { args: install },
      { args: pluginList, result: [installed] },
      { command: "npm", args: ["ci"] },
    ],
    { missingCli: true, startup: true },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /future sessions/)
  assert.match(result.stdout, /both the Replica plugin and the Replica extension/)
  assert.equal(result.stderr, "")
})

test("a missing CLI and missing npm report how to install the prerequisite", (t) => {
  const result = run(t, [], { missingCli: true, missingNpm: true })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /npm/)
  assert.match(result.stderr, /install/i)
  assert.doesNotMatch(result.stdout + result.stderr, /Customization, select Installed|future sessions/)
})

test("repeated startups reuse the installed global CLI outside PATH without reinstalling", (t) => {
  const result = run(
    t,
    [
      { command: "npm", args: ["prefix", "--global"] },
      { command: "npm", args: ["install", "-g", "@github/copilot"], installCli: true },
      { args: pluginList, result: [installed] },
      { command: "npm", args: ["ci"] },
      { command: "npm", args: ["prefix", "--global"] },
      { args: pluginList, result: [installed] },
      { command: "npm", args: ["ci"] },
    ],
    { missingCli: true, startup: true, repeat: 2 },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "")
  assert.doesNotMatch(result.stdout, /Installing it globally/)
})

test("a failed npm install preserves its cause and stops setup", (t) => {
  const result = run(
    t,
    [
      { command: "npm", args: ["prefix", "--global"] },
      {
        command: "npm",
        args: ["install", "-g", "@github/copilot"],
        error: "EACCES: global installation denied",
      },
    ],
    { missingCli: true },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /EACCES: global installation denied/)
  assert.match(result.stderr, /npm/)
  assert.doesNotMatch(result.stdout + result.stderr, /Customization, select Installed|future sessions/)
})

test("an existing CLI without execute permission is not reinstalled", (t) => {
  const result = run(t, [], { cliMode: 0o644 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /EACCES/)
  assert.doesNotMatch(result.stdout + result.stderr, /Customization, select Installed|future sessions/)
})

test("npm success without a valid prefix or runnable CLI still fails setup", (t) => {
  for (const prefixResult of [{}, { raw: "" }, { raw: "relative/prefix" }]) {
    const result = run(
      t,
      [
        { command: "npm", args: ["prefix", "--global"], ...prefixResult },
        ...(Object.keys(prefixResult).length === 0
          ? [{ command: "npm", args: ["install", "-g", "@github/copilot"] }]
          : []),
      ],
      { missingCli: true },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Copilot|copilot|prefix/)
    assert.doesNotMatch(result.stdout + result.stderr, /Customization, select Installed|future sessions/)
  }
})

test("malformed plugin lists report setup failure without installation or enable advice", (t) => {
  for (const step of [
    { args: pluginList, raw: "not json" },
    { args: pluginList, result: {} },
  ]) {
    const result = run(t, [step])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Replica plugin setup failed/)
    assert.doesNotMatch(result.stdout + result.stderr, /Customization, select Installed|future sessions/)
  }
})

test("CLI failures stop setup without retrying or hiding the cause", (t) => {
  for (const command of ["list", "marketplace", "install", "enable"]) {
    let steps
    if (command === "list") {
      steps = [{ args: pluginList, error: "CLI access denied" }]
    } else if (command === "enable") {
      steps = [
        { args: pluginList, result: [{ ...installed, enabled: false }] },
        { args: enable, error: "CLI access denied" },
      ]
    } else {
      steps = [
        { args: pluginList, result: [] },
        { args: marketplaceList, result: [] },
        {
          args: ["plugin", "marketplace", "add", "github/replica"],
          ...(command === "marketplace" ? { error: "CLI access denied" } : {}),
        },
        ...(command === "install" ? [{ args: install, error: "CLI access denied" }] : []),
      ]
    }
    const result = run(t, steps)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /CLI access denied/)
    assert.equal(result.stdout, "")
    assert.doesNotMatch(result.stderr, /Customization, select Installed|future sessions/)
  }
})

test("setup rejects a missing or disabled plugin after CLI success", (t) => {
  for (const plugins of [[], [{ ...installed, enabled: false }]]) {
    const result = run(t, [
      { args: pluginList, result: [{ ...installed, enabled: false }] },
      { args: enable },
      { args: pluginList, result: plugins },
    ])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /did not report the Replica plugin installed and enabled/)
    assert.doesNotMatch(result.stdout + result.stderr, /Customization, select Installed|future sessions/)
  }
})

test("startup is configured to run when a session is created", () => {
  const config = readFileSync(join(root, "starters/shared/.github/github-app.yml"), "utf8").replaceAll("\r\n", "\n")
  assert.match(config, /triggers:\n\s+- session\.create/)
})

test("startup installs dependencies after successful or failed plugin setup", (t) => {
  for (const plugin of [
    { args: pluginList, result: [installed] },
    { args: pluginList, error: "CLI access denied" },
  ]) {
    const result = run(
      t,
      [plugin, { command: "npm", args: ["ci"], raw: "Dependencies finished" }],
      { startup: true },
    )
    assert.equal(result.status, 0, result.stderr)
    const summary = result.stdout.slice(result.stdout.indexOf("Setup summary"))
    assert.match(summary, /App dependencies: installed/)
    assert.ok(result.stdout.indexOf("Setup summary") > result.stdout.indexOf("Dependencies finished"))
    if (plugin.error) {
      assert.match(summary, /Replica canvas: unavailable/)
      assert.match(summary, /CLI access denied/)
      assert.match(summary, /node scripts\/setup-replica-plugin\.mjs/)
    } else {
      assert.match(summary, /Replica plugin: installed and enabled/)
      assert.match(summary, /fresh Copilot session/)
      assert.doesNotMatch(summary, /canvas: ready/i)
    }
    if (plugin.error) assert.match(result.stderr, /CLI access denied/)
  }
})

test("startup installs dependencies even when CLI installation fails", (t) => {
  const result = run(
    t,
    [
      { command: "npm", args: ["prefix", "--global"] },
      {
        command: "npm",
        args: ["install", "-g", "@github/copilot"],
        error: "EACCES: global installation denied",
      },
      { command: "npm", args: ["ci"] },
    ],
    { missingCli: true, startup: true },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /EACCES: global installation denied/)
  const summary = result.stdout.slice(result.stdout.indexOf("Setup summary"))
  assert.match(summary, /App dependencies: installed/)
  assert.match(summary, /Replica canvas: unavailable/)
  assert.match(summary, /Copilot CLI installation failed/)
  assert.match(summary, /EACCES: global installation denied/)
})

test("startup still fails when dependency installation fails", (t) => {
  for (const plugin of [
    { args: pluginList, result: [installed] },
    { args: pluginList, error: "CLI access denied" },
  ]) {
    const result = run(
      t,
      [
        plugin,
        { command: "npm", args: ["ci"], error: "Dependency installation failed" },
      ],
      { startup: true },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Dependency installation failed/)
    const summary = result.stdout.slice(result.stdout.indexOf("Setup summary"))
    assert.match(summary, /App dependencies: failed/)
    assert.match(summary, /npm ci/)
    assert.match(
      summary,
      plugin.error ? /Replica canvas: unavailable/ : /Replica plugin: installed and enabled/,
    )
  }
})
