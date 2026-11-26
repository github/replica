import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PassThrough, Readable } from "node:stream"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  REMOTE,
  weekOneLabels,
  weekOneLog,
  weekOneSecondPassLabels,
  weekTwoLog,
} from "../conformance/fixtures.mjs"
import { main } from "../src/cli.mjs"
import { sealMemory } from "../src/records.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const work = mkdtempSync(path.join(tmpdir(), "replica-learning-cli-"))
after(() => rmSync(work, { recursive: true, force: true }))
const CLOCK = Date.parse("2026-10-09T12:00:00Z")
const WINDOW = ["--from", "2026-09-29T00:00:00Z", "--to", "2026-10-05T18:00:00Z"]
const GITHUB_REPOSITORY = {
  id: "123456",
  remote: "github.com/acme/checkout-prototypes",
  legacyRepository: "acme/checkout-prototypes",
}

function checkout(name, { remote = REMOTE, ignore = true } = {}) {
  const repo = path.join(work, name)
  mkdirSync(repo)
  execFileSync("git", ["init", "-q", repo])
  if (remote) execFileSync("git", ["-C", repo, "remote", "add", "origin", remote])
  if (ignore) writeFileSync(path.join(repo, ".gitignore"), ".replica/\n")
  if (ignore && remote?.includes("github.com")) {
    mkdirSync(path.join(repo, ".replica", "learning"), { recursive: true, mode: 0o700 })
    writeFileSync(
      path.join(repo, ".replica", "learning", "config.json"),
      JSON.stringify({
        schemaVersion: "replica.learning-config/v1",
        githubRepository: GITHUB_REPOSITORY,
      }),
    )
  }
  writeFileSync(path.join(repo, "week-1.json"), JSON.stringify(weekOneLog()))
  writeFileSync(path.join(repo, "week-2.json"), JSON.stringify(weekTwoLog()))
  writeFileSync(path.join(repo, "labels.json"), JSON.stringify(weekOneLabels()))
  return repo
}

async function cli(repo, args, { clock = CLOCK, stdin = "" } = {}) {
  let stdout = ""
  let stderr = ""
  const code = await main(args, {
    cwd: repo,
    env: {},
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    stdin: Readable.from([Buffer.from(stdin)]),
    clock: () => clock,
  })
  return { code, stdout, stderr, json: () => JSON.parse(stdout) }
}

async function ok(repo, args, options) {
  const result = await cli(repo, args, options)
  assert.equal(result.code, 0, `${args.join(" ")} failed: ${result.stderr}`)
  return result
}

/** Runs the section 46 milestone in a checkout and returns what later steps need. */
async function learnFromReviews(repo) {
  const grant = (
    await ok(repo, [
      "grants",
      "add",
      "--purpose",
      "review",
      "--purpose",
      "instruction",
      "--basis",
      "The design team agreed to learn from Hub review comments.",
      "--by",
      "github:ana-designer",
      "--json",
    ])
  ).json()
  const imported = (
    await ok(repo, [
      "import",
      "hub-comments",
      "week-1.json",
      "--grant",
      grant.id,
      "--actor",
      "agent:copilot",
      "--json",
    ])
  ).json()
  await ok(repo, ["label", "labels.json", "--actor", "agent:copilot", "--model", "test-model"])
  const run = (
    await ok(repo, ["consolidate", ...WINDOW, "--actor", "agent:copilot", "--json"])
  ).json()
  return { grant, imported, run, proposal: run.proposals[0] }
}

