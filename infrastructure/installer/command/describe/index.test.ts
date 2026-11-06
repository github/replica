import assert from "node:assert/strict"
import { it } from "node:test"

import { describeCommand } from "./index.ts"

for (const [operation, name, label] of [
  ["containerapp revision list", "az.containerapp.revision.list", "Inspect Hub revision activity"],
  [
    "containerapp revision show",
    "az.containerapp.revision.show",
    "Inspect Hub revision activation",
  ],
  ["containerapp revision activate", "az.containerapp.revision.activate", "Activate Hub revision"],
  [
    "containerapp revision deactivate",
    "az.containerapp.revision.deactivate",
    "Deactivate Hub revision",
  ],
  ["containerapp replica list", "az.containerapp.replica.list", "Inspect remaining Hub replicas"],
  ["containerapp list", "az.containerapp.list", "Inspect deployed Hub apps"],
  ["containerapp show", "az.containerapp.show", "Inspect the deployed Hub app"],
  ["storage blob lease acquire", "az.storage.blob.lease.acquire", "Acquire the deployment lease"],
  ["storage blob lease release", "az.storage.blob.lease.release", "Release the deployment lease"],
  [
    "storage blob lease break",
    "az.storage.blob.lease.break",
    "Recover the selected deployment lease",
  ],
  ["containerapp job list", "az.containerapp.job.list", "Inspect deployment jobs"],
  [
    "containerapp job execution list",
    "az.containerapp.job.execution.list",
    "Inspect database job executions",
  ],
  [
    "containerapp job execution show",
    "az.containerapp.job.execution.show",
    "Check database job progress",
  ],
  ["containerapp job start", "az.containerapp.job.start", "Start the database job"],
]) {
  it(`describes Azure ${operation} without its resource or secret arguments`, () => {
    assert.deepEqual(
      describeCommand("az", [
        ...operation.split(" "),
        "--name",
        "synthetic-private-resource",
        "--lease-id",
        "synthetic-private-lease",
        "--value",
        "synthetic-private-secret",
      ]),
      { name, label },
    )
  })
}

for (const [operation, name, label] of [
  ["init", "terraform.init", "Initialize Terraform"],
  ["state list", "terraform.state.list", "Inspect Terraform ownership"],
  ["output", "terraform.output", "Read Terraform outputs"],
  ["plan", "terraform.plan", "Plan Terraform changes"],
  ["show", "terraform.show", "Inspect the Terraform plan"],
  ["apply", "terraform.apply", "Apply Terraform changes"],
]) {
  it(`describes Terraform ${operation} with or without a private -chdir argument`, () => {
    for (const prefix of [[], ["-chdir=synthetic-private-directory"]]) {
      assert.deepEqual(
        describeCommand("terraform", [
          ...prefix,
          ...operation.split(" "),
          "-var=synthetic-private-secret",
          "synthetic-private-plan.tfplan",
        ]),
        { name, label },
      )
    }
  })
}

it("describes the current Node executable without exposing the script or its arguments", () => {
  assert.deepEqual(
    describeCommand(process.execPath, ["synthetic-private-script.ts", "synthetic-private-secret"]),
    { name: "node", label: "Run Node.js command" },
  )
})

for (const [executable, args] of [
  ["synthetic-private-executable", ["synthetic-private-secret"]],
  ["az", ["containerapp", "revision", "unknown", "synthetic-private-secret"]],
  ["terraform", ["-chdir=synthetic-private-directory", "unknown", "synthetic-private-secret"]],
] as const) {
  it(`uses a fixed fallback for an unknown ${executable === "synthetic-private-executable" ? "executable" : `${executable} operation`}`, () => {
    assert.deepEqual(describeCommand(executable, [...args]), {
      name: "other",
      label: "External command",
    })
  })
}
