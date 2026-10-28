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
  it("accepts the committed independent checks on both supported Node versions", () => {
    expect(() => checkWorkflows(root)).not.toThrow()
  })

  it("runs the Entra setup contract through the Hub package command on both Node versions", () => {
    const workflow = parse(
      readFileSync(join(root, ".github/workflows/hub-ci.yml"), "utf8"),
    ) as Workflow
    const manifest = JSON.parse(readFileSync(join(root, "hub/package.json"), "utf8"))

    expect(manifest.scripts["test:entra-setup"]).toBe(
      "node --test script/tests/setup-entra-oidc.test.mjs",
    )
    expect(workflow.jobs.check.strategy?.matrix.command).toContain("test:entra-setup")
    expect(workflow.jobs.check.steps).toContainEqual(
      expect.objectContaining({ run: "npm run ${{ matrix.command }}" }),
    )
  })

  it("rejects an aggregate result gate", () => {
    const directory = fixture()
    const path = join(directory, ".github/workflows/hub-ci.yml")
    const workflow = parse(readFileSync(path, "utf8")) as Workflow
    workflow.jobs.result = {
      needs: ["check", "integration"],
      steps: [{ run: "exit 0" }],
    }
    writeFileSync(path, stringify(workflow))
    expect(() => checkWorkflows(directory)).toThrow(/hub-ci/)
  })

  it.each(["if", "needs"] as const)("rejects job-level %s that could skip checks", (key) => {
    const directory = fixture()
    const path = join(directory, ".github/workflows/actions-ci.yml")
    const workflow = parse(readFileSync(path, "utf8")) as Workflow
    workflow.jobs.test[key] = key === "if" ? "${{ false }}" : "changes"
    writeFileSync(path, stringify(workflow))
    expect(() => checkWorkflows(directory)).toThrow(/actions-ci\/test/)
  })

  it.each(["pull_request", "push"] as const)("rejects %s path filters", (event) => {
    const directory = fixture()
    const path = join(directory, ".github/workflows/starter-ci.yml")
    const workflow = parse(readFileSync(path, "utf8")) as Workflow
    assert(workflow.on)
    workflow.on[event] = { ...workflow.on[event], paths: ["starter/**"] }
    writeFileSync(path, stringify(workflow))
    expect(() => checkWorkflows(directory)).toThrow(/starter-ci/)
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