describe("replica-learning CLI: the first learning milestone", () => {
  it("runs the whole loop with the default provider", async () => {
    const repo = checkout("milestone")

    // 1-2. Comments on several Builds become canonical evidence pinned to exact Builds.
    const { grant, imported, run, proposal } = await learnFromReviews(repo)
    assert.equal(imported.complete, true)
    assert.equal(imported.addedEpisodes, 9)
    const evidence = (await ok(repo, ["observations", "--purpose", "review", "--json"])).json()
    const builds = new Set(
      evidence.episodes.map(
        (episode) => `${episode.source.prototypeId}#${episode.source.buildNumber}`,
      ),
    )
    assert.deepEqual([...builds].sort(), ["11#3", "11#4", "12#2", "13#5"])

    // 3-4. A local job finds one recurring issue and proposes one change with its evidence.
    assert.equal(run.status, "complete")
    assert.equal(run.proposals.length, 1)
    assert.equal(run.overBudget, 0)
    assert.equal(proposal.state, "proposed")
    assert.equal(proposal.themeKey, "visible-form-labels")
    assert.equal(proposal.evidence.length, 4)
    assert.match((await ok(repo, ["recall"])).stdout, /No accepted learnings apply yet/)

    // 5. Only a person accepts, edits, or rejects, against the digest they reviewed.
    const asAgent = await cli(repo, [
      "accept",
      proposal.id,
      "--digest",
      proposal.reviewDigest,
      "--by",
      "agent:copilot",
    ])
    assert.equal(asAgent.code, 1)
    assert.match(asAgent.stderr, /human_required/)
    const stale = await cli(repo, [
      "accept",
      proposal.id,
      "--digest",
      `sha256:${"0".repeat(64)}`,
      "--by",
      "github:ana-designer",
    ])
    assert.equal(stale.code, 1)
    assert.match(stale.stderr, /stale_review/)
    writeFileSync(
      path.join(repo, "edited.txt"),
      "Put a visible label above every form field. Placeholder text never replaces the label.\n",
    )
    const accepted = (
      await ok(repo, [
        "accept",
        proposal.id,
        "--digest",
        proposal.reviewDigest,
        "--by",
        "github:ana-designer",
        "--content-file",
        "edited.txt",
        "--operation-id",
        "11111111-2222-4333-8444-555555555555",
        "--json",
      ])
    ).json()
    assert.equal(accepted.state, "accepted")
    assert.equal(accepted.accepted.edited, true)
    assert.equal(accepted.accepted.operationId, "11111111-2222-4333-8444-555555555555")
    assert.deepEqual(
      (
        await ok(repo, [
          "operation-status",
          proposal.id,
          "--operation-id",
          "11111111-2222-4333-8444-555555555555",
          "--json",
        ])
      ).json(),
      { state: "accepted" },
    )
    assert.equal(
      accepted.content,
      "Put a visible label above every form field. Placeholder text never replaces the label.",
    )

    // 6-7. The learning is stored behind the provider and recalled by the next run.
    assert.ok(existsSync(path.join(repo, ".replica", "learning", "learning.sqlite")))
    const recall = await ok(repo, [
      "recall",
      "--task",
      "Build a signup form with email and phone fields",
    ])
    assert.match(recall.stdout, /Approved team learnings \(replica-learning\): 1 of 1/)
    assert.match(recall.stdout, /Put a visible label above every form field/)
    assert.doesNotMatch(
      recall.stdout,
      /vanish as soon as I type/,
      "raw comments never reach recall",
    )

    // 8. The original evidence stays inspectable.
    const shown = await ok(repo, ["show", proposal.id, "--history"])
    assert.match(shown.stdout, /prototype 11 Build 3 comment 101 by github:ana-designer/)
    assert.match(shown.stdout, /v1 proposed/)
    assert.match(shown.stdout, /v2 accepted/)
    await ok(repo, ["import", "hub-comments", "week-2.json", "--grant", grant.id])
    const erase = ["import", "hub-comments", "week-2.json", "--grant", grant.id, "--redact-deleted"]
    assert.match(
      (await ok(repo, erase)).stdout,
      /Removed the text of [1-9]\d* event\(s\) for comments deleted at the source\./,
    )
    assert.doesNotMatch((await ok(repo, erase)).stdout, /Removed the text/)
    assert.match(
      (await ok(repo, ["observations"])).stdout,
      /comment 101 by github:ana-designer: "The field labels sit inside the inputs/,
    )
    assert.match((await ok(repo, ["verify"])).stdout, /Every record verifies/)

    // 9. Nothing is published or trained on without a separate grant.
    for (const purpose of ["training", "publication"]) {
      const refused = await cli(repo, [
        "export",
        "--purpose",
        purpose,
        "--by",
        "github:ana-designer",
      ])
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /purpose_not_granted/)
    }
    assert.equal(existsSync(path.join(repo, ".replica", "learning", "exports")), false)
    const previewPath = path.join(".replica", "training-preview.json")
    const previewed = (
      await ok(repo, [
        "export",
        "--purpose",
        "instruction",
        "--by",
        "github:ana-designer",
        "--preview",
        "--out",
        previewPath,
        "--json",
      ])
    ).json()
    assert.equal(previewed.counts.memories, 1)
    assert.equal(existsSync(path.join(repo, previewPath)), true)
    const exported = (
      await ok(repo, [
        "export",
        "--purpose",
        "instruction",
        "--by",
        "github:ana-designer",
        "--json",
      ])
    ).json()
    assert.equal(exported.counts.memories, 1)
    assert.equal(readdirSync(path.join(repo, ".replica", "learning", "exports")).length, 1)

    // Withdrawing instruction stops recall at once and lists the export to follow up on.
    const withdrawn = (
      await ok(repo, [
        "grants",
        "withdraw",
        grant.id,
        "--purpose",
        "instruction",
        "--by",
        "github:ana-designer",
        "--json",
      ])
    ).json()
    const withdrawals = (await ok(repo, ["grants", "withdrawals", "--json"])).json()
    assert.equal(withdrawals.at(-1).id, withdrawn.withdrawal.id)
    assert.deepEqual(withdrawn.memoriesNeedingRebuild, [proposal.id])
    assert.equal(withdrawn.exportsToFollowUp.length, 1)
    assert.match((await ok(repo, ["recall"])).stdout, /No accepted learnings apply yet/)
    assert.match((await ok(repo, ["status"])).stdout, /needs rebuilding/)

    // Removing a comment's text needs a person and a reason, keeps the digests, and names the export.
    const comment = (await ok(repo, ["observations", "--json"]))
      .json()
      .events.find((event) => event.type === "human_comment" && event.payload.commentId === 101)
    assert.equal((await cli(repo, ["redact", comment.id, "--by", "github:ana-designer"])).code, 2)
    const byAgent = await cli(repo, [
      "redact",
      comment.id,
      "--by",
      "agent:copilot",
      "--reason",
      "x",
    ])
    assert.equal(byAgent.code, 1)
    assert.match(byAgent.stderr, /human_required/)
    const reason = ["--by", "github:ana-designer", "--reason", "The author asked."]
    const redacted = await ok(repo, ["redact", comment.id, ...reason])
    assert.match(redacted.stdout, /Removed the text of [2-9] event\(s\)/)
    assert.match(redacted.stdout, /Ask the owner of export \S+ \(instruction, /)
    assert.match(redacted.stdout, /snapshots saved for import, still hold it/)
    assert.doesNotMatch((await ok(repo, ["observations"])).stdout, /comment 101 by/)
    assert.match((await ok(repo, ["verify"])).stdout, /Every record verifies/)
    assert.match((await ok(repo, ["redact", comment.id, ...reason])).stdout, /already removed/)
  })

  it("10. swaps in another provider through config with no change to core logic", async () => {
    const repo = checkout("swapped")
    mkdirSync(path.join(repo, "providers"))
    copyFileSync(
      path.join(here, "fixtures", "json-file-provider.mjs"),
      path.join(repo, "providers", "json-file-provider.mjs"),
    )
    mkdirSync(path.join(repo, ".replica", "learning"), { recursive: true, mode: 0o700 })
    writeFileSync(
      path.join(repo, ".replica", "learning", "config.json"),
      JSON.stringify({
        schemaVersion: "replica.learning-config/v1",
        githubRepository: GITHUB_REPOSITORY,
        memory: { provider: { module: "./providers/json-file-provider.mjs" } },
      }),
    )
    await ok(repo, ["migrate-scope", "--offline", "--empty"])
    const doctor = (await ok(repo, ["doctor", "--json"])).json()
    assert.equal(doctor.provider.manifest.id, "json-file")
    assert.equal(doctor.provider.source, "module ./providers/json-file-provider.mjs")
    const { proposal } = await learnFromReviews(repo)
    await ok(repo, [
      "accept",
      proposal.id,
      "--digest",
      proposal.reviewDigest,
      "--by",
      "github:ana-designer",
    ])
    assert.match((await ok(repo, ["recall"])).stdout, /Show a visible label above every form field/)
    assert.ok(existsSync(path.join(repo, ".replica", "learning", "json-file-store.json")))
    assert.equal(existsSync(path.join(repo, ".replica", "learning", "learning.sqlite")), false)
  })

  it("imports an agent session and lists what the person asked for", async () => {
    const repo = checkout("agent-session")
    writeFileSync(
      path.join(repo, "session.json"),
      JSON.stringify({
        sessionId: "session-one",
        user: "github:ana-designer",
        messages: [
          { role: "user", text: "Keep the field labels visible." },
          { role: "tool", text: "npm test" },
          { role: "agent", text: "I moved each label above its field." },
        ],
      }),
    )
    const grant = (
      await ok(repo, [
        "grants",
        "add",
        "--purpose",
        "review",
        "--source",
        "agent_session",
        "--basis",
        "The team agreed to learn from agent sessions.",
        "--by",
        "github:ana-designer",
        "--json",
      ])
    ).json()
    const session = ["import", "agent-session", "session.json", "--grant", grant.id]

    const refused = await cli(repo, session)
    const imported = await ok(repo, [...session, "--actor", "agent:copilot"])

    assert.equal(refused.code, 2)
    assert.match(refused.stderr, /--actor agent:<name>/)
    assert.match(imported.stdout, /Session session-one: added 1 episodes and 2 events\./)
    assert.match(imported.stdout, /Skipped 1 tool or empty message\(s\)\./)
    assert.match(
      (await ok(repo, ["observations"])).stdout,
      /session session-one message by github:ana-designer: "Keep the field labels visible\."/,
    )
  })
})

