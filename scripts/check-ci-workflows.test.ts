import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parse, stringify } from "yaml"
import { checkWorkflows, type Workflow } from "./check-ci-workflows.ts"

const root = resolve(import.meta.dirname, "..")
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(import.meta.dirname, ".workflows-test-"))
  directories.push(directory)
  mkdirSync(join(directory, ".github"), { recursive: true })
  cpSync(join(root, ".github/workflows"), join(directory, ".github/workflows"), { recursive: true })
  for (const project of ["hub", "starter", "actions/build", "packages/learning", "scripts"]) {
    mkdirSync(join(directory, project), { recursive: true })
    for (const name of ["package.json", "package-lock.json"]) {
      cpSync(join(root, project, name), join(directory, project, name))
    }
  }
  return directory
}

test("the committed workflows reject failed, cancelled, skipped, and missing selected results", () => {
  assert.equal(checkWorkflows(root), 600)
})

test("rejects a result check that silently accepts failed jobs", () => {
  const directory = fixture()
  const path = join(directory, ".github/workflows/hub-ci.yml")
  const workflow = parse(readFileSync(path, "utf8")) as Workflow
  assert(workflow.jobs.result.steps)
  workflow.jobs.result.steps[0].run = "exit 0"
  writeFileSync(path, stringify(workflow))
  assert.throws(() => checkWorkflows(directory), /hub-ci/)
})

test("rejects a result check that reads the wrong suite choice", () => {
  const directory = fixture()
  const path = join(directory, ".github/workflows/actions-ci.yml")
  const workflow = parse(readFileSync(path, "utf8")) as Workflow
  assert(workflow.jobs.result.steps?.[0].env)
  workflow.jobs.result.steps[0].env.SELECTED = "${{ needs.changes.outputs.hub }}"
  writeFileSync(path, stringify(workflow))
  assert.throws(() => checkWorkflows(directory), /build_action/)
})

test("rejects missing supported Node versions and required commands", () => {
  for (const mutation of [
    (workflow: Workflow) => {
      assert(workflow.jobs.check.strategy)
      workflow.jobs.check.strategy.matrix.node = [24]
    },
    (workflow: Workflow) => {
      assert(workflow.jobs.check.strategy)
      workflow.jobs.check.strategy.matrix.command.pop()
    },
  ]) {
    const directory = fixture()
    const path = join(directory, ".github/workflows/hub-ci.yml")
    const workflow = parse(readFileSync(path, "utf8")) as Workflow
    mutation(workflow)
    writeFileSync(path, stringify(workflow))
    assert.throws(() => checkWorkflows(directory))
  }
})
