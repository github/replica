import { spawn } from "node:child_process"

import type { RunCommandOptions } from "./types.ts"

export async function runCommand({
  arguments: commandArguments,
  command,
  cwd,
  environment,
}: RunCommandOptions) {
  const child = spawn(command, commandArguments, {
    cwd,
    env: environment ?? process.env,
    stdio: "ignore",
  })

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  if (code === 0) return

  throw new Error(
    code === null
      ? `${command} stopped without an exit status while preparing local development.`
      : `${command} exited with code ${code} while preparing local development.`,
  )
}
