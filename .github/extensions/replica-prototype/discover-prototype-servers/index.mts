import { realpath } from "node:fs/promises"
import path from "node:path"

import { runCommand } from "../run-command/index.mjs"
import type { CommandResult } from "../run-command/index.mjs"

export type PrototypeServer = { url: string; pid: number; command: string; directory: string }
export type PrototypeServers = { servers: PrototypeServer[]; warnings: string[] }
type ProcessInfo = { pid: number; command: string; addresses: string[]; directory?: string }

export async function discoverPrototypeServers(
  repositoryPath: string,
  options: { runCommand?: typeof runCommand; fetch?: typeof globalThis.fetch } = {},
): Promise<PrototypeServers> {
  const command = options.runCommand || runCommand
  const request = options.fetch || globalThis.fetch
  const root = await realpath(repositoryPath)
  const listeners = await command("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], root)
  if (!hasLsofOutput(listeners))
    throw new Error(
      `Could not inspect running servers: ${!listeners.ok ? listeners.error : "Invalid lsof output."}`,
    )

  const processes = new Map<number, ProcessInfo>()
  let current: ProcessInfo | undefined
  for (const line of listeners.stdout.split("\n")) {
    if (/^p\d+$/.test(line)) {
      current = { pid: Number(line.slice(1)), command: "", addresses: [] }
      processes.set(current.pid, current)
    } else if (current && line.startsWith("c")) {
      current.command = line.slice(1)
    } else if (current && line.startsWith("n")) {
      current.addresses.push(line.slice(1))
    }
  }
  // Copilot providers serve their own HTML panels, not prototype applications.
  for (const [pid, processInfo] of processes) {
    if (pid === process.pid || /^(copilot|github)$/.test(processInfo.command)) processes.delete(pid)
  }
  if (!processes.size) return { servers: [], warnings: [] }

  const directories = await command(
    "lsof",
    ["-a", "-p", [...processes.keys()].join(","), "-d", "cwd", "-Fn"],
    root,
  )
  if (!hasLsofOutput(directories))
    throw new Error(
      `Could not inspect server working directories: ${!directories.ok ? directories.error : "Invalid lsof output."}`,
    )
  let pid
  for (const line of directories.stdout.split("\n")) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1))
    else if (line.startsWith("n") && pid !== undefined) {
      const processInfo = processes.get(pid)
      if (processInfo) processInfo.directory = line.slice(1)
    }
  }

  const candidates = new Map<string, PrototypeServer>()
  for (const processInfo of processes.values()) {
    if (!processInfo.directory) continue
    const relative = path.relative(root, processInfo.directory)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      continue
    for (const address of processInfo.addresses) {
      const match = /^(\*|0\.0\.0\.0|127(?:\.\d+){3}|\[::\]|\[::1\]):(\d+)$/.exec(address)
      if (!match?.[1]) continue
      const host =
        match[1] === "[::1]" || match[1] === "[::]"
          ? "[::1]"
          : match[1].startsWith("127.")
            ? match[1]
            : "127.0.0.1"
      const url = `http://${host}:${match[2]}/`
      candidates.set(url, {
        url,
        pid: processInfo.pid,
        command: processInfo.command,
        directory: processInfo.directory,
      })
    }
  }
  const servers: PrototypeServer[] = []
  const warnings: string[] = []
  await Promise.all(
    [...candidates.values()].map(async (candidate) => {
      try {
        const response = await request(candidate.url, {
          signal: AbortSignal.timeout(2000),
          redirect: "manual",
          headers: { Accept: "text/html" },
        })
        await response.body?.cancel()
        if (!response.ok || !/\btext\/html\b/i.test(response.headers.get("content-type") || "")) {
          warnings.push(`${candidate.url} did not return an HTML page (HTTP ${response.status}).`)
          return
        }
        servers.push(candidate)
      } catch (error) {
        warnings.push(
          `${candidate.url} could not be checked: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),
  )
  servers.sort((a, b) => a.url.localeCompare(b.url))
  warnings.sort()
  return { servers, warnings }
}

function hasLsofOutput(result: CommandResult): result is CommandResult & { stdout: string } {
  // lsof uses exit 1 for no matches, including processes that exited between reads.
  return (
    typeof result.stdout === "string" &&
    (result.ok || (result.exitCode === 1 && result.stderr === ""))
  )
}
