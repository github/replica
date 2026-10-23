import { cp, mkdir } from "node:fs/promises"

const source = new URL("../../starter/.agents/skills/review-hub-feedback/", import.meta.url)
const destination = new URL(
  "../../.github/extensions/replica-prototype/skills/review-hub-feedback/",
  import.meta.url,
)
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })
