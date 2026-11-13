import { writeFile } from "node:fs/promises"

const marker = process.argv[2]
const channel = process.argv[3]
if (!marker) throw new Error("Missing process marker.")
if (channel !== "stdout" && channel !== "stderr") throw new Error("Missing output channel.")

await writeFile(
  marker,
  JSON.stringify({ commandPid: process.pid, temporaryDirectory: process.env.TMPDIR }),
)
process[channel].write("x".repeat(4_096))
setInterval(() => {}, 1_000)
