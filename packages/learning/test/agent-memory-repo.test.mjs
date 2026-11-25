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
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  REMOTE,
  REPOSITORY,
  weekOneLabels,
  weekOneLog,
  weekOneSecondPassLabels,
} from "../conformance/fixtures.mjs"
import { createConsolidator } from "../examples/agent-memory-repo/dreaming.mjs"
import {
  learningsFile,
  publishToMemoryRepo,
  renderLearnings,
  withIndexLink,
} from "../examples/agent-memory-repo/memory-repo.mjs"
import { main as publish } from "../examples/agent-memory-repo/publish.mjs"
import {
  SCHEMA_VERSIONS,
  createInMemoryProvider,
  createLearningStore,
  createRecurrenceConsolidator,
  createSqliteMemoryProvider,
  validateRecord,
} from "../index.mjs"
import { main as cli } from "../src/cli.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const example = path.join(here, "..", "examples", "agent-memory-repo")
const work = mkdtempSync(path.join(tmpdir(), "replica-dreaming-test-"))
after(() => rmSync(work, { recursive: true, force: true }))

const NOW = Date.parse("2026-10-09T12:00:00Z")
const SCOPE = Object.freeze({ host: "github.com", repository: REPOSITORY })
const ENTERPRISE = Object.freeze({ host: "ghe.example.com", repository: REPOSITORY })
const WINDOW = { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" }
const NEW = Object.freeze({ action: "new" })
const GIT = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
}

function designer(scope = SCOPE) {
  return { scope, principal: { kind: "human", id: "github:ana-designer", asserted: true } }
}
function agent(id = "agent:copilot", scope = SCOPE) {
  return { scope, principal: { kind: "agent", id, model: "test" } }
}
function dreaming(options) {
  return createConsolidator(options, { createRecurrenceConsolidator })
}

let directories = 0
function directory(name) {
  return path.join(work, `${name}-${++directories}`)
}
function project() {
  const checkout = directory("project")
  mkdirSync(checkout)
  return checkout
}

/** A store with week one imported under a grant for review and instruction. */
async function imported(provider = createInMemoryProvider(), scope = SCOPE) {
  const store = await createLearningStore({ provider, clock: () => NOW })
  const grant = await store.addGrant(designer(scope), {
    purposes: ["review", "instruction"],
    sources: ["hub_review_comments"],
    basis: "Test agreement.",
  })
  await store.importHubReviewComments(agent(undefined, scope), weekOneLog(), {
    grantIds: [grant.id],
  })
  return { store, grant }
}

/** Week one, labeled twice under different themes, and both themes accepted. */
async function duplicates(provider, scope = SCOPE) {
  const { store, grant } = await imported(provider, scope)
  await store.annotate(agent(undefined, scope), weekOneLabels().labels)
  await store.annotate(agent("agent:second-pass", scope), weekOneSecondPassLabels().labels)
  const { proposals } = await store.consolidate(agent(undefined, scope), {
    consolidator: createRecurrenceConsolidator(),
    window: WINDOW,
  })
  const accepted = []
  for (const proposal of proposals)
    accepted.push(
      await store.acceptMemory(designer(scope), proposal.id, {
        expectedDigest: proposal.reviewDigest,
      }),
    )
  return { store, grant, accepted }
}

/** Accept a hand-written learning that cites week-one comments by their Hub IDs. */
async function accepted(store, { content, cites, disputes = [], kind = "rule", ...rest }) {
  const { events } = await store.queryObservations(designer(), { purpose: "instruction" })
  function references(ids) {
    return ids.map((commentId) => {
      const event = events.find(
        (item) => item.type === "human_comment" && item.payload.commentId === commentId,
      )
      return { episodeId: event.episodeId, eventIds: [event.id] }
    })
  }
  const proposal = await store.proposeMemory(designer(), {
    schemaVersion: SCHEMA_VERSIONS.memoryProposal,
    kind,
    content,
    evidence: references(cites),
    ...(disputes.length ? { contradictions: references(disputes) } : {}),
    ...rest,
    rationale: { recurrence: "Fixture.", expectedBenefit: "Fixture.", falsification: "None." },
    lifecycle: NEW,
    consolidator: { id: "manual", version: "1" },
  })
  return store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
}

