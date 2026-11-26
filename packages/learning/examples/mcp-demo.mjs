// Connects an MCP client to `replica-learning mcp` in a throwaway checkout with synthetic
// review comments, and prints each tool call an agent would make. Nothing leaves this
// machine.
//
//   npm run demo:mcp            remove the checkout afterwards
//   npm run demo:mcp -- --keep  keep it and print its path
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { REMOTE, REPOSITORY, weekOneLabels, weekOneLog } from "../conformance/fixtures.mjs"
import { main } from "../src/cli.mjs"

const keep = process.argv.includes("--keep")
const repo = mkdtempSync(path.join(tmpdir(), "replica-learning-mcp-demo-"))
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
writeFileSync(path.join(repo, "hub-comments.json"), JSON.stringify(weekOneLog()))
writeFileSync(path.join(repo, "labels.json"), JSON.stringify(weekOneLabels()))

/** Runs one setup command quietly and returns its JSON output. */
async function setup(...args) {
  let output = ""
  const code = await main([...args, "--json"], {
    cwd: repo,
    stdout: { write: (text) => (output += text) },
    stderr: { write: (text) => (output += text) },
  })
  if (code !== 0) throw new Error(`replica-learning ${args[0]} returned ${code}:\n${output}`)
  return JSON.parse(output)
}

const client = new Client({ name: "replica-learning-mcp-demo", version: "0.0.0" })

/** Calls one tool, prints what the agent sent and got back, and fails on an error. */
async function call(name, input) {
  console.log(`\n## ${name}\n${JSON.stringify(input, null, 2)}`)
  const result = await client.callTool({ name, arguments: input })
  const [{ text }] = result.content
  console.log(`->\n${text}`)
  if (result.isError) throw new Error(`${name} failed: ${text}`)
  return JSON.parse(text)
}

try {
  const by = ["--by", "github:ana-designer"]
  const reviews = await setup(
    "grants",
    "add",
    "--purpose",
    "review",
    "--purpose",
    "instruction",
    "--basis",
    "Demo team agreement",
    ...by,
  )
  const sessions = await setup(
    "grants",
    "add",
    "--purpose",
    "review",
    "--source",
    "agent_session",
    "--basis",
    "Demo team agreement for agent sessions",
    ...by,
  )
  await setup(
    "import",
    "hub-comments",
    "hub-comments.json",
    "--grant",
    reviews.id,
    "--actor",
    "agent:copilot",
  )
  await setup("label", "labels.json", "--actor", "agent:copilot", "--model", "demo-model")
  const run = await setup(
    "consolidate",
    "--from",
    "2026-09-29T00:00:00Z",
    "--to",
    "2026-10-05T18:00:00Z",
    "--actor",
    "agent:copilot",
  )
  const [proposal] = run.proposals

  const bin = fileURLToPath(new URL("../bin/replica-learning.mjs", import.meta.url))
  const server = ["mcp", "--actor", "agent:demo", "--grant", sessions.id]
  console.log(`\n$ replica-learning ${server.join(" ")}`)
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [bin, ...server], cwd: repo }),
  )
  console.log(`Instructions:\n${client.getInstructions()}`)
  const { tools } = await client.listTools()
  console.log(`Tools: ${tools.map((tool) => tool.name).join(", ")}`)

  await call("list_learnings", {})
  await call("get_learning", { id: proposal.id })
  console.log("\nA person runs the accept command the agent was given.")
  await setup("accept", proposal.id, "--digest", proposal.reviewDigest, ...by)

  const guidance = await call("get_guidance", { task: "Build a signup form" })
  await call("report_usage", {
    reportId: "demo-report-1",
    guidanceIds: [guidance.guidanceId],
    commitSha: "0".repeat(40),
    used: [{ deliveryId: guidance.memories[0].deliveryId }],
  })
  await call("submit_session", {
    sessionId: "demo-session-1",
    user: "github:ana-designer",
    messages: [
      { role: "user", text: "Keep the labels above the fields." },
      { role: "agent", text: "Moved the labels above the fields." },
    ],
    outcome: { status: "success" },
  })
} finally {
  await client.close()
  if (keep) console.log(`\nKept the demo checkout at ${repo}`)
  else rmSync(repo, { recursive: true, force: true })
}
