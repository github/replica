import { spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import * as prettier from "prettier"

const project = fileURLToPath(
  new URL("../../.github/extensions/replica-prototype/tsconfig.json", import.meta.url),
)
const compilation = spawnSync(
  "tsc",
  ["--project", project, "--noEmit", "false", "--listEmittedFiles"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
)

if (compilation.error) throw compilation.error
if (compilation.status !== 0) {
  process.stdout.write(compilation.stdout ?? "")
  process.exitCode = compilation.status ?? 1
} else {
  const options = await prettier.resolveConfig(
    fileURLToPath(new URL("../.prettierrc.json", import.meta.url)),
  )

  for (const line of compilation.stdout.split(/\r?\n/)) {
    if (!line.startsWith("TSFILE: ")) continue
    const file = line.slice("TSFILE: ".length)
    if (!file.endsWith(".mjs")) continue
    await writeFile(
      file,
      await prettier.format(await readFile(file, "utf8"), { ...options, filepath: file }),
    )
  }
}
