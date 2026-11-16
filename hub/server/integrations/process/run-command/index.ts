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
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk))

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  if (code === 0) return

  const detail = Buffer.concat(output).toString("utf8").trim().slice(-700)
  throw new Error(
    detail
      ? `${command} failed while preparing local development: ${detail}`
      : `${command} failed while preparing local development.`,
  )
}