async function recalled(store) {
  return (await store.recall(agent())).memories.map((memory) => memory.id).sort()
}

function topicIn(memoryRepo, scope = SCOPE) {
  return path.join(memoryRepo, ...learningsFile(scope).split("/"))
}

describe("Agent Memory Repo Dreaming", () => {
  it("proposes one merge for learnings that say the same thing, and decides nothing", async () => {
    const { store, accepted: both } = await duplicates()
    const ids = both.map((record) => record.id).sort()
    assert.equal(ids.length, 2)
    const run = await store.consolidate(agent(), { consolidator: dreaming(), window: WINDOW })
    assert.equal(run.proposals.length, 1)
    const [merge] = run.proposals
    assert.equal(merge.state, "proposed")
    assert.deepEqual(merge.proposal.lifecycle, { action: "merge", targets: ids })
    const cited = new Set(merge.evidence.flatMap((reference) => reference.eventIds))
    for (const record of both)
      for (const reference of record.evidence)
        for (const eventId of reference.eventIds) assert.ok(cited.has(eventId))
    assert.deepEqual(
      await recalled(store),
      ids,
      "a proposal changes nothing until a person decides",
    )
    await store.acceptMemory(designer(), merge.id, { expectedDigest: merge.reviewDigest })
    assert.deepEqual(await recalled(store), [merge.id])
    const again = await store.consolidate(agent(), { consolidator: dreaming(), window: WINDOW })
    assert.deepEqual(again.proposals, [])
    assert.ok(
      again.diagnostics.some(
        (note) =>
          note.code === "already_covered" &&
          note.themeKey === "labels-above-inputs" &&
          note.message.includes(merge.id),
      ),
      "a merged theme is not proposed again",
    )
  })

  it("does not propose a theme that repeats a stronger proposal from the same run", async () => {
    const { store } = await imported()
    await store.annotate(agent(), weekOneLabels().labels)
    await store.annotate(agent("agent:second-pass"), weekOneSecondPassLabels().labels)
    const run = await store.consolidate(agent(), { consolidator: dreaming(), window: WINDOW })
    assert.equal(run.proposals.length, 1)
    const covered = run.diagnostics.filter((note) => note.code === "already_covered")
    assert.equal(covered.length, 1)
    assert.notEqual(covered[0].themeKey, run.proposals[0].themeKey)
  })

  it("never merges opposite rules and never turns dissent into support", async () => {
    const { store } = await imported()
    const allow = await accepted(store, {
      content: "Use placeholder text as the field label.",
      cites: [101, 103],
      disputes: [104],
    })
    const forbid = await accepted(store, {
      content: "Never use placeholder text as the field label.",
      cites: [104],
      disputes: [101, 103],
    })
    const run = await store.consolidate(agent(), { consolidator: dreaming(), window: WINDOW })
    assert.deepEqual(run.proposals, [])
    const conflict = run.diagnostics.find((note) => note.code === "conflicting_learnings")
    assert.ok(conflict.message.includes(allow.id) && conflict.message.includes(forbid.id))
    assert.match(conflict.message, /one says not to do what the other says to do/)
    assert.match(conflict.message, /comments that support one dispute the other/)
  })

  it("merges only learnings of the same kind and lifetime, and keeps the lifetime", async () => {
    const { store } = await imported()
    const expiresAt = "2027-01-01T00:00:00.000000Z"
    const first = await accepted(store, {
      content: "Keep a visible label above every form field.",
      cites: [101, 103],
      expiresAt,
    })
    const second = await accepted(store, {
      content: "Keep visible labels above every form field.",
      cites: [101, 104],
      expiresAt,
    })
    const run = await store.consolidate(agent(), { consolidator: dreaming(), window: WINDOW })
    assert.equal(run.proposals.length, 1)
    assert.deepEqual(run.proposals[0].proposal.lifecycle.targets, [first.id, second.id].sort())
    assert.equal(run.proposals[0].expiresAt, expiresAt)

    const other = await imported()
    await accepted(other.store, {
      content: "Keep a visible label above every form field.",
      cites: [101, 103],
      expiresAt,
    })
    await accepted(other.store, {
      content: "Keep visible labels above every form field.",
      cites: [101, 104],
    })
    await accepted(other.store, {
      content: "Keep a visible label above every form field.",
      cites: [105],
      kind: "example",
      expiresAt,
    })
    const split = await other.store.consolidate(agent(), {
      consolidator: dreaming(),
      window: WINDOW,
    })
    assert.deepEqual(split.proposals, [])
    const notes = split.diagnostics
      .filter((note) => note.code === "conflicting_learnings")
      .map((note) => note.message)
      .join("\n")
    assert.match(notes, /valid for different periods/)
    assert.match(notes, /different kinds of learning/)
  })

  it("reports contested and outdated learnings and leaves them as they are", async () => {
    const { store, grant } = await duplicates()
    const run = await store.consolidate(agent(), { consolidator: dreaming(), window: WINDOW })
    const merged = run.proposals[0].id
    await store.acceptMemory(designer(), merged, { expectedDigest: run.proposals[0].reviewDigest })
    await store.annotate(
      agent("agent:third-pass"),
      [105, 106, 109].map((commentId) => ({
        target: { commentId },
        theme: { key: "visible-form-labels", statement: "Labels can stay inside short inputs." },
        signal: "accessibility",
        observation: "observed",
        stance: "contradicts",
      })),
    )
    const disputed = await store.consolidate(agent(), { consolidator: dreaming(), window: WINDOW })
    assert.ok(
      disputed.diagnostics.some(
        (note) => note.code === "contested" && note.message.includes(merged),
      ),
    )
    await store.withdrawGrant(designer(), grant.id, { purposes: ["instruction"] })
    const before = await store.getMemory(designer(), merged, { history: true })
    const stale = await store.consolidate(agent(), { consolidator: dreaming(), window: WINDOW })
    assert.ok(
      stale.diagnostics.some(
        (note) => note.code === "retire_suggested" && note.message.includes(merged),
      ),
    )
    assert.deepEqual(stale.proposals, [])
    const after = await store.getMemory(designer(), merged, { history: true })
    assert.equal(after.record.state, "accepted")
    assert.equal(after.versions.length, before.versions.length)
  })

  it("returns only proposals the contract accepts, and never a retirement", async () => {
    const { store } = await duplicates()
    const run = await store.consolidate(agent(), {
      consolidator: dreaming(),
      window: WINDOW,
      dryRun: true,
    })
    assert.ok(run.proposals.length)
    for (const proposal of run.proposals) {
      assert.deepEqual(validateRecord("memoryProposal", proposal, { sealed: false }).errors, [])
      assert.notEqual(proposal.lifecycle.action, "retire")
    }
  })

  it("refuses bad settings and needs the built-in consolidators", () => {
    assert.throws(() => dreaming({ sameText: 0 }), /sameText/)
    assert.throws(() => createConsolidator(), /built-in consolidators/)
  })
})

