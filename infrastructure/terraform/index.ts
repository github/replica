import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

import type { InstallerUI, RunCommand } from "../installer/types.ts"

export function terraformModule({
  directory,
  dataDirectory,
  env,
  run,
  ui,
}: {
  directory: string
  dataDirectory: string
  env: NodeJS.ProcessEnv
  run: RunCommand
  ui: InstallerUI
}) {
  const command = (args: string[]) =>
    run("terraform", [`-chdir=${directory}`, ...args], {
      env: { ...env, TF_DATA_DIR: dataDirectory },
    })
  return {
    async init(backend: string) {
      await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
      await command(["init", "-input=false", `-backend-config=${backend}`])
    },
    async state(): Promise<string[]> {
      return (await command(["state", "list"])).split("\n").filter(Boolean)
    },
    async output<T>(name: string): Promise<T> {
      return JSON.parse(await command(["output", "-json", name])) as T
    },
    async apply(variables: string, { destroy = false } = {}) {
      const path = join(dataDirectory, `${randomUUID()}.tfplan`)
      try {
        await command([
          "plan",
          "-input=false",
          "-lock-timeout=60s",
          `-var-file=${variables}`,
          `-out=${path}`,
          ...(destroy ? ["-destroy"] : []),
        ])
        const plan = JSON.parse(await command(["show", "-json", path])) as {
          resource_changes?: { address: string; change: { actions: string[] } }[]
        }
        const changes = (plan.resource_changes ?? []).filter(({ change }) =>
          change.actions.some((action) => action !== "no-op" && action !== "read"),
        )
        if (!destroy && changes.some(({ change }) => change.actions.includes("delete"))) {
          throw new Error(
            "This installation plan deletes or replaces resources. Review recovery separately.",
          )
        }
        for (const change of changes)
          ui.status(`${change.change.actions.join("/")} ${change.address}`)
        if (changes.length)
          ui.notice?.(
            "warning",
            `Terraform changes:\n${changes.map(({ address, change }) => `${change.actions.join("/")} ${address}`).join("\n")}`,
          )
        if (
          changes.length &&
          !(await ui.confirm(
            destroy
              ? "Remove only the temporary database provisioning job, identity, and grants?"
              : "Apply these Terraform changes?",
          ))
        ) {
          throw new Error("Installation cancelled before Terraform apply.")
        }
        await command(["apply", "-input=false", "-lock-timeout=60s", path])
      } finally {
        await rm(path, { force: true })
      }
    },
  }
}