describe("replica-learning CLI: labeling with a labeler", () => {
  // Stands in for Copilot: labels every comment it is asked about with one theme.
  const LABELER = `export function createLabeler(options) {
  return {
    manifest: { id: "fixture", name: "Fixture labeler", version: "1" },
    async status() {
      return { signedIn: true, via: "fixture", login: "fixture", host: null, models: ["fixture-model"] }
    },
    async label({ threads }) {
      const labels = threads.flatMap((thread) => thread.comments.filter((comment) => comment.label))
        .map((comment) => ({
          comment: comment.id,
          theme: { key: options.theme, statement: "Show a visible label above every form field." },
          signal: "accessibility",
          observation: "observed",
          stance: "supports",
        }))
      return { labels, usage: [{ model: "fixture-model", inputTokens: 100, outputTokens: 20, nanoAiu: 2500000 }] }
    },
  }
}
`

  function configured(name) {
    const repo = checkout(name)
    mkdirSync(path.join(repo, "tools"))
    writeFileSync(path.join(repo, "tools", "labeler.mjs"), LABELER)
    mkdirSync(path.join(repo, ".replica", "learning"), { recursive: true, mode: 0o700 })
    writeFileSync(
      path.join(repo, ".replica", "learning", "config.json"),
      JSON.stringify({
        schemaVersion: "replica.learning-config/v1",
        githubRepository: GITHUB_REPOSITORY,
        labeling: {
          labeler: { module: "./tools/labeler.mjs" },
          options: { theme: "visible-form-labels" },
        },
      }),
    )
    return repo
  }

  it("labels waiting comments, reports usage, and feeds consolidation", async () => {
    const repo = configured("labeler-loop")
    const grant = (
      await ok(repo, [
        "grants",
        "add",
        "--purpose",
        "review",
        "--purpose",
        "instruction",
        "--basis",
        "A Hub administrator turned on Learnings.",
        "--by",
        "github:ana-designer",
        "--json",
      ])
    ).json()
    await ok(repo, ["import", "hub-comments", "week-1.json", "--grant", grant.id])

    const labeled = (await ok(repo, ["label", "--json"])).json()
    assert.equal(labeled.labeler.id, "fixture")
    assert.equal(labeled.labeled, labeled.considered)
    assert.equal(labeled.usage.nanoAiu, 2500000)
    const text = (await ok(repo, ["label"])).stdout
    assert.match(text, /No comment is waiting for a label\./)

    const run = (await ok(repo, ["consolidate", ...WINDOW, "--json"])).json()
    assert.equal(run.proposals[0].themeKey, "visible-form-labels")
  })

  it("prints what labeling cost", async () => {
    const repo = configured("labeler-text")
    const grant = (
      await ok(repo, [
        "grants",
        "add",
        "--purpose",
        "review",
        "--basis",
        "Test.",
        "--by",
        "github:ana-designer",
        "--json",
      ])
    ).json()
    await ok(repo, ["import", "hub-comments", "week-1.json", "--grant", grant.id])
    const { stdout } = await ok(repo, ["label", "--limit", "3"])
    assert.match(
      stdout,
      /Fixture labeler labeled 3 of 3 comment\(s\); 0 did not need a design label\./,
    )
    assert.match(stdout, /more comment\(s\) wait for the next run/)
    assert.match(stdout, /Usage: 1 request\(s\) to fixture-model, 120 tokens, 0\.0025 AI credits/)
  })

  it("reports whether the labeler answers", async () => {
    const repo = configured("labeler-status")
    const status = (await ok(repo, ["copilot", "status", "--json"])).json()
    assert.equal(status.signedIn, true)
    assert.deepEqual(status.models, ["fixture-model"])
  })

  it("refuses a request limit that is not a positive whole number", async () => {
    const repo = configured("labeler-requests")
    assert.equal((await cli(repo, ["label", "--max-requests", "0"])).code, 2)
  })

  it("labels as itself, not as someone named with --actor", async () => {
    const repo = configured("labeler-actor")
    const result = await cli(repo, ["label", "--actor", "agent:someone"])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /The labeler labels as itself/)
  })

  it("caps actual labeler invocations per command and leaves skipped groups for another command", async () => {
    const repo = configured("labeler-max-requests")
    const log = weekOneLog()
    for (const call of log.calls)
      for (const root of call.result.threads ?? (call.result.thread ? [call.result.thread] : [])) {
        root.body = "Long design feedback. ".repeat(120)
        for (const reply of root.replies) reply.body = "Long reply feedback. ".repeat(120)
      }
    writeFileSync(path.join(repo, "week-1.json"), JSON.stringify(log))
    await learnFromReviews(repo)
    const first = (
      await ok(repo, ["label", "--limit", "400", "--max-requests", "1", "--json"])
    ).json()
    assert.equal(first.usage.requests, 1)
    assert.ok(first.considered > 1)
    assert.equal(first.considered, first.labeled)
    assert.ok(first.remaining > 0)
    const second = (await ok(repo, ["label", "--max-requests", "1", "--json"])).json()
    assert.equal(second.usage.requests, 1)
    assert.equal(second.considered, first.remaining)
    assert.equal(second.remaining, 0)
    for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"])
      assert.equal((await cli(repo, ["label", "--max-requests", value])).code, 2)
    assert.equal(
      (await cli(repo, ["label", "labels.json", "--actor", "agent:review", "--max-requests", "1"]))
        .code,
      2,
    )
  })

  it("returns reported usage with an explicit JSON error and nonzero status after a later group fails", async () => {
    const repo = configured("labeler-partial-usage")
    const log = weekOneLog()
    for (const call of log.calls)
      for (const root of call.result.threads ?? (call.result.thread ? [call.result.thread] : [])) {
        root.body = "Long design feedback. ".repeat(120)
        for (const reply of root.replies) reply.body = "Long reply feedback. ".repeat(120)
      }
    writeFileSync(path.join(repo, "week-1.json"), JSON.stringify(log))
    await learnFromReviews(repo)
    writeFileSync(
      path.join(repo, "tools", "labeler.mjs"),
      LABELER.replace("return {\n    manifest", "let calls = 0\n  return {\n    manifest").replace(
        "async label({ threads }) {",
        `async label({ threads }) {
        if (++calls === 2) throw Object.assign(new Error("Second group failed."), { code: "unavailable" })
      `,
      ),
    )
    const failed = await cli(repo, ["label", "--json"])
    assert.equal(failed.code, 1)
    const report = failed.json()
    assert.equal(report.error.code, "unavailable")
    assert.match(report.error.message, /Second group failed/)
    assert.equal(report.usage.requests, 1)
    assert.equal(report.usage.nanoAiu, 2500000)
    assert.ok(report.labeled > 0)
    assert.ok(report.remaining > 0)
    assert.match(failed.stderr, /unavailable.*Second group failed/)
    const resumed = (await ok(repo, ["label", "--max-requests", "1", "--json"])).json()
    assert.equal(resumed.considered, report.remaining)
    assert.equal(resumed.remaining, 0)
  })

  it("emits usage with an explicit error only after a successful labeling result fails to close", async () => {
    const repo = configured("labeler-close-result")
    await learnFromReviews(repo)
    writeFileSync(
      path.join(repo, "tools", "labeler.mjs"),
      LABELER.replace(
        "manifest:",
        'async close() { throw new Error("Close failed.") },\n    manifest:',
      ),
    )
    const failed = await cli(repo, ["label", "--json"])
    assert.equal(failed.code, 1)
    const report = failed.json()
    assert.equal(report.error.code, "unavailable")
    assert.equal(report.error.message, "Close failed.")
    assert.equal(report.cleanupError, "Close failed.")
    assert.equal(report.usage.requests, 1)
    assert.equal(report.usage.nanoAiu, 2500000)
    assert.equal(report.labeled, report.considered)
    assert.equal(report.remaining, 0)
    assert.match(failed.stderr, /unavailable.*Close failed/)
  })

  it("preserves an authorization error and reported usage when closing also fails", async () => {
    const repo = configured("labeler-close-authorization")
    await learnFromReviews(repo)
    writeFileSync(
      path.join(repo, "tools", "labeler.mjs"),
      LABELER.replace(
        "manifest:",
        'async close() { throw new Error("Cleanup failed.") },\n    manifest:',
      ).replace(
        "async label({ threads }) {",
        `async label({ threads }) {
          throw Object.assign(new Error("Connection revoked."), {
            code: "unauthorized",
            details: { usage: [{model:"fixture-model", inputTokens:7, outputTokens:2, nanoAiu:11}] }
          })
        `,
      ),
    )
    const failed = await cli(repo, ["label", "--json"])
    assert.equal(failed.code, 1)
    const report = failed.json()
    assert.equal(report.error.code, "unauthorized")
    assert.equal(report.error.message, "Connection revoked.")
    assert.equal(report.cleanupError, "Cleanup failed.")
    assert.equal(report.usage.requests, 1)
    assert.equal(report.usage.nanoAiu, 11)
    assert.equal(report.labeled, 0)
    assert.ok(report.remaining > 0)
    assert.match(failed.stderr, /unauthorized.*Connection revoked/)
  })

  it("preserves refusal and explains unknown usage when the failure report is malformed", async () => {
    const repo = configured("labeler-malformed-failure-usage")
    await learnFromReviews(repo)
    writeFileSync(
      path.join(repo, "tools", "labeler.mjs"),
      LABELER.replace(
        "async label({ threads }) {",
        `async label({ threads }) {
          throw Object.assign(new Error("Connection revoked."), {
            code: "unauthorized", details: { usage: [{model:"fixture-model", nanoAiu:1.5}] }
          })
        `,
      ),
    )

    const failed = await cli(repo, ["label", "--json"])

    assert.equal(failed.code, 1)
    const report = failed.json()
    assert.equal(report.error.code, "unauthorized")
    assert.equal(report.error.message, "Connection revoked.")
    assert.match(report.usageError, /usage.*unknown/i)
    assert.equal(report.usage.requests, 0)
    assert.equal(report.usage.nanoAiu, 0)
    assert.equal(report.labeled, 0)
    assert.ok(report.remaining > 0)
    assert.match(failed.stderr, /unauthorized.*Connection revoked/)
    const text = await cli(repo, ["label"])
    assert.equal(text.code, 1)
    assert.match(text.stderr, /usage.*unknown/i)
    assert.match(text.stderr, /unauthorized.*Connection revoked/)
  })

  it("preserves JSON partial reports when a labeler or close throws a non-Error", async () => {
    for (const stage of ["label", "close"]) {
      const repo = configured(`labeler-nonerror-${stage}`)
      await learnFromReviews(repo)
      const source =
        stage === "close"
          ? LABELER.replace("manifest:", "async close() { throw null },\n    manifest:")
          : LABELER.replace(
              "async label({ threads }) {",
              "async label({ threads }) { throw undefined;",
            )
      writeFileSync(path.join(repo, "tools", "labeler.mjs"), source)
      const failed = await cli(repo, ["label", "--json"])
      assert.equal(failed.code, 1)
      const report = failed.json()
      assert.equal(report.error.code, "unavailable")
      assert.equal(typeof report.error.message, "string")
      assert.equal(report.usage.requests, stage === "close" ? 1 : 0)
      if (stage === "close") assert.equal(typeof report.cleanupError, "string")
    }
  })

  it("keeps pre-labeling failures JSON-empty and reports cleanup failure without replacing them", async () => {
    const repo = configured("labeler-close-before-result")
    writeFileSync(
      path.join(repo, "tools", "labeler.mjs"),
      LABELER.replace(
        "manifest:",
        'async close() { throw new Error("Cleanup failed.") },\n    manifest:',
      ),
    )
    const failed = await cli(repo, ["label", "--limit", "0", "--json"])
    assert.equal(failed.code, 2)
    assert.equal(failed.stdout, "")
    assert.match(failed.stderr, /labeler did not close: Cleanup failed/)
    assert.match(failed.stderr, /--limit must be a positive whole number/)
  })
})

