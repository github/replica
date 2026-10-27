import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const starter = join(root, "starters/shadcn")
const generatorPath = join(starter, "starter-generator.mjs")
const {
  createGenerationPlan,
  createToolEnvironment,
  copyStarterLicenses,
  copyInstalledFontLicenses,
  generateStarter,
  parseArguments,
  recipe,
  validateNodeVersion,
} =
  await import(pathToFileURL(generatorPath))

function licenseFixture(t, manifest) {
  const cwd = mkdtempSync(join(root, "..", ".shadcn-license-test-"))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest))
  return cwd
}

function installLicense(cwd, packageName, bytes) {
  const packageDirectory = join(cwd, "node_modules", ...packageName.split("/"))
  mkdirSync(packageDirectory, { recursive: true })
  writeFileSync(join(packageDirectory, "LICENSE"), bytes)
}

test("the Shadcn recipe pins its generator tools and uses the official copied skill", () => {
  assert.deepEqual(recipe.tools, {
    shadcn: "4.22.1",
    skills: "1.7.4",
  })
  assert.equal(recipe.defaultPreset, "nova")
  assert.equal(recipe.base, "radix")
  assert.equal(recipe.block, "dashboard-01")
  assert.ok(recipe.components.length >= 40, "The recipe should install a useful component set")
  for (const component of ["accordion", "chart", "dialog", "sidebar", "table", "tooltip"]) {
    assert.ok(recipe.components.includes(component), `Missing component: ${component}`)
  }
  assert.deepEqual(recipe.skill, {
    source: "shadcn/ui",
    name: "shadcn",
    agent: "github-copilot",
    directory: ".agents/skills/shadcn",
  })

  const packageJson = JSON.parse(readFileSync(join(starter, "package.json"), "utf8"))
  assert.equal(packageJson.devDependencies.shadcn, recipe.tools.shadcn)
  const plan = createGenerationPlan("ab123")
  assert.deepEqual(plan[0].args, ["install", "--engine-strict", "--no-audit", "--no-fund"])
  assert.ok(plan[1].args.includes(`--package=shadcn@${recipe.tools.shadcn}`))
  assert.ok(plan[1].args.includes("init"))
  assert.deepEqual(plan[1].args.slice(-7), [
    "--base", "radix", "--preset", "ab123", "--no-monorepo", "--no-rtl", "--yes",
  ])
  assert.equal(plan[2].args[0], "exec")
  assert.ok(plan[2].args.includes(recipe.block))
  for (const component of recipe.components) assert.ok(plan[2].args.includes(component))
  assert.ok(plan[3].args.includes(`--package=skills@${recipe.tools.skills}`))
  assert.deepEqual(plan[3].args.slice(-7), [
    "shadcn/ui", "--skill", "shadcn", "--agent", "github-copilot", "--copy", "-y",
  ])
  assert.deepEqual(plan.at(-1), {
    label: "Checking the generated app and production build",
    args: ["run", "check:starter"],
  })
})

test("generator argument parsing uses the tested default and accepts named or safe preset codes", () => {
  assert.deepEqual(parseArguments([]), { preset: "nova", interactive: false })
  assert.deepEqual(parseArguments(["--preset", "ab123"]), { preset: "ab123", interactive: false })
  assert.deepEqual(parseArguments(["--preset", "vega"]), { preset: "vega", interactive: false })
  assert.deepEqual(parseArguments(["--interactive"]), { interactive: true })
  assert.deepEqual(parseArguments(["--interactive", "--preset", "ab123"]), {
    preset: "ab123",
    interactive: true,
  })
  for (const args of [
    ["--unknown"],
    ["--preset"],
    ["--preset", "ab123", "--preset", "ab456"],
    ["--interactive", "--interactive"],
    ["--preset", "https://ui.shadcn.com/create"],
    ["--preset", "a"],
    ["--preset", "b1234567890"],
  ]) {
    assert.throws(() => parseArguments(args), /preset|argument|code|interactive/i, JSON.stringify(args))
  }
})

test("interactive generation without a TTY fails before preflight or network access", async () => {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  try {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false })
    await assert.rejects(
      () => generateStarter({ cwd: starter, preset: "ab123", interactive: true }),
      /--interactive needs a terminal \(TTY\).*--preset CODE/,
    )
    assert.ok(!existsSync(join(starter, ".starter-generator-work")))
  } finally {
    if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor)
    else delete process.stdin.isTTY
    if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor)
    else delete process.stdout.isTTY
  }
})

test("generator enforces the supported Node majors at their declared boundary", () => {
  for (const version of ["24.15.0", "v24.15.0", "26.0.0", "26.9.4"]) {
    assert.doesNotThrow(() => validateNodeVersion(version), version)
  }
  for (const version of ["24.14.9", "25.0.0", "27.0.0", "not-a-version"]) {
    assert.throws(() => validateNodeVersion(version), /Node\.js.*supported/, version)
  }
})

