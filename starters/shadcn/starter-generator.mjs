import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { normalizeShadcn } from "./scripts/normalize-shadcn.mjs"

export const recipe = JSON.parse(
  readFileSync(new URL("./starter-recipe.json", import.meta.url), "utf8"),
)

const namedPresets = new Set(["nova", "vega", "maia", "lyra", "mira", "luma", "sera", "rhea"])

function validatePreset(preset) {
  if (
    typeof preset !== "string" ||
    (!namedPresets.has(preset) && !/^[ab][A-Za-z0-9]{1,9}$/.test(preset))
  ) {
    throw new Error("Use a preset code from ui.shadcn.com/create, not a URL or a pasted command.")
  }
}

export function parseArguments(args) {
  let preset = recipe.defaultPreset
  let seenPreset = false
  let interactive = false
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--interactive") {
      if (interactive) throw new Error("Pass --interactive only once.")
      interactive = true
      continue
    }
    if (args[index] !== "--preset") {
      throw new Error(`Unknown argument: ${args[index]}. Usage: node starter-generator.mjs [--preset CODE] [--interactive]`)
    }
    if (seenPreset) throw new Error("Pass --preset only once.")
    if (!args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error("--preset needs a code from ui.shadcn.com/create.")
    }
    preset = args[++index]
    validatePreset(preset)
    seenPreset = true
  }
  return interactive && !seenPreset ? { interactive } : { preset, interactive }
}

export function validateNodeVersion(version = process.versions.node) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  if (!match || !((major === 24 && minor >= 15) || major === 26)) {
    throw new Error(`Node.js ${version} is not supported. Use a version matching ^24.15.0 || ^26.0.0.`)
  }
}

export function createGenerationPlan(preset = recipe.defaultPreset) {
  validatePreset(preset)
  const shadcn = ["exec", "--yes", `--package=shadcn@${recipe.tools.shadcn}`, "--", "shadcn"]
  return [
    { label: "Installing app dependencies", args: ["install", "--engine-strict", "--no-audit", "--no-fund"] },
    {
      label: "Initializing shadcn in the existing Vite app",
      args: [...shadcn, "init", "--base", recipe.base, "--preset", preset, "--no-monorepo", "--no-rtl", "--yes"],
    },
    {
      label: "Installing official components and dashboard-01",
      args: [...shadcn, "add", recipe.block, ...recipe.components, "--yes"],
    },
    {
      label: "Copying the official shadcn skill for GitHub Copilot",
      args: [
        "exec", "--yes", `--package=skills@${recipe.tools.skills}`, "--", "skills", "add",
        recipe.skill.source, "--skill", recipe.skill.name, "--agent", recipe.skill.agent, "--copy", "-y",
      ],
    },
    {
      label: "Checking the generated app and production build",
      args: ["run", "check:starter"],
    },
  ]
}

export function createToolEnvironment(work, inherited = process.env, platform = process.platform) {
  const env = {
    ...inherited,
    DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    SHADCN_TELEMETRY_DISABLED: "1",
    npm_config_update_notifier: "false",
    npm_config_logs_dir: path.join(work, "npm-logs"),
    TMP: work,
    TEMP: work,
    TMPDIR: work,
    CI: "1",
  }
  if (platform === "win32") {
    const countText = inherited.GIT_CONFIG_COUNT ?? "0"
    const count = Number(countText)
    if (typeof countText !== "string" || !/^\d+$/.test(countText) || !Number.isSafeInteger(count + 1)) {
      throw new Error("GIT_CONFIG_COUNT must be a non-negative integer before generating the Shadcn app.")
    }
    // Allow deep skill checkouts without changing the caller's Git configuration.
    env.GIT_CONFIG_COUNT = String(count + 1)
    env[`GIT_CONFIG_KEY_${count}`] = "core.longpaths"
    env[`GIT_CONFIG_VALUE_${count}`] = "true"
  }
  return env
}

function copyLicenseNotice(cwd, license, filename) {
  if (!entryExists(license) || !lstatSync(license).isFile() || lstatSync(license).isSymbolicLink()) {
    throw new Error(`A regular LICENSE file is required: ${license}`)
  }
  for (const directory of ["public", path.join("public", "licenses")]) {
    const target = path.join(cwd, directory)
    if (entryExists(target)) {
      const stat = lstatSync(target)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`License notices require a regular directory: ${directory}`)
      }
    } else {
      mkdirSync(target)
    }
  }
  const relative = path.join("public", "licenses", filename)
  const target = path.join(cwd, relative)
  if (entryExists(target)) throw new Error(`Refusing to overwrite the license notice: ${relative}`)
  writeFileSync(target, readFileSync(license), { flag: "wx" })
  return relative
}

export function copyInstalledFontLicenses(cwd) {
  const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"))
  const packages = [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])].filter((name) => /^@fontsource(?:-variable)?\//.test(name)).sort()
  return packages.map((packageName) => {
    const name = /^@(fontsource(?:-variable)?)\/([a-z0-9][a-z0-9-]*)$/.exec(packageName)
    if (!name) throw new Error(`Unsupported Fontsource package name: ${packageName}`)
    return copyLicenseNotice(
      cwd,
      path.join(cwd, "node_modules", packageName, "LICENSE"),
      `${name[1]}-${name[2]}-LICENSE.txt`,
    )
  })
}

