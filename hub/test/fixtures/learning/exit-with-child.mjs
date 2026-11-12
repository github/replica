import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"

const marker = process.env.REPLICA_LEARNING_PROCESS_MARKER
if (!marker) throw new Error("Missing process marker.")

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
  stdio: "ignore",
})
child.unref()
await writeFile(marker, String(child.pid))
process.stdout.write(JSON.stringify({ complete: true }))