describe("Agent Memory Repo publishing", () => {
  it("writes accepted learnings as one-line entries, commits locally, and copies no comments", async () => {
    const { store } = await duplicates()
    const checkout = project()
    const memoryRepo = directory("memory")
    const options = { store, context: designer(), memoryRepo, checkout, gitEnv: GIT }
    const result = await publishToMemoryRepo(options)
    assert.equal(result.learnings, 2)
    assert.ok(result.commit && result.exportId)
    assert.equal(result.file, topicIn(result.memoryRepo))
    const memory = readFileSync(path.join(memoryRepo, "MEMORY.md"), "utf8")
    assert.match(memory, /^## Index\n- \[\[replica\/github\.com\/acme\/checkout-prototypes\]\]$/m)
    const text = readFileSync(topicIn(memoryRepo), "utf8")
    const entries = text.split("\n").filter((line) => line.startsWith("- "))
    assert.equal(entries.length, 2)
    for (const entry of entries)
      assert.match(
        entry,
        /^- [^\n]+ \[source: replica:github\.com\/acme\/checkout-prototypes\/mem_\w+; added: \d{4}-\d{2}-\d{2}; kind: rule; applies: skill \.agents\/skills\/create-prototype\/SKILL\.md\]$/,
      )
    for (const comment of ["vanish as soon as I type", "lost track of which field", "Agree."])
      assert.ok(!text.includes(comment), comment)
    assert.equal(git(memoryRepo, ["status", "--porcelain"]), "")
    assert.equal(git(memoryRepo, ["log", "--format=%s"]).trim().split("\n").length, 2)
    assert.equal((await publishToMemoryRepo(options)).commit, null)
  })

  it("keeps each repository's learnings in its own file", async () => {
    const github = await duplicates()
    const enterprise = await duplicates(undefined, ENTERPRISE)
    const checkout = project()
    const memoryRepo = directory("memory")
    const base = { memoryRepo, checkout, gitEnv: GIT }
    await publishToMemoryRepo({ ...base, store: github.store, context: designer() })
    await publishToMemoryRepo({ ...base, store: enterprise.store, context: designer(ENTERPRISE) })
    await github.store.withdrawGrant(designer(), github.grant.id, { purposes: ["instruction"] })
    await publishToMemoryRepo({ ...base, store: github.store, context: designer() })
    assert.match(readFileSync(topicIn(memoryRepo), "utf8"), /No accepted learnings are in effect/)
    const kept = readFileSync(topicIn(memoryRepo, ENTERPRISE), "utf8")
    assert.equal(kept.split("\n").filter((line) => line.startsWith("- ")).length, 2)
    const index = readFileSync(path.join(memoryRepo, "MEMORY.md"), "utf8")
    assert.match(index, /- \[\[replica\/github\.com\/acme\/checkout-prototypes\]\]/)
    assert.match(index, /- \[\[replica\/ghe\.example\.com\/acme\/checkout-prototypes\]\]/)
    assert.throws(() => learningsFile({ repository: "../escape" }), /plain lowercase names/)
  })

  it("refuses a memory repo inside or around the project, a plain directory, or uncommitted changes", async () => {
    const { store } = await duplicates()
    const checkout = project()
    const options = { store, context: designer(), checkout, gitEnv: GIT }
    await assert.rejects(
      publishToMemoryRepo({ ...options, memoryRepo: path.join(checkout, "memory") }),
      /separate from the project/,
    )
    await assert.rejects(
      publishToMemoryRepo({ ...options, memoryRepo: path.dirname(checkout) }),
      /separate from the project/,
    )
    const plain = directory("notes")
    mkdirSync(plain)
    writeFileSync(path.join(plain, "notes.md"), "Someone else's notes.\n")
    await assert.rejects(
      publishToMemoryRepo({ ...options, memoryRepo: plain }),
      /not a memory repo/,
    )
    assert.equal(existsSync(path.join(plain, ".git")), false)
    const dirty = directory("memory")
    await publishToMemoryRepo({ ...options, memoryRepo: dirty })
    writeFileSync(path.join(dirty, "draft.md"), "- An unsaved entry\n")
    await assert.rejects(
      publishToMemoryRepo({ ...options, memoryRepo: dirty }),
      /uncommitted changes/,
    )
  })

  it("refuses to write through symbolic links, even committed ones", async () => {
    const { store } = await duplicates()
    const checkout = project()
    const served = directory("served")
    mkdirSync(served)
    writeFileSync(path.join(served, "index.md"), "untouched\n")
    async function linked(setUp) {
      const memoryRepo = directory("memory")
      const options = { store, context: designer(), memoryRepo, checkout, gitEnv: GIT }
      await publishToMemoryRepo(options)
      setUp(memoryRepo)
      git(memoryRepo, ["add", "-A"])
      git(memoryRepo, ["commit", "-q", "-m", "Link out"])
      await assert.rejects(publishToMemoryRepo(options), /symbolic link/)
    }
    await linked((memoryRepo) => {
      rmSync(topicIn(memoryRepo))
      symlinkSync(path.join(served, "index.md"), topicIn(memoryRepo))
    })
    await linked((memoryRepo) => {
      rmSync(path.join(memoryRepo, "replica"), { recursive: true })
      symlinkSync(served, path.join(memoryRepo, "replica"))
    })
    await linked((memoryRepo) => {
      rmSync(path.join(memoryRepo, "MEMORY.md"))
      symlinkSync(path.join(served, "index.md"), path.join(memoryRepo, "MEMORY.md"))
    })
    assert.deepEqual(readdirSync(served), ["index.md"])
    assert.equal(readFileSync(path.join(served, "index.md"), "utf8"), "untouched\n")
  })

  it("ignores git variables that point at another repository", async () => {
    const { store } = await duplicates()
    const checkout = project()
    git(checkout, ["init", "-q"])
    writeFileSync(path.join(checkout, "README.md"), "Project\n")
    git(checkout, ["add", "README.md"])
    git(checkout, ["commit", "-q", "-m", "Project"])
    const memoryRepo = directory("memory")
    await publishToMemoryRepo({
      store,
      context: designer(),
      memoryRepo,
      checkout,
      gitEnv: {
        ...GIT,
        GIT_DIR: path.join(checkout, ".git"),
        GIT_WORK_TREE: checkout,
        GIT_INDEX_FILE: path.join(checkout, ".git", "index"),
      },
    })
    assert.equal(git(checkout, ["log", "--format=%s"]).trim(), "Project")
    assert.equal(git(checkout, ["status", "--porcelain"]), "")
    assert.equal(git(memoryRepo, ["log", "--format=%s"]).trim().split("\n").length, 2)
  })

  it("keeps what a team already wrote in MEMORY.md and links the learnings once", async () => {
    const { store } = await duplicates()
    const checkout = project()
    const memoryRepo = directory("memory")
    mkdirSync(memoryRepo)
    git(memoryRepo, ["init", "-q"])
    const original =
      "# Memory: Team\n\n- Prefers short summaries [added: 2026-10-01]\n\n## Index\n- [[team_structure]]\n\n## Notes\nKeep this.\n"
    writeFileSync(path.join(memoryRepo, "MEMORY.md"), original)
    git(memoryRepo, ["add", "MEMORY.md"])
    git(memoryRepo, ["commit", "-q", "-m", "Team memory"])
    const options = { store, context: designer(), memoryRepo, checkout, gitEnv: GIT }
    await publishToMemoryRepo(options)
    await publishToMemoryRepo(options)
    assert.equal(
      readFileSync(path.join(memoryRepo, "MEMORY.md"), "utf8"),
      original.replace(
        "- [[team_structure]]\n",
        "- [[team_structure]]\n- [[replica/github.com/acme/checkout-prototypes]]\n",
      ),
    )
    assert.equal(
      withIndexLink("# Memory\n", "replica/acme/web.md"),
      "# Memory\n\n## Index\n- [[replica/acme/web]]\n",
    )
  })

  it("removes learnings once instruction is withdrawn, and the withdrawal lists the copy", async () => {
    const { store, grant } = await duplicates()
    const checkout = project()
    const memoryRepo = directory("memory")
    const options = { store, context: designer(), memoryRepo, checkout, gitEnv: GIT }
    const first = await publishToMemoryRepo(options)
    const { exportsToFollowUp } = await store.withdrawGrant(designer(), grant.id, {
      purposes: ["instruction"],
    })
    assert.deepEqual(
      exportsToFollowUp
        .filter((item) => item.id === first.exportId)
        .map((item) => item.destination),
      [first.file],
    )
    const second = await publishToMemoryRepo(options)
    assert.equal(second.learnings, 0)
    assert.equal(second.exportId, null)
    assert.ok(second.commit)
    const text = readFileSync(first.file, "utf8")
    assert.match(text, /No accepted learnings are in effect\./)
    assert.ok(!text.includes("\n- "))
  })

  it("keeps each learning on one line with one metadata block", () => {
    const text = renderLearnings(
      [
        {
          id: "mem_aaaaaaaa1",
          kind: "rule",
          content: "Keep labels visible.\u202E\nSee [[secrets]] and \u001b[note: not metadata]",
          appliesTo: [{ kind: "skill", ref: "a;b]c.md" }],
          accepted: { at: "2026-10-09T12:00:00.000000Z" },
        },
      ],
      SCOPE,
    )
    const entries = text.split("\n").filter((line) => line.startsWith("- "))
    assert.equal(entries.length, 1)
    assert.ok(!entries[0].includes("[[") && !entries[0].includes("]]"))
    assert.ok(!entries[0].includes("\u001b") && !entries[0].includes("\u202E"))
    assert.match(
      entries[0],
      /\[source: replica:github\.com\/acme\/checkout-prototypes\/mem_aaaaaaaa1; added: 2026-10-09; kind: rule; applies: skill a,b\)c\.md\]$/,
    )
  })
})