export function copyStarterLicenses(cwd) {
  return [
    copyLicenseNotice(cwd, path.join(cwd, "SHADCN-LICENSE.txt"), "shadcn-ui-LICENSE.txt"),
    ...copyInstalledFontLicenses(cwd),
  ]
}

function npmCommand() {
  if (process.platform !== "win32") return { command: "npm", prefix: [] }

  const directories = [
    ...(process.env.PATH ?? "").split(path.delimiter).map((entry) => entry.replace(/^"|"$/g, "")),
    path.dirname(process.execPath),
  ]
  let cli = process.env.npm_execpath
  if (!cli || path.basename(cli) !== "npm-cli.js" || !existsSync(cli)) {
    cli = undefined
    for (const directory of directories) {
      const bundledCli = path.join(directory, "node_modules", "npm", "bin", "npm-cli.js")
      if (!existsSync(bundledCli)) continue
      const prefixScript = path.join(directory, "node_modules", "npm", "bin", "npm-prefix.js")
      if (existsSync(prefixScript)) {
        const result = spawnSync(process.execPath, [prefixScript], {
          encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000,
        })
        if (result.error || result.status !== 0) {
          throw new Error("npm could not resolve its Windows installation prefix.")
        }
        const prefixCli = path.join(result.stdout.trim(), "node_modules", "npm", "bin", "npm-cli.js")
        if (existsSync(prefixCli)) {
          cli = prefixCli
          break
        }
      }
      cli = bundledCli
      break
    }
  }
  if (!cli) throw new Error("npm was not found beside Node.js or on PATH. Install npm for this Node.js runtime.")

  // Run npm's JavaScript entry point; Windows cannot execute npm.cmd without a shell.
  return { command: process.execPath, prefix: [cli] }
}

function runNpm(args, cwd, env, capture = false) {
  const { command, prefix } = npmCommand()
  const result = spawnSync(command, [...prefix, ...args], {
    cwd,
    env,
    shell: false,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
    windowsHide: true,
    timeout: 15 * 60 * 1000,
  })
  if (result.error) throw new Error(`npm ${args[0]} could not run: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} failed${result.signal ? ` (${result.signal})` : ` with exit code ${result.status}`}.${capture ? ` ${result.stderr.trim()}` : ""}`)
  }
  return capture ? result.stdout.trim() : ""
}

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function entryExists(file) {
  try {
    lstatSync(file)
    return true
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}

function filesUnder(cwd, relative) {
  const directory = path.join(cwd, relative)
  if (!entryExists(directory)) return []
  const root = lstatSync(directory)
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error(`Generation requires a regular directory: ${relative}`)
  }
  const entries = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    const stat = lstatSync(path.join(cwd, name))
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new Error(`Generation requires regular files and directories: ${name}`)
    }
    if (stat.isDirectory()) entries.push(...filesUnder(cwd, name))
    else entries.push(name)
  }
  return entries
}

function protectedFiles(cwd) {
  const mutableRootFiles = new Set([
    "package.json", "package-lock.json", "components.json", "skills-lock.json", "starter-provenance.json",
  ])
  const rootFiles = readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !mutableRootFiles.has(entry.name))
    .map((entry) => entry.name)
  const sourceFiles = filesUnder(cwd, "src").filter((file) => {
    const name = file.split(path.sep).join("/")
    return name !== "src/index.css" &&
      !["src/components/", "src/hooks/", "src/lib/", "src/app/"].some((prefix) => name.startsWith(prefix))
  })
  return new Map(
    [
      ...rootFiles,
      ...sourceFiles,
      ...[".agents", ".github", "scripts"].flatMap((directory) => filesUnder(cwd, directory)),
    ]
      .map((file) => [file, hashFile(path.join(cwd, file))]),
  )
}

function verifyProtectedFiles(cwd, before) {
  const after = protectedFiles(cwd)
  for (const [file, hash] of before) {
    if (after.get(file) !== hash) {
      throw new Error(`A generator changed an existing integration or shared file: ${file}. Discard this incomplete destination.`)
    }
  }
  const skillPrefix = `${path.normalize(recipe.skill.directory)}${path.sep}`
  for (const file of after.keys()) {
    if (!before.has(file) && !file.startsWith(skillPrefix)) {
      throw new Error(`A generator added an unexpected shared file: ${file}. Discard this incomplete destination.`)
    }
  }
}

function preflight(cwd) {
  validateNodeVersion()
  for (const name of ["package.json", "vite.config.ts", "tsconfig.json", "src/index.css", "src/app.tsx"]) {
    const file = path.join(cwd, name)
    if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
      throw new Error(`The copied Shadcn recipe needs a regular ${name} file in ${cwd}.`)
    }
  }
  for (const name of [
    ".git", "components.json", "src/components", "src/hooks", "src/lib",
    "src/app", "src/dashboard", "app/dashboard", recipe.skill.directory,
    "starter-provenance.json", ".starter-generator-work",
  ]) {
    if (entryExists(path.join(cwd, name))) {
      throw new Error(`Refusing to overwrite ${name}. Generate into a fresh assembled destination.`)
    }
  }
  const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"))
  if (manifest.devDependencies?.shadcn !== recipe.tools.shadcn) {
    throw new Error("The recipe and package.json must pin the same shadcn CLI version.")
  }
}

