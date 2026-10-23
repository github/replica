import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { parse, stringify } from "yaml"

import { checkWorkflows } from "."
import type { Workflow } from "./types.ts"

const root = resolve(import.meta.dirname, "../..")
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "replica-workflows-test-"))
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

describe("checkWorkflows()", () => {
  it("rejects failed, cancelled, skipped, and missing selected results in the committed workflows", () => {
    expect(checkWorkflows(root)).toBe(600)
  })

  it("rejects a result check that silently accepts failed jobs", () => {
    const directory = fixture()
    const path = join(directory, ".github/workflows/hub-ci.yml")
    const workflow = parse(readFileSync(path, "utf8")) as Workflow
    assert(workflow.jobs.result.steps)
    workflow.jobs.result.steps[0].run = "exit 0"
    writeFileSync(path, stringify(workflow))
    expect(() => checkWorkflows(directory)).toThrow(/hub-ci/)
  })

  it("rejects a result check that reads the wrong suite choice", () => {
    const directory = fixture()
    const path = join(directory, ".github/workflows/actions-ci.yml")
    const workflow = parse(readFileSync(path, "utf8")) as Workflow
    assert(workflow.jobs.result.steps?.[0].env)
    workflow.jobs.result.steps[0].env.SELECTED = "${{ needs.changes.outputs.hub }}"
    writeFileSync(path, stringify(workflow))
    expect(() => checkWorkflows(directory)).toThrow(/build_action/)
  })

  it("rejects missing supported Node versions and required commands", () => {
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
      expect(() => checkWorkflows(directory)).toThrow()
    }
  })
})
