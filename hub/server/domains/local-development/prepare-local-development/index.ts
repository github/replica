import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { lstat, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

import { runCommand as runProcessCommand } from "../../../integrations/process/run-command/index.ts"
import { LocalDevelopmentPreparationError } from "../errors.ts"
import type {
  LocalDevelopmentConfiguration,
  PrepareLocalDevelopmentDependencies,
  PrepareLocalDevelopmentResult,
} from "../types.ts"

const exampleDirectoryName = "minimal"
const exampleBranchName = "prototype/example"
const gitEnvironment = {
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

function starterBash(sourceRoot: string) {
  if (process.platform !== "win32") return "bash"

  const prerequisite =
    "Install Git for Windows with Git Bash, and make its git.exe available on PATH to create the Starter repository."
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === "git_exec_path") delete environment[key]
  }
  let gitCore: string
  try {
    gitCore = execFileSync("git", ["--exec-path"], {
      cwd: sourceRoot,
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    throw new LocalDevelopmentPreparationError(prerequisite)
  }
  // Git reports <Git>/<architecture>/libexec/git-core, not the wrapper on PATH.
  const bash = resolve(gitCore, "../../..", "bin", "bash.exe")
  if (
    !isAbsolute(gitCore) ||
    basename(gitCore) !== "git-core" ||
    basename(dirname(gitCore)) !== "libexec" ||
    !statSync(bash, { throwIfNoEntry: false })?.isFile()
  ) {
    throw new LocalDevelopmentPreparationError(prerequisite)
  }
  return bash
}

export async function prepareLocalDevelopment(
  configuration: LocalDevelopmentConfiguration,
  dependencies: PrepareLocalDevelopmentDependencies = {},
): Promise<PrepareLocalDevelopmentResult | undefined> {
  if (!configuration.enabled) return
  const { createPrototypeScript } = configuration
  const execute = dependencies.runCommand ?? runProcessCommand
  const npmEntrypoint =
    process.platform === "win32"
      ? (process.env.npm_execpath ??
        join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"))
      : undefined
  const npmCommand = npmEntrypoint ? process.execPath : "npm"
  const npmArguments = npmEntrypoint ? [npmEntrypoint] : []
  async function runCommand(input: Parameters<typeof execute>[0]) {
    try {
      await execute(input)
    } catch {
      const stage =
        input.command === "npm" || input.arguments[0] === npmEntrypoint
          ? "install dependencies"
          : input.arguments.includes("install") && input.arguments.includes("chromium")
            ? "install Chromium"
            : input.arguments[0] === createPrototypeScript
              ? "create the Starter repository"
              : input.command === "git"
                ? "create the Starter history"
                : "prepare the Starter repository"
      throw new LocalDevelopmentPreparationError(
        `Could not ${stage}. Check the local preparation prerequisites and try again.`,
      )
    }
  }

  await mkdir(configuration.root, { recursive: true })
  if ((await lstat(configuration.root)).isSymbolicLink()) {
    throw new LocalDevelopmentPreparationError(
      `LOCAL_PROTOTYPE_ROOT must not be a symbolic link: ${configuration.root}`,
    )
  }

  if (!(await exists(join(configuration.buildActionDirectory, "node_modules/playwright")))) {
    await runCommand({
      command: npmCommand,
      arguments: [...npmArguments, "ci", "--ignore-scripts", "--omit=dev", "--engine-strict"],
      cwd: configuration.buildActionDirectory,
    })
  }
  await runCommand({
    command: process.execPath,
    arguments: ["node_modules/playwright/cli.js", "install", "chromium"],
    cwd: configuration.buildActionDirectory,
  })

  if ((await readdir(configuration.root)).length > 0) {
    return { root: configuration.root, seeded: false }
  }

  const stagingDirectory = await mkdtemp(join(configuration.root, ".replica-bootstrap-"))
  const checkout = join(stagingDirectory, exampleDirectoryName)
  try {
    await runCommand({
      command: starterBash(configuration.sourceRoot),
      arguments: [createPrototypeScript, checkout],
      cwd: configuration.sourceRoot,
      environment: {
        ...process.env,
        REPLICA_INTERNAL_STARTER_ROOT: configuration.root,
      },
    })
    await runCommand({
      command: "git",
      arguments: [
        "-c",
        "maintenance.auto=false",
        "-c",
        "user.name=Replica Example",
        "-c",
        "user.email=local@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "add",
        ".",
      ],
      cwd: checkout,
      environment: { ...process.env, ...gitEnvironment },
    })
    await runCommand({
      command: "git",
      arguments: [
        "-c",
        "maintenance.auto=false",
        "-c",
        "user.name=Replica Example",
        "-c",
        "user.email=local@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "chore: start local prototype",
      ],
      cwd: checkout,
      environment: { ...process.env, ...gitEnvironment },
    })
    await runCommand({
      command: npmCommand,
      arguments: [...npmArguments, "ci", "--engine-strict"],
      cwd: checkout,
    })
    await runCommand({
      command: "git",
      arguments: ["-c", "maintenance.auto=false", "switch", "-c", exampleBranchName, "main"],
      cwd: checkout,
    })
    await runCommand({
      command: process.execPath,
      arguments: [
        "scripts/scaffold-prototype.mjs",
        "--slug",
        "example",
        "--name",
        "Minimal example",
        "--description",
        "A committed example branch for local Hub development.",
        "--start-page",
        "/example",
      ],
      cwd: checkout,
    })
    await runCommand({
      command: "git",
      arguments: [
        "-c",
        "maintenance.auto=false",
        "-c",
        "user.name=Replica Example",
        "-c",
        "user.email=local@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "add",
        ".",
      ],
      cwd: checkout,
      environment: { ...process.env, ...gitEnvironment },
    })
    await runCommand({
      command: "git",
      arguments: [
        "-c",
        "maintenance.auto=false",
        "-c",
        "user.name=Replica Example",
        "-c",
        "user.email=local@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "feat: add local example prototype",
      ],
      cwd: checkout,
      environment: { ...process.env, ...gitEnvironment },
    })

    const rootEntries = await readdir(configuration.root)
    if (rootEntries.length !== 1 || rootEntries[0] !== basename(stagingDirectory)) {
      throw new LocalDevelopmentPreparationError(
        `LOCAL_PROTOTYPE_ROOT changed while the Minimal example was being prepared: ${configuration.root}`,
      )
    }
    await rename(checkout, join(configuration.root, exampleDirectoryName))
    return { root: configuration.root, seeded: true }
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true })
  }
}
