import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { CommandExecutionError } from "../../../installer/command/index.ts"
import { terraformModule } from "../../../terraform/index.ts"
import { writeRemovalBackend } from "../backend/index.ts"
import { stageRemovalModule } from "../stage-module/index.ts"
import { readTerraformLock } from "../read-state-lock/index.ts"
import type { TerraformLockSnapshot } from "../parse-state-lock/index.ts"
import type { RemovalContext, RemovalModule } from "../types.ts"

export async function recoverTerraformState(
  context: RemovalContext,
  {
    kind,
    staging,
    expected,
    verify,
  }: {
    kind: RemovalModule
    staging: string
    expected: TerraformLockSnapshot
    verify(): Promise<string>
  },
): Promise<void> {
  const { run, signal, ui } = context
  const env = { ...context.env, TF_WORKSPACE: "default" }
  function changed(): never {
    throw new Error(
      "Terraform state lock or removal safety evidence changed. No state unlock was attempted; review the current writer.",
    )
  }
  signal?.throwIfAborted()
  await verify()
  const initial = await readTerraformLock(context, kind)
  if (!initial) return
  if (initial.fingerprint !== expected.fingerprint) changed()
  const directory = join(staging, `recover-${kind}`)
  const source = join(directory, kind)
  const { backend, data } = await writeRemovalBackend(context, kind, directory)
  await stageRemovalModule(kind, source)
  await terraformModule({
    directory: source,
    dataDirectory: data,
    run,
    env,
    signal,
    ui: { ...ui, select: undefined },
  }).init(backend)
  const evidence = await verify()
  const before = await readTerraformLock(context, kind)
  if (!before) return
  if (before.fingerprint !== expected.fingerprint) changed()
  // Quiet metadata supplements the operator's stopped-process confirmation; it cannot prove it.
  await delay(1_000, undefined, { signal })
  const freshEvidence = await verify()
  const fresh = await readTerraformLock(context, kind)
  if (freshEvidence !== evidence) changed()
  if (!fresh) return
  if (fresh.fingerprint !== before.fingerprint || fresh.id !== before.id) changed()
  signal?.throwIfAborted()
  ui.status(`Recovering the verified ${kind} state lock under confirmed removal`)
  try {
    await run("terraform", [`-chdir=${source}`, "force-unlock", "-force", fresh.id], {
      env: { ...env, TF_DATA_DIR: data },
      signal,
    })
  } catch (error) {
    if (error instanceof CommandExecutionError)
      throw new CommandExecutionError(
        `Terraform state recovery for ${context.config.name}/${kind} did not complete. Its result may be unknown; no unlock was retried.`,
        error.aborted,
        error.exitCode,
        "The exact state lease was not verified as released. Inspect its current status before a new confirmed removal. Lock identifiers and raw command diagnostics were not printed.",
      )
    throw error
  }
  if (await readTerraformLock(context, kind))
    throw new Error(
      "Terraform did not leave the selected state unlocked. No recovery retry was attempted.",
    )
  await verify()
}
