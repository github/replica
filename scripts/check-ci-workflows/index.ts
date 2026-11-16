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
    ["actions-ci", ["test", "publish", "screenshots"]],
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
      if (name === "actions-ci" && id === "screenshots") {
        assert.equal(job.needs, "publish", `${name}/${id}: consume the publish job's artifact`)
      } else {
        assert(!job.needs, `${name}/${id}: checks must run independently`)
      }
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
  const actionJobs = workflow("actions-ci").jobs
  const publishSteps = actionJobs.publish.steps
  const screenshotSteps = actionJobs.screenshots.steps
  assert(publishSteps && screenshotSteps, "Missing build-action artifact jobs")
  const fixture = publishSteps.find((step) => step.uses === "./actions/build")
  const publish = publishSteps.find((step) => step.uses === "./actions/build/publish")
  const screenshots = screenshotSteps.find((step) => step.uses === "./actions/build/screenshots")
  assert(fixture && publish && screenshots, "Run publish and screenshots in separate jobs")
  assert.equal(fixture.with?.["build-only"], "true", "Build without uploading before publish")
  assert(
    !fixture.if && !publish.if && !screenshots.if,
    "Artifact smoke steps must run unconditionally",
  )
  for (const [id, job] of Object.entries(actionJobs)) {
    if (id !== "publish") {
      assert(
        !job.steps?.some((step) => step.uses === "./actions/build"),
        "Build the composite fixture only in the publish job",
      )
    }
    if (id !== "publish") {
      assert(
        !job.steps?.some((step) => step.uses === "./actions/build/publish"),
        "Upload the composite fixture only once, in the publish job",
      )
    }
    if (id !== "screenshots") {
      assert(
        !job.steps?.some((step) => step.uses === "./actions/build/screenshots"),
        "Capture screenshots only in the dependent screenshot job",
      )
    }
  }
  for (const steps of [publishSteps, screenshotSteps]) {
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"))
    assert.equal(checkout?.with?.["persist-credentials"], false, "Disable checkout credentials")
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

  const deployment = workflow("hub-azure-deploy")
  assert.deepEqual(
    deployment.on,
    { workflow_dispatch: null },
    "Azure deployment must remain an explicit manual action",
  )
  assert.deepEqual(deployment.permissions, {
    contents: "read",
    "id-token": "write",
  })
  assert.deepEqual(deployment.concurrency, {
    group: "hub-azure-development",
    "cancel-in-progress": false,
  })
  assert.deepEqual(Object.keys(deployment.jobs), ["deploy"])
  const deploy = deployment.jobs.deploy
  assert.equal(deploy.environment, "hub-azure-development")
  assert.equal(
    deploy.env?.AZURE_RUNTIME_ENVIRONMENT_JSON,
    "${{ vars.AZURE_RUNTIME_ENVIRONMENT_JSON }}",
    "Deployment must read non-secret runtime settings from the protected Environment",
  )
  assert(!JSON.stringify(deployment).includes("secrets."), "Deployment must not read GitHub secrets")
  assert(
    deploy.steps?.every(
      (step) => !step.uses || step.uses.startsWith("./") || /@[a-f0-9]{40}$/.test(step.uses),
    ),
    "Deployment actions must use immutable commit SHAs",
  )
  assert(
    deploy.steps?.some(
      (step) =>
        step.uses === "azure/login@7184910d9eb2b1c5e48f7073824a90609bb9b6d6" &&
        step.with?.["client-id"] === "${{ vars.AZURE_CLIENT_ID }}" &&
        step.with?.["tenant-id"] === "${{ vars.AZURE_TENANT_ID }}" &&
        step.with?.["subscription-id"] === "${{ vars.AZURE_SUBSCRIPTION_ID }}",
    ),
    "Deployment must authenticate to Azure with the protected environment's OIDC identity",
  )
  const image = deploy.steps?.find((step) => step.name === "Build and publish the checked-out commit")
  assert(
    image?.run?.includes("docker buildx build") &&
      image.run.includes("--metadata-file") &&
      image.run.includes("--push") &&
      image.run.includes("containerimage.digest") &&
      image.run.includes("reference=%s@%s"),
    "Deployment must publish the checked-out commit and return an immutable image digest",
  )
  const configuration = deploy.steps?.find(
    (step) => step.name === "Prepare non-secret deployment configuration",
  )
  assert(
    configuration?.run?.includes("deployment_storage_principal_id: required(") &&
      configuration.run.includes('"AZURE_DEPLOYMENT_STORAGE_PRINCIPAL_ID"') &&
      configuration.run.includes('record("AZURE_RUNTIME_ENVIRONMENT_JSON")') &&
      configuration.run.includes("runtime_environment_variables: environment") &&
      configuration.run.includes("runtime_secret_references: references"),
    "Deployment must preserve the storage principal and separate public runtime settings from secret references",
  )
  const release = deploy.steps?.find(
    (step) => step.name === "Run the serialized maintenance-window release",
  )
  assert(
    release?.run?.includes("node infrastructure/azure/deploy-hub/index.ts release") &&
      release.run.includes('--image "$HUB_IMAGE"') &&
      release.env?.HUB_IMAGE === "${{ steps.image.outputs.reference }}",
    "Deployment must use the serialized Hub release path",
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkWorkflows(resolve(import.meta.dirname, "../.."))
  console.log("Independent CI checks and supported Node versions passed.")
}