test("tool environment appends Windows long-path config without mutating inherited variables", () => {
  const inherited = {
    PATH: "fixture-path",
    CUSTOM_VARIABLE: "preserve me",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "existing.key",
    GIT_CONFIG_VALUE_0: "existing value",
    GIT_CONFIG_KEY_1: "another.key",
    GIT_CONFIG_VALUE_1: "another value",
  }
  const original = { ...inherited }
  const windows = createToolEnvironment("C:\\deep\\work", inherited, "win32")

  assert.notStrictEqual(windows, inherited)
  assert.equal(windows.GIT_CONFIG_COUNT, "3")
  assert.equal(windows.GIT_CONFIG_KEY_2, "core.longpaths")
  assert.equal(windows.GIT_CONFIG_VALUE_2, "true")
  for (const [key, value] of Object.entries(original)) {
    if (key !== "GIT_CONFIG_COUNT") assert.equal(windows[key], value, key)
  }
  assert.deepEqual(inherited, original)

  const unixInherited = { PATH: "unix-path", CUSTOM_VARIABLE: "unix value" }
  const unix = createToolEnvironment("/deep/work", unixInherited, "linux")
  assert.equal(unix.PATH, unixInherited.PATH)
  assert.equal(unix.CUSTOM_VARIABLE, unixInherited.CUSTOM_VARIABLE)
  assert.equal("GIT_CONFIG_COUNT" in unix, false)
  assert.equal("GIT_CONFIG_KEY_0" in unix, false)
  assert.equal("GIT_CONFIG_VALUE_0" in unix, false)

  assert.throws(
    () => createToolEnvironment("C:\\deep\\work", { GIT_CONFIG_COUNT: "not-a-number" }, "win32"),
    /GIT_CONFIG_COUNT|invalid|integer/i,
  )
})

test("Fontsource licenses copy byte-for-byte for both scopes without touching unrelated files", (t) => {
  const cwd = licenseFixture(t, {
    dependencies: { "@fontsource/geist": "5.1.0" },
    devDependencies: { "@fontsource-variable/roboto": "5.1.0", unrelated: "1.0.0" },
  })
  const shadcnLicense = Buffer.from("Shadcn UI license\r\nCopyright 2026\n", "utf8")
  const geistLicense = Buffer.from("Geist license\r\nCopyright 2026\n", "utf8")
  const robotoLicense = Buffer.from([0x4f, 0x46, 0x4c, 0x0a, 0xc3, 0xa9, 0x0a])
  writeFileSync(join(cwd, "SHADCN-LICENSE.txt"), shadcnLicense)
  installLicense(cwd, "@fontsource/geist", geistLicense)
  installLicense(cwd, "@fontsource-variable/roboto", robotoLicense)
  const unrelatedPath = join(cwd, "public", "unrelated.txt")
  const unrelatedBytes = Buffer.from("keep this file unchanged\n", "utf8")
  mkdirSync(join(cwd, "public"), { recursive: true })
  writeFileSync(unrelatedPath, unrelatedBytes)

  const copied = copyStarterLicenses(cwd)
  assert.deepEqual([...copied].sort(), [
    join("public", "licenses", "fontsource-geist-LICENSE.txt"),
    join("public", "licenses", "fontsource-variable-roboto-LICENSE.txt"),
    join("public", "licenses", "shadcn-ui-LICENSE.txt"),
  ])
  assert.deepEqual(
    readFileSync(join(cwd, "public/licenses/shadcn-ui-LICENSE.txt")),
    shadcnLicense,
  )
  assert.deepEqual(
    readFileSync(join(cwd, "public/licenses/fontsource-geist-LICENSE.txt")),
    geistLicense,
  )
  assert.deepEqual(
    readFileSync(join(cwd, "public/licenses/fontsource-variable-roboto-LICENSE.txt")),
    robotoLicense,
  )
  assert.deepEqual(readFileSync(unrelatedPath), unrelatedBytes)
})

test("Fontsource license copying rejects missing licenses and existing targets", (t) => {
  const missing = licenseFixture(t, {
    dependencies: { "@fontsource/geist": "5.1.0" },
  })
  mkdirSync(join(missing, "node_modules/@fontsource/geist"), { recursive: true })
  assert.throws(
    () => copyInstalledFontLicenses(missing),
    /license|missing|regular/i,
  )

  const existing = licenseFixture(t, {
    dependencies: { "@fontsource/geist": "5.1.0" },
  })
  const license = Buffer.from("existing target\n", "utf8")
  installLicense(existing, "@fontsource/geist", Buffer.from("source license\n", "utf8"))
  const target = join(existing, "public/licenses/fontsource-geist-LICENSE.txt")
  mkdirSync(join(existing, "public/licenses"), { recursive: true })
  writeFileSync(target, license)
  assert.throws(
    () => copyInstalledFontLicenses(existing),
    /exists|overwrite|refus/i,
  )
  assert.deepEqual(readFileSync(target), license)
})

test("generator help documents the preset and fixed Radix foundation without network access", () => {
  const result = spawnSync(process.execPath, [generatorPath, "--help"], {
    cwd: starter,
    encoding: "utf8",
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /--preset CODE/)
  assert.match(result.stdout, /--interactive/)
  assert.match(result.stdout, /Radix UI/)
})