export async function generateStarter({ cwd = process.cwd(), preset, interactive = false } = {}) {
  if (interactive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("--interactive needs a terminal (TTY). Pass --preset CODE or omit --interactive for the default preset.")
  }
  cwd = path.resolve(cwd)
  preflight(cwd)
  if (interactive) {
    console.log("This starter includes one dashboard with Records and Settings. It uses local sample data, with no backend or authentication.")
    console.log("Choose a visual preset at https://ui.shadcn.com/create?template=vite . This starter keeps Radix UI and a single left-to-right Vite app.")
    if (preset === undefined) {
      const { createInterface } = await import("node:readline/promises")
      const prompt = createInterface({ input: process.stdin, output: process.stdout })
      try {
        preset = (await prompt.question("Paste only a preset code, or press Enter for the default Nova preset: ")).trim() || recipe.defaultPreset
      } finally {
        prompt.close()
      }
    } else {
      console.log(`Using the supplied preset: ${preset}`)
    }
  }
  preset ??= recipe.defaultPreset
  const plan = createGenerationPlan(preset)
  const before = protectedFiles(cwd)
  const work = path.join(cwd, ".starter-generator-work")
  const env = createToolEnvironment(work)
  mkdirSync(work)

  try {
    const npm = runNpm(["--version"], cwd, env, true)
    let licenseNotices = []
    for (const step of plan) {
      if (step.args[0] === "run" && step.args[1] === "check:starter") {
        console.log("\nNormalizing installed shadcn Spinner props...")
        const { changed, icon } = normalizeShadcn(cwd)
        console.log(changed ? `Aligned Spinner props with ${icon}.` : `Spinner props already match ${icon}.`)
        licenseNotices = copyStarterLicenses(cwd)
      }
      console.log(`\n${step.label}...`)
      runNpm(step.args, cwd, env)
    }
    verifyProtectedFiles(cwd, before)
    for (const name of [
      "package-lock.json", "components.json", "src/app/dashboard/data.json",
      "src/components/chart-area-interactive.tsx", "src/components/section-cards.tsx",
      "src/components/data-table.tsx", `${recipe.skill.directory}/SKILL.md`, "skills-lock.json",
    ]) {
      const file = path.join(cwd, name)
      if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
        throw new Error(`Generation did not produce the expected regular file: ${name}`)
      }
    }
    const config = JSON.parse(readFileSync(path.join(cwd, "components.json"), "utf8"))
    const registryUrl = `https://ui.shadcn.com/r/styles/${encodeURIComponent(config.style)}/${recipe.block}.json`
    const response = await fetch(registryUrl, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Could not record dashboard registry provenance: HTTP ${response.status}.`)
    const registryHash = createHash("sha256").update(await response.text()).digest("hex")
    const generatedFiles = [
      "src/index.css",
      ...licenseNotices,
      ...["src/components", "src/hooks", "src/lib", "src/app", recipe.skill.directory]
        .flatMap((directory) => filesUnder(cwd, directory)),
    ]
    const provenance = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runtime: { node: process.versions.node, npm },
      tools: recipe.tools,
      requestedPreset: preset,
      resolvedConfig: config,
      registryItems: [recipe.block, ...recipe.components],
      upstreamLicense: { source: "https://github.com/shadcn-ui/ui", file: "SHADCN-LICENSE.txt", spdx: "MIT" },
      dashboardRegistryObservation: { url: registryUrl, sha256: registryHash },
      skills: JSON.parse(readFileSync(path.join(cwd, "skills-lock.json"), "utf8")),
      packageLockSha256: hashFile(path.join(cwd, "package-lock.json")),
      generatedFiles: Object.fromEntries(generatedFiles.map((file) => [
        file.split(path.sep).join("/"), hashFile(path.join(cwd, file)),
      ])),
      sourceLimitation: "CLI versions are pinned, but the upstream registry, transitive registry items and shadcn/ui skill source are live. The registry observation is not a frozen input or proof of the exact response used by the CLI. Keep this generated repository's sources and lockfiles.",
    }
    writeFileSync(path.join(cwd, "starter-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, { flag: "wx" })
    console.log("\nShadcn app generated and checked. UI sources, npm lockfile and the copied skill are ready.")
    return provenance
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log("Usage: node starter-generator.mjs [--preset CODE] [--interactive]\nUse a code from ui.shadcn.com/create. The starter uses Radix UI; other --base options are not supported.\n--interactive offers preset selection in a terminal; omit it for automation.")
  } else {
    try {
      await generateStarter(parseArguments(process.argv.slice(2)))
    } catch (error) {
      console.error(`Shadcn generation failed: ${error.message}`)
      process.exitCode = 1
    }
  }
}
