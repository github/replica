import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parse } from "yaml"

import type { Workflow } from "./types.ts"

const expression = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
    .trim()
const suffix = "${{ matrix.node == 26 && ' (Node 26)' || '' }}"

export function checkWorkflows(root: string): void {
  const workflow = (name: string): Workflow =>
    parse(readFileSync(resolve(root, `.github/workflows/${name}.yml`), "utf8")) as Workflow
  for (const [name, ids] of [
    ["hub-ci", ["check", "integration"]],
    ["actions-ci", ["test"]],
    ["starter-ci", ["test"]],
    ["learning-ci", ["test"]],
    ["scripts-ci", ["check"]],
  ] as const) {
    const { jobs, on: triggers } = workflow(name)
    assert(triggers, `${name}: missing workflow triggers`)
    assert("pull_request" in triggers, `${name}: run on every pull request`)
    assert.equal(triggers.pull_request, null, `${name}: pull requests must not filter changes`)
    assert.deepEqual(triggers.push, { branches: ["main"] }, `${name}: run on every main push`)
    assert.deepEqual(Object.keys(jobs).sort(), [...ids].sort(), `${name}: individual checks only`)
    for (const [id, job] of Object.entries(jobs)) {
      assert(!job.if, `${name}/${id}: checks must run unconditionally`)
      assert(!job.needs, `${name}/${id}: checks must run independently`)
      assert(!job.uses && job.steps?.length, `${name}/${id}: run checks, not an aggregate gate`)
    }
  }
  for (const project of ["hub", "starter", "actions/build", "packages/learning", "scripts"]) {
    const manifest = JSON.parse(readFileSync(resolve(root, project, "package.json"), "utf8"))
    const lock = JSON.parse(readFileSync(resolve(root, project, "package-lock.json"), "utf8"))
    assert.equal(manifest.engines.node, "^24.15.0 || ^26.0.0", `${project}: supported Node majors`)
    assert.deepEqual(lock.packages[""].engines, manifest.engines, `${project}: locked engines`)
  }
  for (const [name, ids] of [
    ["hub-ci", ["check", "integration"]],
    ["actions-ci", ["test"]],
    ["starter-ci", ["test"]],
    ["learning-ci", ["test"]],
  ] as const) {
    for (const id of ids) {
      const job = workflow(name).jobs[id]
      assert(job.strategy && job.steps, `${name}/${id}: missing Node checks`)
      assert.deepEqual(job.strategy.matrix.node, [24, 26], `${name}/${id}: Node matrix`)
      assert.equal(job.strategy["fail-fast"], false, `${name}/${id}: independent matrix results`)
      assert(job.name?.endsWith(suffix), `${name}/${id}: distinguish Node 26 check names`)
      const setup = job.steps.find((step) => step.uses?.startsWith("actions/setup-node@"))
      assert.equal(expression(setup?.with?.["node-version"]), "matrix.node")
      const installs = job.steps.filter((step) => step.run?.startsWith("npm ci"))
      assert(
        installs.length &&
          installs.every((step) => step.run?.split(/\s+/).includes("--engine-strict")),
        `${name}/${id}: enforce dependency engines`,
      )
    }
  }
  const hub = workflow("hub-ci").jobs
  assert.deepEqual(hub.check.strategy?.matrix.command, [
    "lint",
    "typecheck",
    "test",
    "build",
    "storybook:build",
    "db:validate",
    "test:database",
  ])
  assert(hub.check.steps?.some((step) => step.run === "npm run ${{ matrix.command }}"))
  for (const command of [
    "controls:test",
    "extension:test",
    "controls:assets:check",
    "extension:assets:check",
  ]) {
    assert(
      hub.integration.steps?.some((step) => step.run?.includes(`npm run ${command}`)),
      `Hub integration must run ${command}`,
    )
  }
  const actionSteps = workflow("actions-ci").jobs.test.steps
  assert(actionSteps, "Missing build-action steps")
  for (const step of [
    actionSteps.find((step) => step.name === "Prepare composite action fixture"),
    actionSteps.find((step) => step.uses === "./actions/build"),
  ]) {
    assert(step, "Composite smoke fixture and action must run")
    assert.equal(expression(step.if), "matrix.node == 24", "Upload the composite fixture only once")
  }
  const scripts = workflow("scripts-ci").jobs.check
  assert.deepEqual(scripts.strategy?.matrix.command, ["typecheck", "test", "check:workflows"])
  assert.equal(scripts.strategy?.["fail-fast"], false)
  assert(
    scripts.steps?.some(
      (step) => step.run === "npm ci --prefix scripts --ignore-scripts --engine-strict",
    ),
    "Scripts checks must install tooling",
  )
  assert(
    scripts.steps?.some((step) => step.run === "npm run ${{ matrix.command }} --prefix scripts"),
    "Scripts checks must run each tooling command",
  )
  const ageSteps = workflow("dependency-age").jobs.audit.steps
  assert(
    ageSteps?.some((step) => step.run === "node scripts/check-dependency-age/index.ts"),
    "Dependency age must run unconditionally",
  )
  assert(!workflow("dependency-age").jobs.audit.if, "Dependency age must run unconditionally")
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkWorkflows(resolve(import.meta.dirname, "../.."))
  console.log("Independent CI checks and supported Node versions passed.")
}
