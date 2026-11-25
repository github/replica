// Runs the first learning milestone end to end on synthetic Hub comments, in a throwaway
// checkout, and prints every command with its output. Nothing leaves this machine.
//
//   npm run demo            remove the checkout afterwards
//   npm run demo -- --keep  keep it and print its path
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { REMOTE, REPOSITORY, weekOneLabels, weekOneLog } from "../conformance/fixtures.mjs"
import { main } from "../src/cli.mjs"

const keep = process.argv.includes("--keep")
const repo = mkdtempSync(path.join(tmpdir(), "replica-learning-demo-"))
execFileSync("git", ["init", "-q", repo])
execFileSync("git", ["-C", repo, "remote", "add", "origin", REMOTE])
writeFileSync(path.join(repo, ".gitignore"), ".replica/\n")
mkdirSync(path.join(repo, ".replica", "learning"), { recursive: true, mode: 0o700 })
writeFileSync(
  path.join(repo, ".replica", "learning", "config.json"),
  JSON.stringify({
    schemaVersion: "replica.learning-config/v1",
    githubRepository: {
      id: "12345",
      remote: `github.com/${REPOSITORY}`,
      legacyRepository: REPOSITORY,
    },
  }),
  { mode: 0o600 },
)
writeFileSync(path.join(repo, "hub-comments.json"), JSON.stringify(weekOneLog(), null, 2))
writeFileSync(path.join(repo, "labels.json"), JSON.stringify(weekOneLabels(), null, 2))

async function step(title, args, { json = false, expectedExitCode = 0 } = {}) {
  console.log(`\n## ${title}\n$ replica-learning ${args.join(" ")}`)
  let output = ""
  const code = await main(json ? [...args, "--json"] : args, {
    cwd: repo,
    stdout: { write: (text) => (output += text) },
    stderr: { write: (text) => (output += text) },
  })
  if (!json) process.stdout.write(output)
  console.log(`(exit ${code})`)
  if (code !== expectedExitCode)
    throw new Error(
      `replica-learning ${args[0]} returned ${code}, expected ${expectedExitCode}:\n${output}`,
    )
  return json ? JSON.parse(output) : output
}

try {
  await step("Where data goes", ["doctor"])
  const grant = await step(
    "A designer records consent: review and instruction only",
    [
      "grants",
      "add",
      "--purpose",
      "review",
      "--purpose",
      "instruction",
      "--basis",
      "Demo team agreement",
      "--by",
      "github:ana-designer",
    ],
    { json: true },
  )
  console.log(`Grant ${grant.id} permits ${grant.purposes.join(", ")}.`)
  await step("The agent imports one week of Hub review threads", [
    "import",
    "hub-comments",
    "hub-comments.json",
    "--grant",
    grant.id,
    "--actor",
    "agent:copilot",
  ])
  await step("The agent labels themes in the comments", [
    "label",
    "labels.json",
    "--actor",
    "agent:copilot",
    "--model",
    "demo-model",
  ])
  const run = await step(
    "Consolidation proposes what recurs",
    [
      "consolidate",
      "--from",
      "2026-09-29T00:00:00Z",
      "--to",
      "2026-10-05T18:00:00Z",
      "--actor",
      "agent:copilot",
    ],
    { json: true },
  )
  console.log(`Status ${run.status}: ${run.summary}`)
  for (const item of run.diagnostics) console.log(`  note: ${item.themeKey ?? ""} ${item.message}`)
  const [proposal] = run.proposals
  await step("Nothing is recalled before a person decides", ["recall"])
  await step("The designer inspects the proposal and its evidence", ["show", proposal.id])
  writeFileSync(
    path.join(repo, "edited.txt"),
    "Put a visible label above every form field. Placeholder text never replaces the label.\n",
  )
  await step("The designer accepts it with a wording edit", [
    "accept",
    proposal.id,
    "--digest",
    proposal.reviewDigest,
    "--by",
    "github:ana-designer",
    "--content-file",
    "edited.txt",
  ])
  await step("The next prototype run recalls it", ["recall", "--task", "Build a signup form"])
  await step(
    "Training was never granted, so export is refused",
    ["export", "--purpose", "training", "--by", "github:ana-designer"],
    { expectedExitCode: 1 },
  )
  await step("Every record still verifies", ["verify"])
  await step("Status", ["status"])
} finally {
  if (keep) console.log(`\nKept the demo checkout at ${repo}`)
  else rmSync(repo, { recursive: true, force: true })
}
