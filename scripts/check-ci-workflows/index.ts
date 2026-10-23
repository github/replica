import assert from "node:assert/strict"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
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
const states = ["success", "failure", "cancelled", "skipped", ""]

export function checkWorkflows(root: string): number {
  const workflow = (name: string): Workflow =>
    parse(readFileSync(resolve(root, `.github/workflows/${name}.yml`), "utf8")) as Workflow
  let cases = 0
  for (const [name, suite, results] of [
    ["hub-ci", "hub", ["check", "integration"]],
    ["actions-ci", "build_action", ["test"]],
  ] as const) {
    const jobs = workflow(name).jobs
    for (const [id, job] of Object.entries(jobs)) {
      if (id === "changes") continue
      assert(
        Array.isArray(job.needs) ? job.needs.includes("changes") : job.needs === "changes",
        `${name}/${id}: missing changes dependency`,
      )
      if (id !== "result") {
        assert.equal(
          expression(job.if),
          `needs.changes.outputs.${suite} == 'true'`,
          `${name}/${id}: require suite selection`,
        )
        continue
      }
      assert.equal(job.name, suite === "hub" ? "Frontend tests" : "Replica action tests")
      assert.equal(expression(job.if), "always()", `${name}: result check must always run`)
      assert(Array.isArray(job.needs), `${name}: result dependencies must be a list`)
      assert.deepEqual([...job.needs].sort(), ["changes", ...results].sort())
      assert(job.steps, `${name}: missing result steps`)
      assert.equal(job.steps.length, 1, `${name}: expected one unconditional result step`)
      const guard = job.steps[0]
      assert(!guard.if, `${name}: result step must not be conditional`)
      assert(guard.env && guard.run, `${name}: result step needs inputs and a command`)
      const expectedEnv: Record<string, string> = {
        SELECTION_RESULT: "needs.changes.result",
        SELECTED: `needs.changes.outputs.${suite}`,
      }
      for (const result of results)
        expectedEnv[`${result.toUpperCase()}_RESULT`] = `needs.${result}.result`
      assert.deepEqual(Object.keys(guard.env).sort(), Object.keys(expectedEnv).sort())
      for (const [key, value] of Object.entries(expectedEnv))
        assert.equal(expression(guard.env[key]), value)
      let combinations: Record<string, string>[] = [{}]
      for (const result of results) {
        combinations = combinations.flatMap((values) =>
          states.map((state) => ({ ...values, [`${result.toUpperCase()}_RESULT`]: state })),
        )
      }
      for (const selection of states) {
        for (const selected of ["true", "false", "invalid", ""]) {
          for (const values of combinations) {
            const env = { SELECTION_RESULT: selection, SELECTED: selected, ...values }
            const expected =
              selection === "success" &&
              ["true", "false"].includes(selected) &&
              Object.values(values).every(
                (state) => state === (selected === "true" ? "success" : "skipped"),
              )
            const run: SpawnSyncReturns<string> = spawnSync(
              "bash",
              ["--noprofile", "--norc", "-e", "-c", guard.run],
              {
                cwd: root,
                env: { ...process.env, BASH_ENV: "", ...env },
                encoding: "utf8",
                timeout: 5000,
              },
            )
            assert.equal(
              run.status === 0,
              expected,
              `${name} ${JSON.stringify(env)}: ${run.error ?? run.stdout + run.stderr}`,
            )
            cases++
          }
        }
      }
    }
    assert(jobs.result, `${name}: missing result check`)
    assert.equal(jobs.changes.uses, "./.github/workflows/ci-changes.yml")
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
  const selectionSteps = workflow("ci-changes").jobs.changes.steps
  assert(selectionSteps, "Missing selection steps")
  for (const command of [
    "npm ci --prefix scripts --ignore-scripts --engine-strict",
    "node --test scripts/select-ci-suites.test.mjs",
    "npm run typecheck --prefix scripts",
    "npm test --prefix scripts",
    "node scripts/check-ci-workflows/index.ts",
  ]) {
    assert(
      selectionSteps.some((step) => step.run === command),
      `Selection must run ${command}`,
    )
  }
  const ageSteps = workflow("dependency-age").jobs.audit.steps
  assert(
    ageSteps?.some((step) => step.run === "node scripts/check-dependency-age/index.ts"),
    "Dependency age must run unconditionally",
  )
  assert(
    !workflow("dependency-age").jobs.audit.if,
    "Dependency age must not depend on suite selection",
  )
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(
    `CI result checks and supported Node versions passed (${checkWorkflows(resolve(import.meta.dirname, "../.."))} shell cases).`,
  )
}
