import { mkdir, readFile, writeFile } from "node:fs/promises"

const source = new URL("../../starter/.agents/skills/review-hub-feedback/SKILL.md", import.meta.url)
const destination = new URL(
  "../../.github/extensions/replica-prototype/skills/review-hub-feedback/",
  import.meta.url,
)
await mkdir(destination, { recursive: true })
await writeFile(new URL("SKILL.md", destination), await readFile(source))
