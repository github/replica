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

function deploymentFixture() {
  const directory = fixture()
  const path = join(directory, ".github/workflows/hub-azure-deploy.yml")
  const workflow = parse(readFileSync(path, "utf8")) as Workflow
  return { directory, path, workflow }
}

describe("checkWorkflows()", () => {
  it("accepts the committed independent checks on both supported Node versions", () => {
    expect(() => checkWorkflows(root)).not.toThrow()
  })

  it("rejects Hub checks without the learning runtime", () => {
    const directory = fixture()
    const path = join(directory, ".github/workflows/hub-ci.yml")
    const workflow = parse(readFileSync(path, "utf8")) as Workflow
    assert(workflow.jobs.check.steps)
    workflow.jobs.check.steps = workflow.jobs.check.steps.filter(
      (step) =>
        step.run !== "npm ci --prefix ../packages/learning --ignore-scripts --engine-strict",
    )
    writeFileSync(path, stringify(workflow))
    expect(() => checkWorkflows(directory)).toThrow(/learning runtime/)
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

  it.each([
    {
      name: "a push trigger",
      mutate(workflow: Workflow) {
        assert(workflow.on)
        workflow.on.push = { branches: ["main"] }
      },
    },
    {
      name: "a different GitHub Environment",
      mutate(workflow: Workflow) {
        workflow.jobs.deploy.environment = "production"
      },
    },
    {
      name: "read-only OIDC permissions",
      mutate(workflow: Workflow) {
        assert(workflow.permissions)
        workflow.permissions["id-token"] = "read"
      },
    },
    {
      name: "cancellation of an in-progress deployment",
      mutate(workflow: Workflow) {
        assert(workflow.concurrency)
        workflow.concurrency["cancel-in-progress"] = true
      },
    },
    {
      name: "a GitHub secret reference",
      mutate(workflow: Workflow) {
        assert(workflow.jobs.deploy.steps)
        workflow.jobs.deploy.steps[0].env = { TOKEN: "${{ secrets.AZURE_TOKEN }}" }
      },
    },
    {
      name: "non-OIDC Azure credentials",
      mutate(workflow: Workflow) {
        const login = workflow.jobs.deploy.steps?.find((step) =>
          step.uses?.startsWith("azure/login@"),
        )
        assert(login?.with)
        login.with["client-id"] = "${{ secrets.AZURE_CLIENT_ID }}"
      },
    },
    {
      name: "a direct bootstrap instead of the serialized release path",
      mutate(workflow: Workflow) {
        const release = workflow.jobs.deploy.steps?.find((step) =>
          step.run?.includes("deploy-hub/index.ts release"),
        )
        assert(release?.run)
        release.run = release.run.replace(
          "deploy-hub/index.ts release",
          "deploy-hub/index.ts bootstrap",
        )
      },
    },
    {
      name: "deployment configuration that drops the preserved storage principal",
      mutate(workflow: Workflow) {
        const configuration = workflow.jobs.deploy.steps?.find(
          (step) => step.name === "Prepare non-secret deployment configuration",
        )
        assert(configuration?.run)
        const mutated = configuration.run.replace(
          /deployment_storage_principal_id: required\([\s\S]*?\),\n\s*runtime_database_secret:/,
          "runtime_database_secret:",
        )
        assert.notEqual(mutated, configuration.run)
        configuration.run = mutated
      },
    },
    {
      name: "deployment configuration that drops non-secret runtime settings",
      mutate(workflow: Workflow) {
        const configuration = workflow.jobs.deploy.steps?.find(
          (step) => step.name === "Prepare non-secret deployment configuration",
        )
        assert(configuration?.run)
        const mutated = configuration.run.replace(
          "runtime_environment_variables: environment,",
          "",
        )
        assert.notEqual(mutated, configuration.run)
        configuration.run = mutated
      },
    },
    {
      name: "a missing protected runtime environment mapping",
      mutate(workflow: Workflow) {
        assert(workflow.jobs.deploy.env)
        delete workflow.jobs.deploy.env.AZURE_RUNTIME_ENVIRONMENT_JSON
      },
    },
    {
      name: "a missing protected runtime secret-reference mapping",
      mutate(workflow: Workflow) {
        assert(workflow.jobs.deploy.env)
        delete workflow.jobs.deploy.env.AZURE_RUNTIME_SECRET_REFERENCES_JSON
      },
    },
    {
      name: "runtime environment generation that defaults a missing mapping",
      mutate(workflow: Workflow) {
        const configuration = workflow.jobs.deploy.steps?.find(
          (step) => step.name === "Prepare non-secret deployment configuration",
        )
        assert(configuration?.run)
        const mutated = configuration.run.replace(
          'record("AZURE_RUNTIME_ENVIRONMENT_JSON", true)',
          'record("AZURE_RUNTIME_ENVIRONMENT_JSON")',
        )
        assert.notEqual(mutated, configuration.run)
        configuration.run = mutated
      },
    },
    {
      name: "runtime secret-reference generation that defaults a missing mapping",
      mutate(workflow: Workflow) {
        const configuration = workflow.jobs.deploy.steps?.find(
          (step) => step.name === "Prepare non-secret deployment configuration",
        )
        assert(configuration?.run)
        const mutated = configuration.run.replace(
          'record("AZURE_RUNTIME_SECRET_REFERENCES_JSON", true)',
          'record("AZURE_RUNTIME_SECRET_REFERENCES_JSON")',
        )
        assert.notEqual(mutated, configuration.run)
        configuration.run = mutated
      },
    },
    {
      name: "a missing protected installation-settings mapping",
      mutate(workflow: Workflow) {
        assert(workflow.jobs.deploy.env)
        delete workflow.jobs.deploy.env.AZURE_INSTALLATION_SETTINGS_JSON
      },
    },
    {
      name: "a missing named GitHub App coordinate",
      mutate(workflow: Workflow) {
        assert(workflow.jobs.deploy.env)
        delete workflow.jobs.deploy.env.AZURE_GITHUB_APP_ID
      },
    },
    {
      name: "deployment configuration that moves GitHub App identity into the generic map",
      mutate(workflow: Workflow) {
        const configuration = workflow.jobs.deploy.steps?.find(
          (step) => step.name === "Prepare non-secret deployment configuration",
        )
        assert(configuration?.run)
        const mutated = configuration.run.replace(
          "...(githubAppId ? { github_app_id: githubAppId } : {}),",
          "",
        )
        assert.notEqual(mutated, configuration.run)
        configuration.run = mutated
      },
    },
  ])("rejects an Azure deployment workflow with $name", ({ mutate }) => {
    const { directory, path, workflow } = deploymentFixture()
    mutate(workflow)
    writeFileSync(path, stringify(workflow))

    expect(() => checkWorkflows(directory)).toThrow()
  })

  it.each([
    "postgres_sku: installationSettings.postgres_sku",
    "postgres_version: installationSettings.postgres_version",
    "backup_retention_days: installationSettings.backup_retention_days",
    "custom_hostname: customHostname",
    "certificate_id: certificateId",
  ])("rejects deployment configuration that omits %s", (field) => {
    const { directory, path, workflow } = deploymentFixture()
    const configuration = workflow.jobs.deploy.steps?.find(
      (step) => step.name === "Prepare non-secret deployment configuration",
    )
    assert(configuration?.run)
    const fieldIndex = configuration.run.lastIndexOf(field)
    assert.ok(fieldIndex >= 0)
    configuration.run =
      configuration.run.slice(0, fieldIndex) +
      configuration.run.slice(fieldIndex + field.length)
    writeFileSync(path, stringify(workflow))

    expect(() => checkWorkflows(directory)).toThrow()
  })

  it("rejects an unpinned action in the Azure deployment workflow", () => {
    const { directory, path, workflow } = deploymentFixture()
    const checkout = workflow.jobs.deploy.steps?.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    )
    assert(checkout)
    checkout.uses = "actions/checkout@v7"
    writeFileSync(path, stringify(workflow))

    expect(() => checkWorkflows(directory)).toThrow()
  })

  it.each([
    {
      name: "does not push the image",
      mutate(run: string) {
        return run.replace("--push", "--load")
      },
    },
    {
      name: "passes a mutable image tag to deployment",
      mutate(run: string) {
        return run.replace("printf 'reference=%s@%s\\n'", "printf 'reference=%s:%s\\n'")
      },
    },
  ])("rejects an Azure deployment workflow that $name", ({ mutate }) => {
    const { directory, path, workflow } = deploymentFixture()
    const build = workflow.jobs.deploy.steps?.find(
      (step) => step.name === "Build and publish the checked-out commit",
    )
    assert(build?.run)
    build.run = mutate(build.run)
    writeFileSync(path, stringify(workflow))

    expect(() => checkWorkflows(directory)).toThrow()
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

    expect(workflow.on).toMatchObject({ push: { branches: ["**"] } })
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