describe("Agent Memory Repo from the command line", () => {
  it("loads Dreaming from a checkout's config, shows the merge, and publishes it", async () => {
    const checkout = directory("checkout")
    mkdirSync(checkout)
    git(checkout, ["init", "-q"])
    git(checkout, ["remote", "add", "origin", REMOTE])
    writeFileSync(path.join(checkout, ".gitignore"), ".replica/\n")
    const provider = createSqliteMemoryProvider({
      directory: path.join(checkout, ".replica", "learning"),
    })
    await duplicates(provider)
    await provider.close()
    mkdirSync(path.join(checkout, "tools"))
    copyFileSync(path.join(example, "dreaming.mjs"), path.join(checkout, "tools", "dreaming.mjs"))
    writeFileSync(
      path.join(checkout, ".replica", "learning", "config.json"),
      JSON.stringify({
        schemaVersion: "replica.learning-config/v1",
        githubRepository: {
          id: "12345",
          remote: `github.com/${REPOSITORY}`,
          legacyRepository: REPOSITORY,
        },
        consolidation: { consolidator: { module: "./tools/dreaming.mjs" } },
      }),
    )
    const migrated = await command(cli, checkout, ["migrate-scope", "--offline"])
    assert.equal(migrated.code, 0, migrated.stderr)
    const run = await command(cli, checkout, [
      "consolidate",
      "--from",
      WINDOW.from,
      "--to",
      WINDOW.to,
      "--json",
    ])
    assert.equal(run.code, 0, run.stderr)
    const [merge] = JSON.parse(run.stdout).proposals
    assert.equal(merge.proposal.consolidator.id, "agent-memory-repo-dreaming")
    const shown = await command(cli, checkout, ["show", merge.id])
    assert.match(shown.stdout, /Accepting it replaces: mem_\w+, mem_\w+ \(merge\)/)
    const accepting = await command(cli, checkout, [
      "accept",
      merge.id,
      "--digest",
      merge.reviewDigest,
      "--by",
      "github:ana-designer",
    ])
    assert.equal(accepting.code, 0, accepting.stderr)
    const memoryRepo = directory("memory")
    const published = await command(publish, checkout, [
      "--memory-repo",
      memoryRepo,
      "--by",
      "github:ana-designer",
    ])
    assert.equal(published.code, 0, published.stderr)
    assert.match(published.stdout, /Published 1 learning\(s\)/)
    assert.match(published.stdout, /Nothing was pushed\./)
    assert.ok(
      existsSync(topicIn(memoryRepo, { host: "github.com", repository: "repositories/12345" })),
    )
    const exported = await command(cli, checkout, [
      "export",
      "--purpose",
      "instruction",
      "--by",
      "github:ana-designer",
      "--learnings-only",
      "--json",
    ])
    assert.equal(JSON.parse(exported.stdout).contents, "learnings")
  })

  it("refuses an agent identity and runs as a script", async () => {
    const refused = await command(publish, work, ["--memory-repo", "x", "--by", "agent:copilot"])
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /Only a person/)
    assert.equal((await command(publish, work, ["--by", "github:ana-designer"])).code, 2)
    const script = spawnSync(process.execPath, [path.join(example, "publish.mjs"), "--help"], {
      encoding: "utf8",
    })
    assert.equal(script.status, 0)
    assert.match(script.stdout, /Agent Memory Repo/)
  })
})

async function command(main, cwd, args) {
  let stdout = ""
  let stderr = ""
  const code = await main(args, {
    cwd,
    env: { ...process.env, ...GIT },
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    clock: () => NOW,
  })
  return { code, stdout, stderr }
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...GIT },
  })
}
