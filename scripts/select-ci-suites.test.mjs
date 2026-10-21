import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { selectCiSuites } from "./select-ci-suites.mjs"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const script = join(root, "scripts/select-ci-suites.mjs")
const selectorUrl = pathToFileURL(script).href
const fixtureRoot = mkdtempSync(join(root, ".select-ci-suites-test-"))
after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

function git(repo, ...args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function createRepo(name) {
  const repo = join(fixtureRoot, name)
  mkdirSync(repo)
  git(repo, "init", "--quiet")
  git(repo, "config", "user.name", "CI suite test")
  git(repo, "config", "user.email", "ci-suite-test@example.invalid")
  git(repo, "config", "commit.gpgsign", "false")
  writeFileSync(join(repo, "README.md"), "fixture\n")
  git(repo, "add", "--all")
  git(repo, "commit", "--quiet", "-m", "initial")
  return repo
}

function writeFile(repo, path, content = "fixture\n") {
  const file = join(repo, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function commit(repo, message) {
  git(repo, "add", "--all")
  git(repo, "commit", "--quiet", "-m", message)
  return git(repo, "rev-parse", "HEAD")
}

function runCli(repo, env) {
  return spawnSync(process.execPath, [script], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 10_000,
  })
}

function runChangedCiSuites(repo, args) {
  const source = `
    import { changedCiSuites } from ${JSON.stringify(selectorUrl)}
    const args = JSON.parse(process.env.SELECTOR_ARGS)
    try {
      process.stdout.write(JSON.stringify(changedCiSuites(...args)))
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, SELECTOR_ARGS: JSON.stringify(args) },
    timeout: 10_000,
  })
  assert.ifError(result.error)
  return result
}

function selectChangedFiles(repo, ...args) {
  const result = runChangedCiSuites(repo, args)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test("path selection keeps documentation and installer scripts out while covering Hub consumers", () => {
  const excluded = [
    "README.md",
    "docs/guide.md",
    "hub/docs/guide.md",
    "hub/AGENTS.md",
    ".github/skills/write-tests/SKILL.md",
    ".github/assets/logo.svg",
    ".github/ISSUE_TEMPLATE/bug.yml",
    "scripts/create-prototype-repo.sh",
    "scripts/create-prototype-repo.test.mjs",
    "scripts/install-starter.sh",
    "scripts/setup-replica-plugin.test.mjs",
    "starters/catalog.tsv",
    "scripts/starter-catalog.sh",
    "scripts/check-starter.sh",
    "scripts/starter-ci-matrix.sh",
  ]
  for (const path of excluded) {
    assert.deepEqual(selectCiSuites([path]), { hub: false, build_action: false }, path)
  }

  for (const path of [
    "hub/app/models/prototype.rb",
    ".github/extensions/replica-prototype/extension.mjs",
    ".github/plugin/README.md",
    "packages/learning/src/index.mjs",
    "starters/minimal/.agents/skills/prototype-controls/SKILL.md",
    "starters/minimal/src/app/router.tsx",
    "starters/minimal/package-lock.json",
    "starters/minimal/.prototype",
    "starters/minimal/.agents/skills/setup-skills/SKILL.md",
    "starters/minimal/src/App.jsx",
    "starters/shared/.agents/skills/setup-skills/SKILL.md",
    "starters/shared/scripts/setup-replica-plugin.mjs",
    "starters/coreai/src/App.tsx",
    "starters/coreai/package-lock.json",
    "starters/future-team/src/App.tsx",
  ]) {
    assert.deepEqual(selectCiSuites([path]), { hub: true, build_action: false }, path)
  }
  for (const path of [
    "hub/app/javascript/utils/prototype-controls/controls.ts",
    "actions/build/src/index.mjs",
  ]) {
    assert.deepEqual(selectCiSuites([path]), { hub: true, build_action: true }, path)
  }
})

test("mixed changes union selections and unknown or CI configuration paths select both suites", () => {
  assert.deepEqual(
    selectCiSuites(["docs/guide.md", "hub/app/models/prototype.rb", "starters/minimal/src/App.jsx"]),
    { hub: true, build_action: false },
  )
  for (const path of [
    ".github/workflows/hub-ci.yml",
    ".github/workflows/ci-changes.yml",
    "scripts/select-ci-suites.mjs",
    ".github/extensions/new-extension/extension.yml",
    "new-root-file.txt",
  ]) {
    assert.deepEqual(selectCiSuites([path]), { hub: true, build_action: true }, path)
  }
})

test("pushes always select both suites while pull requests diff from their merge base", () => {
  const repo = createRepo("merge-base")
  assert.deepEqual(selectChangedFiles(repo, "push"), { hub: true, build_action: true })
  const common = git(repo, "rev-parse", "HEAD")
  git(repo, "switch", "--quiet", "-c", "base")
  writeFile(repo, "hub/base-only.rb")
  const base = commit(repo, "change base")
  git(repo, "switch", "--quiet", "-c", "head", common)
  // Keep the newline path in Git's index; Windows cannot create it on disk.
  writeFile(repo, "docs/guide.md")
  git(repo, "add", "--all")
  const blob = git(repo, "rev-parse", `${common}:README.md`)
  git(repo, "config", "core.protectNTFS", "false")
  git(repo, "update-index", "--add", "--cacheinfo", `100644,${blob},docs/release\nhub/not-a-path.rb`)
  git(repo, "commit", "--quiet", "-m", "change pull request")
  const head = git(repo, "rev-parse", "HEAD")

  assert.deepEqual(selectChangedFiles(repo, "pull_request", base, head), {
    hub: false,
    build_action: false,
  })
})

test("pull-request diffs count deleted paths and both sides of cross-boundary renames", () => {
  const deletionRepo = createRepo("deletion")
  writeFile(deletionRepo, "actions/build/removed.mjs")
  const withFile = commit(deletionRepo, "add build file")
  unlinkSync(join(deletionRepo, "actions/build/removed.mjs"))
  const deletionHead = commit(deletionRepo, "delete build file")
  assert.deepEqual(selectChangedFiles(deletionRepo, "pull_request", withFile, deletionHead), {
    hub: true,
    build_action: true,
  })

  const oldPathRepo = createRepo("rename-old-path")
  writeFile(oldPathRepo, "actions/build/renamed.mjs")
  const oldPathWithFile = commit(oldPathRepo, "add action file")
  mkdirSync(join(oldPathRepo, "docs"), { recursive: true })
  git(oldPathRepo, "mv", "actions/build/renamed.mjs", "docs/renamed.mjs")
  const oldPathHead = commit(oldPathRepo, "move action file to docs")
  assert.deepEqual(selectChangedFiles(oldPathRepo, "pull_request", oldPathWithFile, oldPathHead), {
    hub: true,
    build_action: true,
  })

  const newPathRepo = createRepo("rename-new-path")
  writeFile(newPathRepo, "docs/renamed.mjs")
  const newPathWithFile = commit(newPathRepo, "add documentation file")
  mkdirSync(join(newPathRepo, "hub/app"), { recursive: true })
  git(newPathRepo, "mv", "docs/renamed.mjs", "hub/app/renamed.mjs")
  const newPathHead = commit(newPathRepo, "move docs to Hub")
  assert.deepEqual(selectChangedFiles(newPathRepo, "pull_request", newPathWithFile, newPathHead), {
    hub: true,
    build_action: false,
  })
})

test("invalid event data and unavailable git history fail explicitly", () => {
  const repo = createRepo("invalid-data")
  const unsupported = runChangedCiSuites(repo, ["schedule"])
  assert.notEqual(unsupported.status, 0)
  assert.match(unsupported.stderr, /Unsupported CI event/)
  const validSha = "b".repeat(40)
  for (const [base, head] of [
    [undefined, validSha],
    [validSha, undefined],
    ["abc", validSha],
    [validSha, "abc"],
    ["A".repeat(40), validSha],
    [validSha, "A".repeat(40)],
  ]) {
    const result = runChangedCiSuites(repo, ["pull_request", base, head])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /full base and head commit SHAs/)
  }

  const missingHistory = runChangedCiSuites(repo, [
    "pull_request",
    "a".repeat(40),
    "b".repeat(40),
  ])
  assert.notEqual(missingHistory.status, 0)
  assert.match(missingHistory.stderr, /fatal|git/i)
})

test("the CLI writes suite booleans and fails without an output file", () => {
  const repo = createRepo("cli")
  const base = git(repo, "rev-parse", "HEAD")
  writeFile(repo, "hub/app/models/prototype.rb")
  const head = commit(repo, "change Hub")
  const output = join(repo, "github-output")
  const env = {
    CI_EVENT_NAME: "pull_request",
    CI_BASE_SHA: base,
    CI_HEAD_SHA: head,
    GITHUB_OUTPUT: output,
  }

  const result = runCli(repo, env)
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split("\n").sort(), [
    "build_action=false",
    "hub=true",
  ])
  assert.deepEqual(readFileSync(output, "utf8").trim().split("\n").sort(), [
    "build_action=false",
    "hub=true",
  ])

  const missingOutputEnv = { ...env, GITHUB_OUTPUT: undefined }
  const missingOutput = runCli(repo, missingOutputEnv)
  assert.ifError(missingOutput.error)
  assert.notEqual(missingOutput.status, 0)
  assert.equal(missingOutput.stdout, "")
  assert.match(missingOutput.stderr, /GITHUB_OUTPUT is required/)
  assert.equal(missingOutput.signal, null)
  assert.deepEqual(readFileSync(output, "utf8").trim().split("\n").sort(), [
    "build_action=false",
    "hub=true",
  ])
})
