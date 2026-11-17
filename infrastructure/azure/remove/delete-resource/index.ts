import { setTimeout as delay } from "node:timers/promises"
import { transientFailure } from "../../../installer/command/transient-failure/index.ts"
import type { RemovalContext } from "../types.ts"

export async function deleteRemovalResource(
  context: Pick<RemovalContext, "azure" | "signal"> & {
    ui: Pick<RemovalContext["ui"], "status">
  },
  args: string[],
  absent: () => Promise<boolean>,
  verify: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    context.signal?.throwIfAborted()
    // A deletion can finish during the retry delay, after which the guard may no longer exist.
    if (attempt > 0 && (await absent())) return
    await verify()
    try {
      await context.azure(...args)
      break
    } catch (error) {
      if (context.signal?.aborted || !transientFailure(error)) throw error
      if (await absent()) return
      if (attempt >= 2) throw error
      context.ui.status(
        "Transient Azure deletion failure. Checking the remaining resource before retrying.",
      )
      await delay([2_000, 5_000][attempt], undefined, {
        signal: context.signal,
      })
    }
  }
  if (!(await absent()))
    throw new Error("Azure deletion completed without verified resource absence. Removal stopped.")
}