describe("replica-learning CLI: a store a host names", () => {
  const HOSTED = ["--repository", "github.com/repositories/123456"]

  function hostedLog(log) {
    for (const call of log.calls) call.result.target.repository = "repositories/123456"
    return log
  }

  it("opens a store that no checkout holds", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "replica-learning-hosted-"))
    try {
      writeFileSync(path.join(outside, "week-1.json"), JSON.stringify(hostedLog(weekOneLog())))
      const store = ["--dir", "stores/42", ...HOSTED]
      const grant = (
        await ok(outside, [
          "grants",
          "add",
          "--purpose",
          "review",
          "--basis",
          "A Hub administrator turned on Learnings.",
          "--by",
          "github:ana-designer",
          ...store,
          "--json",
        ])
      ).json()
      const imported = (
        await ok(outside, [
          "import",
          "hub-comments",
          "week-1.json",
          "--grant",
          grant.id,
          ...store,
          "--json",
        ])
      ).json()
      assert.ok(imported.addedEpisodes > 0)
      assert.ok(existsSync(path.join(outside, "stores", "42", "learning.sqlite")))
      const doctor = await ok(outside, ["doctor", ...store])
      assert.match(doctor.stdout, /Checkout: none; the program that ran this command names/)
      assert.match(doctor.stdout, /Scope: github\.com\/repositories\/123456 from --repository/)
      assert.match(doctor.stdout, /Data placement: outside any checkout/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("deletes one repository's records only after a person names it", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "replica-learning-hosted-"))
    try {
      const target = ["--dir", "stores/42", ...HOSTED]
      const other = ["--dir", "stores/42", "--repository", "github.com/repositories/654321"]
      for (const store of [target, other])
        await ok(outside, [
          "grants",
          "add",
          "--purpose",
          "review",
          "--basis",
          "A Hub administrator turned on Learnings.",
          "--by",
          "github:ana-designer",
          ...store,
        ])

      const unconfirmed = await cli(outside, [
        "delete-repository",
        "--by",
        "github:ana-designer",
        ...target,
      ])
      assert.match(unconfirmed.stderr, /Confirm with --confirm/)
      const agent = await cli(outside, [
        "delete-repository",
        "--by",
        "agent:copilot",
        "--confirm",
        "repositories/123456",
        ...target,
      ])
      assert.match(agent.stderr, /human_required/)
      await ok(outside, [
        "delete-repository",
        "--by",
        "github:ana-designer",
        "--confirm",
        "repositories/123456",
        ...target,
      ])

      assert.deepEqual((await ok(outside, ["grants", "list", ...target, "--json"])).json(), [])
      assert.equal((await ok(outside, ["grants", "list", ...other, "--json"])).json().length, 1)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("removes one deleted Hub comment by its ID, with no import and no active grant", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "replica-learning-hosted-"))
    try {
      writeFileSync(path.join(outside, "week-1.json"), JSON.stringify(hostedLog(weekOneLog())))
      writeFileSync(path.join(outside, "week-2.json"), JSON.stringify(hostedLog(weekTwoLog())))
      writeFileSync(path.join(outside, "labels.json"), JSON.stringify(weekOneLabels()))
      const store = ["--dir", "stores/42", ...HOSTED]
      const by = ["--by", "github:ana-designer"]
      const redact = ["redact", "--comment", "112", ...by, ...store]
      // Learnings was never on: nothing is removed, and no store is created.
      assert.equal((await ok(outside, [...redact, "--json"])).json().removed, 0)
      assert.equal(existsSync(path.join(outside, "stores", "42", "learning.sqlite")), false)

      const grant = (
        await ok(outside, [
          "grants",
          "add",
          "--purpose",
          "review",
          "--basis",
          "A Hub administrator turned on Learnings.",
          ...by,
          ...store,
          "--json",
        ])
      ).json()
      await ok(outside, ["import", "hub-comments", "week-1.json", "--grant", grant.id, ...store])
      await ok(outside, ["label", "labels.json", "--actor", "agent:copilot", ...store])
      await ok(outside, ["import", "hub-comments", "week-2.json", "--grant", grant.id, ...store])
      await ok(outside, ["grants", "withdraw", grant.id, "--purpose", "review", ...by, ...store])
      for (const args of [
        ["--comment", "abc", ...by],
        ["ev_aaaaaaaa1", "--comment", "112", ...by],
        ["--comment", "112"],
      ])
        assert.equal((await cli(outside, ["redact", ...args, ...store])).code, 2, args.join(" "))
      const byAgent = await cli(outside, [
        "redact",
        "--comment",
        "112",
        "--by",
        "agent:copilot",
        ...store,
      ])
      assert.equal(byAgent.code, 1)
      assert.match(byAgent.stderr, /human_required/)

      const removed = (await ok(outside, [...redact, "--json"])).json()
      assert.equal(removed.commentId, 112)
      assert.equal(removed.removed, 3)
      assert.equal(removed.redacted.length, 3)
      assert.match((await ok(outside, redact)).stdout, /Nothing to remove/)
      for (const commentId of ["112", "999999"]) {
        const again = await ok(outside, [
          "redact",
          "--comment",
          commentId,
          ...by,
          ...store,
          "--json",
        ])
        assert.equal(again.json().removed, 0)
      }
      assert.match((await ok(outside, ["verify", ...store])).stdout, /Every record verifies/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("names the repository instead of the checkout it runs in", async () => {
    const repo = checkout("hosted-elsewhere")
    const doctor = await ok(repo, [
      "doctor",
      "--dir",
      ".replica/hosted",
      "--repository",
      "github.com/repositories/654321",
    ])
    assert.match(doctor.stdout, /Scope: github\.com\/repositories\/654321 from --repository/)
  })

  it("keeps a store inside a checkout only where Git ignores it", async () => {
    const repo = checkout("hosted-storage", { ignore: false })
    writeFileSync(path.join(repo, ".gitignore"), "storage/\n")
    await ok(repo, ["grants", "list", "--dir", "storage/learning/7", ...HOSTED])
    const committed = await cli(repo, ["grants", "list", "--dir", "data/learning", ...HOSTED])
    assert.equal(committed.code, 1)
    assert.match(committed.stderr, /Git does not ignore it\. Choose a directory Git ignores/)
  })

  it("needs a data directory and a well-formed repository", async () => {
    const repo = checkout("hosted-refusals")
    const undirected = await cli(repo, ["status", ...HOSTED])
    assert.equal(undirected.code, 1)
    assert.match(undirected.stderr, /--repository needs --dir/)
    const malformed = await cli(repo, [
      "status",
      "--dir",
      ".replica/learning",
      "--repository",
      "acme/checkout-prototypes",
    ])
    assert.equal(malformed.code, 1)
    assert.match(malformed.stderr, /--repository must be github\.com\/repositories/)
  })
})

describe("replica-learning CLI: guard rails", () => {
  it("explains its provider, scope, and directory", async () => {
    const repo = checkout("doctor")
    const result = await ok(repo, ["doctor"])
    assert.match(result.stdout, /Scope: github\.com\/repositories\/123456 from git remote origin/)
    assert.match(result.stdout, /Provider: sqlite .* sends data to nothing outside this machine/)
    assert.match(result.stdout, /Consolidator: recurrence/)
  })

  it("refuses to store evidence where Git would commit it", async () => {
    const repo = checkout("not-ignored", { ignore: false })
    const result = await cli(repo, ["grants", "list"])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /Git does not ignore it/)
    const doctor = await cli(repo, ["doctor"])
    assert.equal(doctor.code, 1)
    assert.match(doctor.stdout, /Data placement: NOT ignored by Git/)
    assert.equal(existsSync(path.join(repo, ".replica")), false)
  })

  it("never overwrites an existing export file", async () => {
    const repo = checkout("export-exists")
    await learnFromReviews(repo)
    writeFileSync(path.join(repo, "taken.json"), "{}")
    const result = await cli(repo, [
      "export",
      "--purpose",
      "review",
      "--by",
      "github:ana-designer",
      "--out",
      "taken.json",
    ])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /already exists/)
  })

  it("has no scope without an origin remote", async () => {
    const repo = checkout("no-remote", { remote: null })
    const result = await cli(repo, ["status"])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /no origin remote/)
    assert.equal((await cli(repo, ["doctor"])).code, 1)
    const local = checkout("local-remote", { remote: "/srv/git/acme/checkout-prototypes.git" })
    const unusable = await cli(local, ["status"])
    assert.equal(unusable.code, 1)
    assert.match(unusable.stderr, /Cannot read a host and owner\/name/)
  })

  it("never prints credentials from the origin remote", async () => {
    const repo = checkout("credentials", {
      remote: "https://ana:ghp_example_secret@github.com/Acme/checkout-prototypes.git",
    })
    const text = await ok(repo, ["doctor"])
    const json = await ok(repo, ["doctor", "--json"])
    for (const output of [text.stdout, json.stdout])
      assert.ok(!output.includes("ghp_example_secret"), output)
    assert.match(
      text.stdout,
      /Scope: github\.com\/repositories\/123456 from git remote origin \(https:\/\/github\.com\/Acme\/checkout-prototypes\.git\)/,
    )
  })

  it("refuses input that repeats a member name", async () => {
    const repo = checkout("repeated")
    const grant = (
      await ok(repo, [
        "grants",
        "add",
        "--purpose",
        "review",
        "--basis",
        "Test.",
        "--by",
        "github:ana-designer",
        "--json",
      ])
    ).json()
    await ok(repo, ["import", "hub-comments", "week-1.json", "--grant", grant.id])
    writeFileSync(
      path.join(repo, "repeated.json"),
      '{"labels":[{"target":{"commentId":101},"theme":{"key":"a","statement":"A."},"signal":"accessibility","observation":"observed","stance":"supports","stance":"contradicts"}]}',
    )
    const result = await cli(repo, ["label", "repeated.json", "--actor", "agent:copilot"])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /repeats the member name "stance"/)
  })

  it("reads the task from a file or from standard input", async () => {
    const repo = checkout("task-file")
    await learnFromReviews(repo)
    writeFileSync(path.join(repo, "labels-2.json"), JSON.stringify(weekOneSecondPassLabels()))
    await ok(repo, ["label", "labels-2.json", "--actor", "agent:second-pass"])
    const consolidated = await ok(repo, [
      "consolidate",
      ...WINDOW,
      "--actor",
      "agent:copilot",
      "--json",
    ])
    for (const proposal of consolidated.json().proposals)
      await ok(repo, [
        "accept",
        proposal.id,
        "--digest",
        proposal.reviewDigest,
        "--by",
        "github:ana-designer",
      ])
    async function first(args, stdin) {
      const recalled = await ok(
        repo,
        ["recall", "--preview", "--by", "github:ana-designer", "--limit", "1", "--json", ...args],
        { stdin },
      )
      return recalled.json().memories[0].themeKey
    }

    assert.deepEqual(
      [await first(["--task", "each input"]), await first(["--task", "visible field"])],
      ["labels-above-inputs", "visible-form-labels"],
    )
    assert.equal(await first(["--task-file", "-"], "each input"), "labels-above-inputs")
    writeFileSync(path.join(repo, "task.txt"), "visible field")
    assert.equal(await first(["--task-file", "task.txt"]), "visible-form-labels")
    assert.equal((await cli(repo, ["recall", "--task", "x", "--task-file", "task.txt"])).code, 2)
    assert.equal(
      (await cli(repo, ["recall", "--task-file", "-"], { stdin: "x".repeat(70_000) })).code,
      2,
    )
    assert.match(
      (await cli(repo, ["recall", "--task-file", "missing.txt"])).stderr,
      /Cannot read missing\.txt/,
    )
  })

  it("previews learnings other repositories shared from a file", async () => {
    const repo = checkout("shared-file")
    const example = path.join(here, "../contracts/v1/examples/memory-record.accepted.example.json")
    const moved = sealMemory({
      ...JSON.parse(readFileSync(example, "utf8")),
      scope: { repository: "acme/marketing-prototypes" },
    })
    const shared = sealMemory({
      ...moved,
      accepted: { ...moved.accepted, contentDigest: moved.contentDigest },
    })
    writeFileSync(path.join(repo, "shared.json"), JSON.stringify([shared]))
    writeFileSync(path.join(repo, "one.json"), JSON.stringify(shared))
    const preview = ["recall", "--preview", "--by", "github:ana-designer", "--json"]

    const recalled = await ok(repo, [...preview, "--shared-file", "shared.json"])
    assert.deepEqual(
      recalled.json().memories.map((memory) => memory.id),
      [shared.id],
    )
    assert.match(
      (await cli(repo, [...preview, "--shared-file", "one.json"])).stderr,
      /invalid_input.*must be a list/,
    )
    assert.match(
      (await cli(repo, ["recall", "--shared-file", "shared.json"])).stderr,
      /invalid_input.*can only be previewed/,
    )
  })

  it("returns only selected events and their episodes with repeated --event flags", async () => {
    const repo = checkout("selected-observations")
    await learnFromReviews(repo)
    const all = (await ok(repo, ["observations", "--json"])).json()
    const label = all.events.find((event) => event.type === "annotation")
    const comment = all.events.find((event) => event.id === label.parentEventId)
    const selected = (
      await ok(repo, ["observations", "--event", comment.id, "--event", label.id, "--json"])
    ).json()
    assert.deepEqual(
      selected.events,
      all.events.filter((event) => [comment.id, label.id].includes(event.id)),
    )
    assert.deepEqual(
      selected.episodes,
      all.episodes.filter((episode) => episode.id === comment.episodeId),
    )
    assert.ok(JSON.stringify(selected).length < JSON.stringify(all).length)
    assert.deepEqual(
      (await ok(repo, ["observations", "--event", "ev_missingevent1", "--json"])).json(),
      { episodes: [], events: [] },
    )
    assert.deepEqual((await ok(repo, ["observations", "--json"])).json(), all)
    const refused = await cli(repo, ["observations", "--event", "invalid", "--json"])
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /invalid_input.*eventIds/)
  })

  it("reports reviewer identity revalidation distinctly from damaged or withdrawn evidence", async () => {
    const repo = checkout("identity-notice")
    const { grant, proposal } = await learnFromReviews(repo)
    const log = weekOneLog({
      snapshotId: "33333333-2222-4333-8444-000000000001",
      capturedAt: "2026-10-06T18:00:00.000000Z",
    })
    log.reviewerIdentity = "stable-user-id"
    writeFileSync(path.join(repo, "identity.json"), JSON.stringify(log))
    const imported = await ok(repo, [
      "import",
      "hub-comments",
      "identity.json",
      "--grant",
      grant.id,
    ])
    assert.match(imported.stdout, /Reviewer identity changed or remains unverified/)
    const memories = await ok(repo, ["memories"])
    assert.match(memories.stdout, /needs identity review/)
    assert.doesNotMatch(memories.stdout, /damaged; run verify/)
    const showing = await ok(repo, ["show", proposal.id])
    assert.match(showing.stdout, /reviewer identities need rebuilding and review/)
    const refused = await cli(repo, [
      "accept",
      proposal.id,
      "--digest",
      proposal.reviewDigest,
      "--by",
      "github:ana-designer",
    ])
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /identity_revalidation_required/)
  })

  it("keeps recall within its exact output budget and refuses one too small for framing", async () => {
    const repo = checkout("recall-budget")
    const { proposal } = await learnFromReviews(repo)
    await ok(repo, [
      "accept",
      proposal.id,
      "--digest",
      proposal.reviewDigest,
      "--by",
      "github:ana-designer",
    ])
    const full = (await ok(repo, ["recall", "--json"])).json()
    assert.ok(full.text.includes(`1. [rule] ${JSON.stringify(proposal.content)}`))
    const exact = await ok(repo, ["recall", "--budget", String(full.text.length)])
    assert.equal(exact.stdout, full.text)
    const shorter = await ok(repo, ["recall", "--budget", String(full.text.length - 1)])
    assert.ok(shorter.stdout.length <= full.text.length - 1)
    assert.match(shorter.stdout, /: 0 of 1/)
    const refused = await cli(repo, ["recall", "--budget", "1"])
    assert.equal(refused.code, 1)
    assert.equal(refused.stdout, "")
    assert.match(refused.stderr, /invalid_input.*budget must be at least/)
  })

  it("rejects usage errors with exit code 2", async () => {
    const repo = checkout("usage")
    assert.equal((await cli(repo, [])).code, 2)
    assert.equal((await cli(repo, ["unknown"])).code, 2)
    assert.equal((await cli(repo, ["import", "hub-comments", "week-1.json"])).code, 2)
    assert.equal((await cli(repo, ["consolidate", "--from", "last tuesday"])).code, 2)
    assert.equal((await cli(repo, ["recall", "--limit", "0"])).code, 2)
    assert.equal((await cli(repo, ["recall", "--preview"])).code, 2)
    assert.equal((await cli(repo, ["status", "--bogus"])).code, 2)
    assert.equal((await cli(repo, ["--help"])).code, 0)
  })

  it("reads a dash-leading decision reason from a file", async () => {
    const repo = checkout("decision-reason-file")
    writeFileSync(path.join(repo, "reason.txt"), "-private repository context\n")

    const result = await cli(repo, [
      "retire",
      "mem_missing01",
      "--by",
      "github:ana-designer",
      "--reason-file",
      "reason.txt",
    ])

    assert.equal(result.code, 1)
    assert.match(result.stderr, /not_found/)
    assert.doesNotMatch(result.stderr, /Run replica-learning --help/)
  })

  it("edits and reinstates a learning using the version shown to the person", async () => {
    const repo = checkout("edit-reinstate-decision")
    const { proposal } = await learnFromReviews(repo)
    writeFileSync(path.join(repo, "title.txt"), "Keep labels visible\n")
    writeFileSync(path.join(repo, "reason.txt"), "Clarify the guidance.\n")
    const accepted = (
      await ok(repo, [
        "accept",
        proposal.id,
        "--digest",
        proposal.reviewDigest,
        "--by",
        "github:ana-designer",
        "--json",
      ])
    ).json()
    const shown = await ok(repo, ["show", proposal.id])
    const shownDigest = shown.stdout.match(/^Version digest: (sha256:[a-f0-9]{64})$/m)?.[1]
    assert.equal(shownDigest, accepted.digest)
    const edit = [
      "edit",
      proposal.id,
      "--digest",
      shownDigest,
      "--by",
      "github:ana-designer",
      "--title-file",
      "title.txt",
      "--reason-file",
      "reason.txt",
      "--operation-id",
      "11111111-1111-4111-8111-111111111111",
      "--json",
    ]
    const edited = (await ok(repo, edit)).json()
    assert.equal(edited.title, "Keep labels visible")
    assert.equal(edited.accepted.note, "Clarify the guidance.")
    assert.equal((await ok(repo, edit)).json().digest, edited.digest)
    assert.deepEqual(
      (
        await ok(repo, [
          "operation-status",
          proposal.id,
          "--operation-id",
          "11111111-1111-4111-8111-111111111111",
          "--json",
        ])
      ).json(),
      { state: "accepted" },
    )
    const retired = (
      await ok(repo, [
        "retire",
        proposal.id,
        "--by",
        "github:ana-designer",
        "--reason-file",
        "reason.txt",
        "--json",
      ])
    ).json()
    const retiredShown = await ok(repo, ["show", proposal.id])
    const retiredDigest = retiredShown.stdout.match(/^Version digest: (sha256:[a-f0-9]{64})$/m)?.[1]
    assert.equal(retiredDigest, retired.digest)
    const reinstate = [
      "reinstate",
      proposal.id,
      "--digest",
      retiredDigest,
      "--by",
      "github:ana-designer",
      "--reason-file",
      "reason.txt",
      "--operation-id",
      "22222222-2222-4222-8222-222222222222",
      "--json",
    ]
    const restored = (await ok(repo, reinstate)).json()
    assert.equal(restored.state, "accepted")
    assert.equal(restored.title, "Keep labels visible")
    assert.equal((await ok(repo, reinstate)).json().digest, restored.digest)
    assert.deepEqual(
      (
        await ok(repo, [
          "operation-status",
          proposal.id,
          "--operation-id",
          "22222222-2222-4222-8222-222222222222",
          "--json",
        ])
      ).json(),
      { state: "accepted" },
    )
    const history = (await ok(repo, ["show", proposal.id, "--history", "--json"])).json()
    assert.deepEqual(
      history.versions.map((version) => version.state),
      ["proposed", "accepted", "accepted", "retired", "accepted"],
    )
    assert.equal((await ok(repo, ["verify", "--json"])).json().ok, true)
  })

  it("records what an agent used, then deletes the learning with its screenshot", async () => {
    const repo = checkout("usage-and-deletion")
    const { proposal } = await learnFromReviews(repo)
    await ok(repo, [
      "accept",
      proposal.id,
      "--digest",
      proposal.reviewDigest,
      "--by",
      "github:ana-designer",
    ])
    const recalled = (
      await ok(repo, ["recall", "--task", "Build the form", "--session-id", "s-1", "--json"])
    ).json()
    const [memory] = recalled.memories
    writeFileSync(
      path.join(repo, "after.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    )
    writeFileSync(
      path.join(repo, "report.json"),
      JSON.stringify({
        reportId: "report-1",
        guidanceIds: [recalled.guidanceId],
        commitSha: "a".repeat(40),
        used: [
          {
            deliveryId: memory.deliveryId,
            after: {
              file: "after.png",
              route: "/checkout",
              viewport: { width: 1280, height: 800 },
              theme: "light",
              capturedAt: "2026-10-09T12:00:00.000000Z",
            },
          },
        ],
      }),
    )
    mkdirSync(path.join(repo, "reports"))
    writeFileSync(
      path.join(repo, "reports", "outside.json"),
      readFileSync(path.join(repo, "report.json"), "utf8").replace("after.png", "../after.png"),
    )
    const outside = await cli(repo, [
      "report-usage",
      "reports/outside.json",
      "--actor",
      "agent:copilot",
    ])
    assert.match(outside.stderr, /must be a path inside the report's directory/)
    const args = ["report-usage", "report.json", "--actor", "agent:copilot", "--json"]
    assert.equal((await ok(repo, args)).json().stored, true)
    assert.equal((await ok(repo, args)).json().stored, false)
    const evidence = path.join(repo, ".replica", "learning", "evidence")
    assert.equal(readdirSync(evidence).length, 1)

    const deleted = (
      await ok(repo, [
        "delete",
        memory.id,
        "--by",
        "github:ana-designer",
        "--reason",
        "No longer wanted.",
        "--json",
      ])
    ).json()
    assert.equal(deleted.records.screenshots, 1)
    assert.deepEqual(readdirSync(evidence), [])
    assert.equal((await ok(repo, ["verify", "--json"])).json().ok, true)
  })

  it("serves guidance to an agent over MCP and records what it used", async () => {
    const repo = checkout("mcp")
    const { proposal } = await learnFromReviews(repo)
    await ok(repo, [
      "accept",
      proposal.id,
      "--digest",
      proposal.reviewDigest,
      "--by",
      "github:ana-designer",
    ])
    const sessionGrant = (
      await ok(repo, [
        "grants",
        "add",
        "--purpose",
        "review",
        "--source",
        "agent_session",
        "--basis",
        "The team agreed to learn from agent sessions.",
        "--by",
        "github:ana-designer",
        "--json",
      ])
    ).json()
    writeFileSync(
      path.join(repo, "after.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    )
    const stdin = new PassThrough()
    const replies = new Map()
    let errors = ""
    let pending = ""
    let waiting
    const stdout = {
      write(text) {
        pending += text
        for (let end; (end = pending.indexOf("\n")) >= 0; pending = pending.slice(end + 1)) {
          const message = JSON.parse(pending.slice(0, end))
          replies.set(message.id, message)
          waiting?.()
        }
        return true
      },
    }
    const served = main(["mcp", "--actor", "agent:copilot", "--grant", sessionGrant.id], {
      cwd: repo,
      env: {},
      stdin,
      stdout,
      stderr: { write: (text) => (errors += text) },
      clock: () => CLOCK,
    })
    // Fail instead of waiting forever when the server stops early, such as when the
    // optional MCP SDK is not installed.
    const stopped = served.then((code) => {
      throw new Error(`The MCP server stopped with exit code ${code}: ${errors}`)
    })
    stopped.catch(() => {})
    let next = 0
    async function request(method, params) {
      const id = ++next
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      while (!replies.has(id)) {
        await Promise.race([new Promise((resolve) => (waiting = resolve)), stopped])
      }
      return replies.get(id).result
    }
    async function call(name, input) {
      const result = await request("tools/call", { name, arguments: input })
      return {
        error: result.isError,
        data: result.isError ? result.content[0].text : JSON.parse(result.content[0].text),
      }
    }
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    })
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)

    const guidance = (await call("get_guidance", { task: "Build the form" })).data
    const [memory] = guidance.learnings
    assert.deepEqual(Object.keys(memory), ["id", "deliveryId"])
    assert.equal(memory.id, proposal.id)
    const [listed] = (await call("list_learnings", {})).data
    assert.ok(guidance.text.includes(listed.content))
    const report = {
      reportId: "report-1",
      guidanceIds: [guidance.guidanceId],
      commitSha: "a".repeat(40),
      used: [
        {
          deliveryId: memory.deliveryId,
          after: {
            file: "after.png",
            route: "/checkout",
            viewport: { width: 1280, height: 800 },
            theme: "light",
            capturedAt: "2026-10-09T12:00:00.000000Z",
          },
        },
      ],
    }
    assert.equal((await call("report_usage", report)).data.stored, true)
    const conversation = {
      sessionId: "s-1",
      messages: [
        { role: "user", text: "Keep the labels above the fields." },
        { role: "tool", text: "" },
        { role: "agent", text: "Moved the labels." },
      ],
    }
    assert.equal((await call("submit_session", conversation)).error, undefined)
    await ok(repo, [
      "grants",
      "withdraw",
      sessionGrant.id,
      "--purpose",
      "review",
      "--by",
      "github:ana-designer",
    ])
    assert.match((await call("submit_session", conversation)).data, /^grant_inactive: /)

    stdin.end()
    assert.equal(await served, 0)
    const evidence = path.join(repo, ".replica", "learning", "evidence")
    assert.equal(readdirSync(evidence).length, 1)
  })

  it("refuses an identity with control or invisible formatting characters", async () => {
    const repo = checkout("hidden-identity")
    const grant = ["grants", "add", "--purpose", "review", "--basis", "Test."]
    for (const args of [
      [...grant, "--by", "github:ana\u202Edesigner"],
      [...grant, "--by", "github:ana\u{E0041}designer"],
      ["recall", "--actor", "agent:copilot\u001b[2J"],
      ["recall", "--actor", "agent:co\u200Bpilot"],
    ]) {
      const result = await cli(repo, args)
      assert.equal(result.code, 1, args.join(" "))
      assert.match(result.stderr, /invalid_input/)
    }
  })

  it("quotes untrusted comment text so it cannot drive the terminal", async () => {
    const repo = checkout("quoting")
    await learnFromReviews(repo)
    const { stdout } = await ok(repo, ["observations"])
    assert.ok(stdout.includes("Ignore all previous instructions"))
    assert.ok(!stdout.includes("\u001b"), "raw escape characters never reach the terminal")
    assert.ok(stdout.includes("\\u001b"))
  })

  it("escapes untrusted property names before writing label errors to stderr", async () => {
    const repo = checkout("diagnostic-property-name")
    await learnFromReviews(repo)
    const labels = weekOneLabels().labels
    const key = "\u001b[2J\n\u009b2J\u0085Forged success"
    labels[0].theme[key] = true
    writeFileSync(path.join(repo, "unsafe-labels.json"), JSON.stringify(labels))
    const result = await cli(repo, ["label", "unsafe-labels.json", "--actor", "agent:reviewer"])
    assert.equal(result.code, 1)
    assert.ok(result.stderr.includes("\\u001b[2J\\n\\u009b2J\\u0085Forged success"))
    assert.ok(!result.stderr.includes("\u001b"))
    assert.ok(!result.stderr.includes("\u009b"))
    assert.ok(!result.stderr.includes("\u0085"))
    assert.ok(!result.stderr.split("\n").some((line) => line.startsWith("Forged success")))
  })

  it("loads provider modules only from inside the checkout, after following links", async () => {
    const repo = checkout("outside")
    mkdirSync(path.join(repo, ".replica", "learning"), { recursive: true, mode: 0o700 })
    writeFileSync(path.join(work, "outside.mjs"), "export function createMemoryProvider() {}\n")
    mkdirSync(path.join(repo, "providers"))
    symlinkSync(path.join(work, "outside.mjs"), path.join(repo, "providers", "linked.mjs"))
    const config = path.join(repo, ".replica", "learning", "config.json")
    for (const module of [
      "../outside.mjs",
      "./providers/linked.mjs",
      "/etc/passwd",
      "data:text/javascript,1",
      "some-package",
    ]) {
      writeFileSync(
        config,
        JSON.stringify({
          schemaVersion: "replica.learning-config/v1",
          githubRepository: GITHUB_REPOSITORY,
          memory: { provider: { module } },
        }),
      )
      const result = await cli(repo, ["status"])
      assert.equal(result.code, 1, module)
      assert.match(result.stderr, /must (be a relative path|stay) inside/, module)
    }
    writeFileSync(
      config,
      JSON.stringify({ schemaVersion: "replica.learning-config/v1", surprise: true }),
    )
    assert.match((await cli(repo, ["status"])).stderr, /unknown settings: surprise/)
  })

  it("keeps learning data and exports out of served directories", async () => {
    const repo = checkout("served")
    writeFileSync(path.join(repo, ".gitignore"), ".replica/\npublic/.replica/\n")
    for (const directory of ["public/.replica/learning", ".", "..private/learning"]) {
      const served = await cli(repo, ["status", "--dir", directory])
      assert.equal(served.code, 1, directory)
      assert.match(served.stderr, /not under \.replica/, directory)
    }
    assert.equal(existsSync(path.join(repo, "..private")), false)
    await learnFromReviews(repo)
    mkdirSync(path.join(repo, "public"), { recursive: true })
    const exported = await cli(repo, [
      "export",
      "--purpose",
      "review",
      "--by",
      "github:ana-designer",
      "--out",
      "public/review.json",
    ])
    assert.equal(exported.code, 1)
    assert.match(exported.stderr, /not under \.replica\/\. Keep exports in \.replica\//)
  })

  it("refuses an export under .replica/ that Git would still commit", async () => {
    const repo = checkout("partly-ignored")
    writeFileSync(path.join(repo, ".gitignore"), ".replica/learning/\n")
    await learnFromReviews(repo)
    const exported = await cli(repo, [
      "export",
      "--purpose",
      "review",
      "--by",
      "github:ana-designer",
      "--out",
      ".replica/review.json",
    ])
    assert.equal(exported.code, 1)
    assert.match(exported.stderr, /Git does not ignore/)
    assert.equal(existsSync(path.join(repo, ".replica", "review.json")), false)
  })

  it("closes the provider, so a database provider never keeps the command running", () => {
    const repo = checkout("held-open")
    mkdirSync(path.join(repo, "providers"))
    for (const name of ["json-file-provider.mjs", "held-open-provider.mjs"])
      copyFileSync(path.join(here, "fixtures", name), path.join(repo, "providers", name))
    mkdirSync(path.join(repo, ".replica", "learning"), { recursive: true, mode: 0o700 })
    writeFileSync(
      path.join(repo, ".replica", "learning", "config.json"),
      JSON.stringify({
        schemaVersion: "replica.learning-config/v1",
        githubRepository: { ...GITHUB_REPOSITORY, legacyConfirmed: true },
        memory: { provider: { module: "./providers/held-open-provider.mjs" } },
      }),
    )
    const bin = path.join(here, "..", "bin", "replica-learning.mjs")
    for (const args of [
      ["status"],
      ["doctor"],
      ["recall", "--task", "x"],
      ["show", "mem_missing"],
    ]) {
      const result = spawnSync(process.execPath, [bin, ...args], {
        cwd: repo,
        encoding: "utf8",
        timeout: 15_000,
      })
      assert.equal(result.signal, null, `${args[0]} did not exit: ${result.stderr}`)
      assert.equal(result.status, args[0] === "show" ? 1 : 0, `${args[0]}: ${result.stderr}`)
    }
  })

  it("runs as a Node executable", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(here, "..", "bin", "replica-learning.mjs"), "--help"],
      { encoding: "utf8" },
    )
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Usage: replica-learning <command>/)
  })
})
