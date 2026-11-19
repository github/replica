import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  const directory = mkdtempSync(join(root, ".workflows-test-"))
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

  it.each([
    "same-job screenshots",
    "missing dependency",
    "missing publish action",
    "build-only omitted",
    "build-only disabled",
    "build in screenshot job",
  ])("rejects a build smoke workflow with %s", (regression) => {
    const directory = fixture()
    const path = join(directory, ".github/workflows/actions-ci.yml")
    const workflow = parse(readFileSync(path, "utf8")) as Workflow
    const { publish, screenshots } = workflow.jobs
    assert(publish?.steps && screenshots?.steps)
    const publishAction = publish.steps.find((step) => step.uses === "./actions/build/publish")
    const buildAction = publish.steps.find((step) => step.uses === "./actions/build")
    assert(publishAction && buildAction?.with)
    if (regression === "same-job screenshots") {
      publish.steps.push({ uses: "./actions/build/screenshots" })
    } else if (regression === "missing dependency") {
      delete screenshots.needs
    } else if (regression === "missing publish action") {
      publishAction.uses = "./actions/build"
    } else if (regression === "build in screenshot job") {
      screenshots.steps.push({ uses: "./actions/build", with: { "build-only": "true" } })
    } else if (regression === "build-only omitted") {
      delete buildAction.with["build-only"]
    } else {
      buildAction.with["build-only"] = "false"
    }
    writeFileSync(path, stringify(workflow))

    expect(() => checkWorkflows(directory)).toThrow()
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

describe("documented prototype workflow", () => {
  it("publishes the dist before a dependent screenshot job using the same action revision", () => {
    const guide = readFileSync(join(root, "hub/docs/github-actions-builds.md"), "utf8")
    const examples = [...guide.matchAll(/^```yaml\r?\n([\s\S]*?)^```/gm)]
    expect(examples).toHaveLength(1)
    const workflow = parse(examples[0][1]) as Workflow & {
      permissions?: Record<string, string>
    }

    expect(workflow.on).toHaveProperty("push")
    expect(workflow.permissions).toEqual({ contents: "read" })
    const { publish, screenshots } = workflow.jobs
    assert(publish?.steps && screenshots?.steps)
    expect(publish.needs).toBeUndefined()
    expect([screenshots.needs].flat()).toEqual(["publish"])
    const publishAction = publish.steps.find((step) =>
      step.uses?.startsWith("github/replica/actions/build/publish@"),
    )
    const revision = publishAction?.uses?.match(/@([a-f0-9]{40})$/)?.[1]
    expect(revision).toBeDefined()
    expect(
      screenshots.steps.some(
        (step) => step.uses === `github/replica/actions/build/screenshots@${revision}`,
      ),
    ).toBe(true)
    expect(publish.steps.some((step) => step.uses?.includes("/build/screenshots@"))).toBe(false)
    for (const job of [publish, screenshots]) {
      const checkout = job.steps?.find((step) => step.uses?.startsWith("actions/checkout@"))
      expect(checkout?.with?.["persist-credentials"]).toBe(false)
    }
  })
})
