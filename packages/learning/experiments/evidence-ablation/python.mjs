#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const commands = {
  fixtures: ["generate_synthetic.py"],
  demo: ["demo.py", ...process.argv.slice(3)],
  run: ["evidence_ablation.py", ...process.argv.slice(3)],
  test: ["-m", "unittest", "discover", "-s", "tests", "-t", "."],
}
const selected = process.argv[2]
if (!Object.hasOwn(commands, selected)) {
  console.error("usage: node python.mjs fixtures|demo|run|test [arguments]")
  process.exit(2)
}

const candidates = [
  process.env.REPLICA_PYTHON,
  "python3.13",
  "python3.12",
  "python3.11",
  "python3.10",
  "python3",
].filter(Boolean)

let python
for (const candidate of candidates) {
  const check = spawnSync(
    candidate,
    ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"],
    { stdio: "ignore" },
  )
  if (check.status === 0) {
    python = candidate
    break
  }
}
if (!python) {
  console.error(
    "error: The evidence ablation harness needs Python 3.10 or later. Set REPLICA_PYTHON to a supported executable.",
  )
  process.exit(1)
}

const result = spawnSync(python, commands[selected], {
  cwd: directory,
  stdio: "inherit",
})
if (result.error) {
  console.error(`error: Cannot run ${python}: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
