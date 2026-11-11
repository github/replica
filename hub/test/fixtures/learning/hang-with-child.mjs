import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"

const marker = process.env.REPLICA_LEARNING_PROCESS_MARKER
if (!marker) throw new Error("Missing process marker.")

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
  stdio: "ignore",
})
await writeFile(marker, JSON.stringify({ childPid: child.pid, commandPid: process.pid }))
setInterval(() => {}, 1_000)
