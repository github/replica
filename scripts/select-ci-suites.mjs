import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const documentation = new Set([
  "AGENTS.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE.md",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  ".github/pull_request_template.md",
])

const starterScripts = new Set([
  "starters/catalog.tsv",
  "scripts/check-starter.sh",
  "scripts/starter-catalog.sh",
  "scripts/starter-ci-matrix.sh",
  "scripts/starter-catalog.test.mjs",
  "scripts/create-prototype-repo.sh",
  "scripts/create-prototype-repo.test.mjs",
  "scripts/shadcn-starter.test.mjs",
  "scripts/install-starter.sh",
  "scripts/setup-replica-plugin.test.mjs",
])

export function selectCiSuites(paths) {
  const suites = { hub: false, build_action: false }
  for (const path of paths) {
    if (path.startsWith("hub/app/javascript/utils/prototype-controls/")) {
      suites.hub = true
      suites.build_action = true
    } else if (path.startsWith("actions/build/")) {
      suites.hub = true
      suites.build_action = true
    } else if (
      documentation.has(path) ||
      starterScripts.has(path) ||
      path.startsWith("docs/") ||
      path.startsWith("hub/docs/") ||
      path === "hub/AGENTS.md" ||
      path.startsWith(".github/skills/") ||
      path.startsWith(".github/assets/") ||
      path.startsWith(".github/ISSUE_TEMPLATE/")
    ) {
      continue
    } else if (
      path.startsWith("hub/") ||
      path.startsWith(".github/extensions/replica-prototype/") ||
      path.startsWith(".github/plugin/") ||
      path.startsWith("packages/learning/") ||
      path.startsWith("starters/")
    ) {
      suites.hub = true
    } else {
      suites.hub = true
      suites.build_action = true
    }
  }
  return suites
}

export function changedCiSuites(event, base, head) {
  if (event === "push") return { hub: true, build_action: true }
  if (event !== "pull_request") throw new Error(`Unsupported CI event: ${event}`)
  if (![base, head].every((sha) => typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error("CI selection requires full base and head commit SHAs.")
  }
  const paths = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`, "--"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean)
  return selectCiSuites(paths)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const suites = changedCiSuites(
    process.env.CI_EVENT_NAME,
    process.env.CI_BASE_SHA,
    process.env.CI_HEAD_SHA,
  )
  const output = Object.entries(suites)
    .map(([suite, selected]) => `${suite}=${selected}\n`)
    .join("")
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required for CI selection.")
  appendFileSync(process.env.GITHUB_OUTPUT, output)
  process.stdout.write(output)
}
