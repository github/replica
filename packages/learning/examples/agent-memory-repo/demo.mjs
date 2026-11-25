// Runs Dreaming from Agent Memory Repo against Replica's learning loop, in a throwaway checkout
// and a throwaway memory repo, and prints every command with its output. Nothing is pushed and
// nothing leaves this machine.
//
//   npm run demo:agent-memory-repo            remove both afterwards
//   npm run demo:agent-memory-repo -- --keep  keep them and print their paths
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  REMOTE,
  REPOSITORY,
  weekOneLabels,
  weekOneLog,
  weekOneSecondPassLabels,
} from "../../conformance/fixtures.mjs"
import { main } from "../../src/cli.mjs"
import { learningsFile } from "./memory-repo.mjs"
import { main as publish } from "./publish.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const keep = process.argv.includes("--keep")
const work = mkdtempSync(path.join(tmpdir(), "replica-dreaming-demo-"))
const repo = path.join(work, "checkout-prototypes")
const memoryRepo = path.join(work, "agent-memory")
const WINDOW = ["--from", "2026-09-29T00:00:00Z", "--to", "2026-10-05T18:00:00Z"]
const DESIGNER = ["--by", "github:ana-designer"]
const githubRepository = {
  id: "12345",
  remote: `github.com/${REPOSITORY}`,
  legacyRepository: REPOSITORY,
}
const topic = path.join(
  memoryRepo,
  ...learningsFile({ host: "github.com", repository: "repositories/12345" }).split("/"),
)
process.env.GIT_AUTHOR_NAME ??= "Replica demo"
process.env.GIT_AUTHOR_EMAIL ??= "demo@example.com"
process.env.GIT_COMMITTER_NAME ??= "Replica demo"
process.env.GIT_COMMITTER_EMAIL ??= "demo@example.com"

mkdirSync(repo)
execFileSync("git", ["init", "-q", repo])
execFileSync("git", ["-C", repo, "remote", "add", "origin", REMOTE])
writeFileSync(path.join(repo, ".gitignore"), ".replica/\n")
mkdirSync(path.join(repo, ".replica", "learning"), { recursive: true, mode: 0o700 })
writeFileSync(
  path.join(repo, ".replica", "learning", "config.json"),
  JSON.stringify({ schemaVersion: "replica.learning-config/v1", githubRepository }),
  { mode: 0o600 },
)
writeFileSync(path.join(repo, "hub-comments.json"), JSON.stringify(weekOneLog(), null, 2))
writeFileSync(path.join(repo, "labels.json"), JSON.stringify(weekOneLabels(), null, 2))
writeFileSync(
  path.join(repo, "second-pass.json"),
  JSON.stringify(weekOneSecondPassLabels(), null, 2),
)

async function step(title, args, { json = false, command = "replica-learning", run = main } = {}) {
  console.log(`\n## ${title}\n$ ${command} ${args.join(" ")}`)
  let output = ""
  const code = await run(json ? [...args, "--json"] : args, {
    cwd: repo,
    stdout: { write: (text) => (output += text) },
    stderr: { write: (text) => (output += text) },
  })
  if (!json) process.stdout.write(output)
  console.log(`(exit ${code})`)
  if (code !== 0) throw new Error(`${command} ${args[0]} failed:\n${output}`)
  return json ? JSON.parse(output) : output
}

function show(title, file) {
  console.log(`\n## ${title}\n$ cat ${path.relative(work, file)}`)
  process.stdout.write(readFileSync(file, "utf8"))
}

try {
  const grant = await step(
    "A designer records consent: review and instruction only",
    ["grants", "add", "--purpose", "review", "--purpose", "instruction"].concat([
      "--basis",
      "Demo team agreement",
      ...DESIGNER,
    ]),
    { json: true },
  )
  await step("The agent imports one week of Hub review threads", [
    "import",
    "hub-comments",
    "hub-comments.json",
    "--grant",
    grant.id,
    "--actor",
    "agent:copilot",
  ])
  await step("Two labeling passes file the same comments under different themes", [
    "label",
    "labels.json",
    "--actor",
    "agent:copilot",
  ])
  await step("The second pass", ["label", "second-pass.json", "--actor", "agent:second-pass"])
  const before = await step(
    "The default recurrence consolidator proposes both themes",
    ["consolidate", ...WINDOW, "--actor", "agent:copilot"],
    { json: true },
  )
  for (const proposal of before.proposals) {
    console.log(
      `Proposed ${proposal.id} (${proposal.themeKey}): ${JSON.stringify(proposal.content)}`,
    )
    await step(`A designer accepts ${proposal.themeKey}`, [
      "accept",
      proposal.id,
      "--digest",
      proposal.reviewDigest,
      ...DESIGNER,
    ])
  }
  await step("Two learnings now say the same thing", ["recall"])

  mkdirSync(path.join(repo, "tools"))
  copyFileSync(path.join(here, "dreaming.mjs"), path.join(repo, "tools", "dreaming.mjs"))
  writeFileSync(
    path.join(repo, ".replica", "learning", "config.json"),
    JSON.stringify(
      {
        schemaVersion: "replica.learning-config/v1",
        githubRepository,
        consolidation: { consolidator: { module: "./tools/dreaming.mjs" } },
      },
      null,
      2,
    ),
  )
  await step("The team copies dreaming.mjs into the repo and selects it", ["doctor"])
  await step("Dreaming adds nothing new and proposes a merge", [
    "consolidate",
    ...WINDOW,
    "--actor",
    "agent:copilot",
  ])
  const merge = (
    await step("The merge waits for a person", ["memories", "--state", "proposed"], { json: true })
  )
    .map((item) => item.record)
    .find((record) => record.proposal.lifecycle.action === "merge")
  await step("A designer reads it", ["show", merge.id])
  await step("A designer accepts the merge", [
    "accept",
    merge.id,
    "--digest",
    merge.reviewDigest,
    ...DESIGNER,
  ])
  await step("Recall now spends its budget on one learning", ["recall"])

  await step(
    "Publish the accepted learnings to an Agent Memory Repo",
    ["--memory-repo", memoryRepo, ...DESIGNER],
    { command: "node publish.mjs", run: publish },
  )
  show("MEMORY.md links the learnings", path.join(memoryRepo, "MEMORY.md"))
  show("Other agents read them as one-line entries", topic)

  await step("A designer withdraws instruction; the memory repo is listed for follow-up", [
    "grants",
    "withdraw",
    grant.id,
    "--purpose",
    "instruction",
    ...DESIGNER,
  ])
  await step("Dreaming reports the learning as outdated, for a person to retire", [
    "consolidate",
    ...WINDOW,
    "--actor",
    "agent:copilot",
  ])
  await step(
    "Publishing again removes it from the memory repo",
    ["--memory-repo", memoryRepo, ...DESIGNER],
    { command: "node publish.mjs", run: publish },
  )
  show("The file no longer lists it", topic)
  console.log(`\n## Git history keeps the earlier text\n$ git -C agent-memory log --oneline`)
  process.stdout.write(
    execFileSync("git", ["-C", memoryRepo, "log", "--oneline"], { encoding: "utf8" }),
  )
} finally {
  if (keep) console.log(`\nKept ${repo} and ${memoryRepo}`)
  else rmSync(work, { recursive: true, force: true })
}
