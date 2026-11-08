import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { after, describe, it } from "node:test"
import {
  REMOTE,
  collectionLog,
  weekOneLabels,
  weekOneLog,
  weekTwoLog,
  weekTwoThreads,
} from "../conformance/fixtures.mjs"
import { main } from "../src/cli.mjs"
import { brandCheckQuestions } from "../src/decision/questions.mjs"

const work = mkdtempSync(path.join(tmpdir(), "replica-learning-decision-"))
after(() => rmSync(work, { recursive: true, force: true }))
const CLOCK = Date.parse("2026-10-09T12:00:00Z")
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)

async function cli(repo, args) {
  let stdout = ""
  let stderr = ""
  const code = await main(args, {
    cwd: repo,
    env: {},
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    stdin: Readable.from([]),
    clock: () => CLOCK,
  })
  return { code, stdout, stderr, json: () => JSON.parse(stdout) }
}

async function ok(repo, args) {
  const result = await cli(repo, args)
  assert.equal(result.code, 0, `${args.join(" ")} failed: ${result.stderr}`)
  return result
}

/**
 * A checkout whose team accepted the form-label learning from the reviews in `before`, then
 * imported the logs in `after`. By default it learns from week one and then imports week two,
 * where the person who reported placeholder labels on prototype 12 resolved the thread. `labels`
 * must name only comments that are not deleted by the last log in `before`.
 */
async function acceptedLearning(
  name,
  {
    before = [weekOneLog()],
    after = [weekTwoLog()],
    to = "2026-10-05T18:00:00Z",
    labels = weekOneLabels(),
    beforeConsolidating = async () => {},
  } = {},
) {
  const repo = path.join(work, name)
  mkdirSync(repo)
  execFileSync("git", ["init", "-q", repo])
  execFileSync("git", ["-C", repo, "remote", "add", "origin", REMOTE])
  writeFileSync(path.join(repo, ".gitignore"), ".replica/\n")
  writeFileSync(path.join(repo, "labels.json"), JSON.stringify(labels))
  const by = ["--by", "github:ana-designer"]
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
      ...by,
      "--json",
    ])
  ).json()
  async function importLogs(logs, prefix) {
    for (const [index, log] of logs.entries()) {
      const file = `${prefix}-${index + 1}.json`
      writeFileSync(path.join(repo, file), JSON.stringify(log))
      await ok(repo, ["import", "hub-comments", file, "--grant", grant.id])
    }
  }
  await importLogs(before, "before")
  await ok(repo, ["label", "labels.json", "--actor", "agent:copilot", "--model", "test-model"])
  await beforeConsolidating(repo)
  const run = (
    await ok(repo, ["consolidate", "--from", "2026-09-29T00:00:00Z", "--to", to, "--json"])
  ).json()
  const [proposal] = run.proposals
  await ok(repo, ["accept", proposal.id, "--digest", proposal.reviewDigest, ...by])
  await importLogs(after, "after")
  return { repo, learningId: proposal.id, by }
}

async function grantTraining(repo, by) {
  await ok(repo, [
    "grants",
    "add",
    "--purpose",
    "training",
    "--basis",
    "The design team agreed to train a brand-check model on its own reviews.",
    ...by,
  ])
}

/** The Builds the fixture threads point to: prototype ID, number, and when Hub published it. */
const BUILDS = [
  [11, 3, "2026-09-29T09:00:00Z"],
  [12, 2, "2026-09-30T09:00:00Z"],
  [12, 3, "2026-10-06T09:00:00Z"],
  [13, 5, "2026-10-01T09:00:00Z"],
]
/** Every width and theme the build action captures. */
const ALL_VIEWS = [
  ["desktop", "light"],
  ["desktop", "dark"],
  ["narrow", "light"],
  ["narrow", "dark"],
]

/**
 * A Builds file with screenshots of one page, /checkout by default, in the given views. Each
 * Build was made an hour before it was published unless its entry names when it was made.
 */
function buildsFile(
  repo,
  { builds = BUILDS, route = "/checkout", views = ALL_VIEWS, name = "builds.json" } = {},
) {
  const directory = path.join(repo, ".replica", "builds")
  mkdirSync(directory, { recursive: true })
  const entries = builds.map(([prototypeId, number, publishedAt, createdAt]) => ({
    prototypeId,
    number,
    createdAt: createdAt ?? new Date(Date.parse(publishedAt) - 3_600_000).toISOString(),
    publishedAt,
    screenshots: views.map(([size, theme]) => {
      const file = screenshotName(prototypeId, number, size, theme)
      writeFileSync(
        path.join(directory, file),
        Buffer.concat([PNG, Buffer.from(`${prototypeId}/${number}/${size}/${theme}`)]),
      )
      return { route, size, theme, path: file }
    }),
  }))
  const file = path.join(directory, name)
  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: "replica.decision-builds/v1", builds: entries }),
  )
  return file
}

function screenshotName(prototypeId, number, size, theme) {
  return `p${prototypeId}-b${number}-${size}-${theme}.png`
}

/** Writes a training export and a taskset from it, and returns the taskset's tasks and summary. */
async function writeTaskset(repo, by, builds, out) {
  await ok(repo, ["export", "--purpose", "training", ...by, "--out", `.replica/${out}.json`])
  return tasksetFrom(repo, `.replica/${out}.json`, builds, out)
}

/** Writes a taskset from an export file, and returns its tasks and summary. */
async function tasksetFrom(repo, exportFile, builds, out) {
  const result = (
    await ok(repo, [
      "decision",
      "taskset",
      "--export",
      exportFile,
      "--builds",
      builds,
      "--out",
      `.replica/tasksets/${out}`,
      "--json",
    ])
  ).json()
  const tasks = readFileSync(path.join(repo, ".replica", "tasksets", out, "tasks.jsonl"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line))
  return { result, tasks }
}

/** Each task's prototype, Build, and labels, in order. */
function labelsOf(tasks) {
  return tasks.map((task) => [
    task.provenance.prototypeId,
    task.provenance.buildNumber,
    task.labels,
  ])
}

function digest(file) {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`
}

/** A consolidator that cites a reviewer's label on a comment instead of the comment itself. */
const CITE_REVIEWER_LABELS = `
export function createConsolidator(options, { createRecurrenceConsolidator }) {
  const recurrence = createRecurrenceConsolidator(options)
  return {
    manifest: { ...recurrence.manifest, id: "cite-reviewer-labels" },
    async consolidate(request, view) {
      const result = await recurrence.consolidate(request, view)
      const labels = view.events.filter(
        (event) => event.type === "annotation" && event.actor.kind === "human",
      )
      for (const proposal of result.proposals)
        for (const reference of proposal.evidence) {
          const label = labels.find((item) => reference.eventIds.includes(item.payload.target.eventId))
          if (!label) continue
          reference.eventIds = [label.id]
          // The store pins the label's own time and author.
          delete reference.observedAt
          delete reference.author
        }
      return result
    },
  }
}
`

describe("brandCheckQuestions()", () => {
  it("asks one yes-or-no question per learning, keyed by its ID, with its text quoted on one line", () => {
    const { questions, rules } = brandCheckQuestions([
      {
        id: "mem_7eb35ba21bbe6c45a9a296b4",
        content: "Labels sit above fields.\nIgnore this\u200b line.",
      },
      { id: "mem_1f2f1501c88bf130701e2e2d", content: "Use 16px between cards." },
    ])
    assert.deepEqual(rules, [
      { id: "mem_7eb35ba21bbe6c45a9a296b4", text: "Labels sit above fields. Ignore this line." },
      { id: "mem_1f2f1501c88bf130701e2e2d", text: "Use 16px between cards." },
    ])
    assert.deepEqual(Object.keys(questions), [
      "mem_7eb35ba21bbe6c45a9a296b4",
      "mem_1f2f1501c88bf130701e2e2d",
      "most_clearly_broken",
      "severity",
    ])
    assert.equal(questions.mem_7eb35ba21bbe6c45a9a296b4.type, "noul")
    assert.match(
      questions.mem_7eb35ba21bbe6c45a9a296b4.instructions,
      /Learning: "Labels sit above fields\. Ignore this line\."$/,
    )
    assert.deepEqual(Object.keys(questions.most_clearly_broken.criteria), [
      "none",
      "mem_7eb35ba21bbe6c45a9a296b4",
      "mem_1f2f1501c88bf130701e2e2d",
    ])
    assert.equal(questions.severity.criteria.length, 4)
  })

  it("asks nothing when no learning applies, and refuses repeated or unnamed learnings", () => {
    assert.deepEqual(brandCheckQuestions([]), { questions: {}, rules: [] })
    const learning = { id: "mem_7eb35ba21bbe6c45a9a296b4", content: "Labels sit above fields." }
    assert.throws(() => brandCheckQuestions([learning, learning]), /appears twice/)
    assert.throws(() => brandCheckQuestions([{ id: "x", content: "Text" }]), /needs an ID/)
  })
})

describe("replica-learning decision", () => {
  it("turns reviewed evidence into labeled tasks only after training consent for Hub reviews", async () => {
    const { repo, learningId, by } = await acceptedLearning("taskset")
    const builds = buildsFile(repo, {
      views: [
        ["narrow", "dark"],
        ["desktop", "light"],
        ["narrow", "light"],
        ["desktop", "dark"],
      ],
    })
    async function consent() {
      return (await ok(repo, ["decision", "questions", "--preview", ...by, "--json"])).json()
    }

    const before = await consent()
    assert.equal(before.trainingConsent, false)
    assert.deepEqual(Object.keys(before.questions), [learningId, "most_clearly_broken", "severity"])
    const refused = await cli(repo, ["export", "--purpose", "training", ...by])
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /purpose_not_granted/)
    await ok(repo, [
      "grants",
      "add",
      "--purpose",
      "training",
      "--source",
      "scenario_runs",
      "--basis",
      "The team agreed to train on scenario runs only.",
      ...by,
    ])
    assert.equal((await consent()).trainingConsent, false)

    await grantTraining(repo, by)
    assert.equal((await consent()).trainingConsent, true)
    const { result, tasks } = await writeTaskset(repo, by, builds, "first")

    // The three threads that raised placeholder labels break the learning on their Builds. Its
    // author resolved the prototype 12 thread after Build 3, so Build 3 follows it.
    assert.deepEqual(labelsOf(tasks), [
      [11, 3, { [learningId]: { answer: false } }],
      [12, 2, { [learningId]: { answer: false } }],
      [12, 3, { [learningId]: { answer: true } }],
      [13, 5, { [learningId]: { answer: false } }],
    ])
    const twins = tasks.filter((task) => task.provenance.prototypeId === 12)
    assert.equal(twins[0].split, twins[1].split)
    const directory = path.join(repo, ".replica", "tasksets", "first")
    for (const task of tasks) {
      const { prototypeId, buildNumber } = task.provenance
      assert.equal(task.schemaVersion, "replica.decision-task/v1")
      assert.match(task.id, /^task_[0-9a-f]{24}$/)
      assert.deepEqual(Object.keys(task.questions), [learningId, "most_clearly_broken", "severity"])
      assert.deepEqual(
        task.images.map(({ role, size, theme }) => [role, size, theme]),
        ALL_VIEWS.map(([size, theme]) => ["candidate", size, theme]),
      )
      assert.match(
        task.state.imagesNote,
        /route \/checkout, shown as image 1 at desktop width in light theme, image 2 at desktop width in dark theme, image 3 at narrow width in light theme, image 4 at narrow width in dark theme\.$/,
      )
      for (const image of task.images) {
        const source = path.join(
          repo,
          ".replica",
          "builds",
          screenshotName(prototypeId, buildNumber, image.size, image.theme),
        )
        assert.equal(image.digest, digest(source))
        assert.equal(digest(path.join(directory, image.path)), image.digest)
      }
      assert.equal(task.provenance.exportId, result.exportId)
    }
    assert.deepEqual([result.counts.follows, result.counts.breaks], [1, 3])
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(directory, "taskset.json"), "utf8")).counts,
      result.counts,
    )
  })

  it("finds the later Build by when Builds were made, not by their numbers", async () => {
    const { repo, learningId, by } = await acceptedLearning("chronology")
    await grantTraining(repo, by)
    // Hub found Build 3 first but GitHub made it before Build 2, and Build 1 came after both.
    const builds = buildsFile(repo, {
      builds: [
        [11, 3, "2026-09-29T09:00:00Z"],
        [12, 1, "2026-10-05T09:00:00Z", "2026-10-05T08:00:00Z"],
        [12, 2, "2026-09-30T09:00:00Z", "2026-09-30T08:00:00Z"],
        [12, 3, "2026-10-06T09:00:00Z", "2026-09-29T08:00:00Z"],
        [13, 5, "2026-10-01T09:00:00Z"],
      ],
    })

    const { tasks } = await writeTaskset(repo, by, builds, "chronology")

    assert.deepEqual(labelsOf(tasks), [
      [11, 3, { [learningId]: { answer: false } }],
      [12, 1, { [learningId]: { answer: true } }],
      [12, 2, { [learningId]: { answer: false } }],
      [13, 5, { [learningId]: { answer: false } }],
    ])
  })

  it("does not take a resolution as fixing a problem someone wrote after it", async () => {
    // The prototype 12 thread was resolved on October 7, then its first comment was rewritten on
    // October 8, and the learning cites the rewritten comment.
    const threads = weekTwoThreads()
    const thread = threads.find((item) => item.root.id === 103)
    thread.root = {
      ...thread.root,
      body: "The error text under the email field sits inside the input as a placeholder.",
      editedAt: "2026-10-08T10:00:00.000000Z",
      updatedAt: "2026-10-08T10:00:00.000000Z",
    }
    const { repo, learningId, by } = await acceptedLearning("stale-resolution", {
      before: [
        weekOneLog(),
        weekTwoLog(),
        collectionLog({
          snapshotId: "3b6f1d2e-4c5a-4e7b-9a8c-1d2e3f4a5b6c",
          capturedAt: "2026-10-09T09:00:00.000000Z",
          threads,
        }),
      ],
      after: [],
      to: "2026-10-09T09:00:00Z",
      // Week two deleted comment 107, so nothing labels it.
      labels: {
        labels: weekOneLabels().labels.filter((label) => label.target.commentId !== 107),
      },
    })
    await grantTraining(repo, by)

    const { result, tasks } = await writeTaskset(repo, by, buildsFile(repo), "stale")

    assert.deepEqual(labelsOf(tasks), [
      [11, 3, { [learningId]: { answer: false } }],
      [12, 2, { [learningId]: { answer: false } }],
      [13, 5, { [learningId]: { answer: false } }],
    ])
    assert.equal(result.skipped["resolved-before-evidence"], 1)
  })

  it("takes only the person who wrote the problem as confirming its fix, not a label's author", async () => {
    // A reviewer labels the placeholder comment on prototype 12, a consolidator cites that label
    // as the evidence, and the same reviewer, not the comment's author, resolves the thread.
    const threads = weekTwoThreads()
    const thread = threads.find((item) => item.root.id === 103)
    thread.root = {
      ...thread.root,
      resolvedAt: "2026-10-09T13:00:00.000000Z",
      resolvedBy: {
        login: "cy-engineer",
        name: null,
        avatarUrl: "https://avatars.example.com/cy-engineer",
      },
      updatedAt: "2026-10-09T13:00:00.000000Z",
    }
    const { repo, learningId, by } = await acceptedLearning("label-author", {
      after: [weekTwoLog({ capturedAt: "2026-10-09T18:00:00.000000Z", threads })],
      async beforeConsolidating(repo) {
        const label = weekOneLabels().labels.find((item) => item.target.commentId === 103)
        writeFileSync(path.join(repo, "review-labels.json"), JSON.stringify({ labels: [label] }))
        await ok(repo, ["label", "review-labels.json", "--actor", "github:cy-engineer"])
        mkdirSync(path.join(repo, "tools"))
        writeFileSync(path.join(repo, "tools", "cite-labels.mjs"), CITE_REVIEWER_LABELS)
        writeFileSync(
          path.join(repo, ".replica", "learning", "config.json"),
          JSON.stringify({
            schemaVersion: "replica.learning-config/v1",
            consolidation: { consolidator: { module: "./tools/cite-labels.mjs" } },
          }),
        )
      },
    })
    await grantTraining(repo, by)

    const { tasks } = await writeTaskset(repo, by, buildsFile(repo), "label-author")

    assert.deepEqual(labelsOf(tasks), [
      [11, 3, { [learningId]: { answer: false } }],
      [12, 2, { [learningId]: { answer: false } }],
      [13, 5, { [learningId]: { answer: false } }],
    ])
    const bundle = JSON.parse(
      readFileSync(path.join(repo, ".replica", "label-author.json"), "utf8"),
    )
    const events = bundle.episodes.flatMap((episode) => episode.timeline)
    const [cited] = tasks[1].provenance.evidence[0].eventIds.map((id) =>
      events.find((event) => event.id === id),
    )
    assert.deepEqual([cited.type, cited.actor.id], ["annotation", "github:cy-engineer"])
  })

  it("does not decide between two status changes made at the same time", async () => {
    // A snapshot taken at 09:00 shows the prototype 12 thread reopened, and the next one shows
    // it resolved at 09:00 too, so nothing says which change came last.
    function snapshot(snapshotId, capturedAt, resolution) {
      const threads = weekTwoThreads()
      const thread = threads.find((item) => item.root.id === 103)
      thread.root = { ...thread.root, ...resolution, updatedAt: capturedAt }
      return collectionLog({ snapshotId, capturedAt, threads })
    }
    const { repo, learningId, by } = await acceptedLearning("status-tie", {
      after: [
        weekTwoLog(),
        snapshot("5d2c8e1a-7b3f-4c6d-8e9f-0a1b2c3d4e5f", "2026-10-09T09:00:00.000000Z", {
          resolvedAt: null,
          resolvedBy: null,
        }),
        snapshot("6e3d9f2b-8c4a-4d7e-9f0a-1b2c3d4e5f60", "2026-10-09T10:00:00.000000Z", {
          resolvedAt: "2026-10-09T09:00:00.000000Z",
        }),
      ],
    })
    await grantTraining(repo, by)
    const builds = buildsFile(repo)

    const { result, tasks } = await writeTaskset(repo, by, builds, "status-tie")

    const breaks = [
      [11, 3, { [learningId]: { answer: false } }],
      [12, 2, { [learningId]: { answer: false } }],
      [13, 5, { [learningId]: { answer: false } }],
    ]
    assert.deepEqual(labelsOf(tasks), breaks)
    assert.equal(result.skipped["status-ambiguous"], 1)
    // The export does not protect the order of a timeline, so reversing it changes nothing.
    const bundle = JSON.parse(readFileSync(path.join(repo, ".replica", "status-tie.json"), "utf8"))
    for (const episode of bundle.episodes) episode.timeline.reverse()
    writeFileSync(path.join(repo, ".replica", "reversed.json"), JSON.stringify(bundle))
    const reversed = await tasksetFrom(repo, ".replica/reversed.json", builds, "reversed")
    assert.deepEqual(labelsOf(reversed.tasks), breaks)
  })

  it("keeps only the follows labels of a page missing a width or theme", async () => {
    const { repo, learningId, by } = await acceptedLearning("partial-renderings")
    await grantTraining(repo, by)
    // Older Builds kept light screenshots only, and a reviewer may have seen a problem in dark.
    const builds = buildsFile(repo, {
      views: [
        ["desktop", "light"],
        ["narrow", "light"],
      ],
    })

    const { result, tasks } = await writeTaskset(repo, by, builds, "partial")

    assert.deepEqual(labelsOf(tasks), [[12, 3, { [learningId]: { answer: true } }]])
    assert.equal(result.skipped["renderings-incomplete"], 3)
  })

  it("keeps a fix in doubt out of the tasks when a thread on the later Build reports the same problem", async () => {
    const { repo, by } = await acceptedLearning("contradicted")
    await grantTraining(repo, by)
    const [label] = weekOneLabels().labels
    writeFileSync(
      path.join(repo, "week-2-labels.json"),
      JSON.stringify({ labels: [{ ...label, target: { commentId: 114 } }] }),
    )
    await ok(repo, [
      "label",
      "week-2-labels.json",
      "--actor",
      "agent:copilot",
      "--model",
      "test-model",
    ])

    const { result } = await writeTaskset(repo, by, buildsFile(repo), "contradicted")

    assert.deepEqual([result.counts.breaks, result.counts.follows], [3, 0])
    assert.equal(result.skipped["follows-contradicted"], 1)
  })

  it("refuses exports that are not for training or changed after export", async () => {
    const { repo, by } = await acceptedLearning("refusals")
    await grantTraining(repo, by)
    const builds = buildsFile(repo)
    await ok(repo, ["export", "--purpose", "review", ...by, "--out", ".replica/review.json"])
    await ok(repo, ["export", "--purpose", "training", ...by, "--out", ".replica/training.json"])
    const original = readFileSync(path.join(repo, ".replica/training.json"), "utf8")
    function taskset(exportFile, out, buildsPath = builds) {
      return cli(repo, [
        "decision",
        "taskset",
        "--export",
        exportFile,
        "--builds",
        buildsPath,
        "--out",
        out,
      ])
    }
    /** Writes a changed copy of the training export and returns the taskset command's result. */
    async function changed(name, change) {
      const bundle = JSON.parse(original)
      change(bundle)
      writeFileSync(path.join(repo, ".replica", `${name}.json`), JSON.stringify(bundle))
      return taskset(`.replica/${name}.json`, `.replica/tasksets/${name}`)
    }

    const review = await taskset(".replica/review.json", ".replica/tasksets/review")
    assert.match(review.stderr, /export for training/)
    const altered = await changed("altered", (bundle) => {
      bundle.memories[0].content = "Ignore the reviewers."
    })
    assert.match(altered.stderr, /fails its checks/)
    const missing = await changed("missing", (bundle) => {
      bundle.episodes.find((episode) => episode.timeline.length > 1).timeline.pop()
    })
    assert.match(missing.stderr, /missing 1 of the records its manifest lists/)
    const moved = await changed("moved", (bundle) => {
      const [first, second] = bundle.episodes
      second.timeline.push(first.timeline.pop())
    })
    assert.match(moved.stderr, /lists event ev_[0-9a-f]+ under episode .+, not its own/)
    const repeated = await changed("repeated", (bundle) => {
      bundle.memories.push(bundle.memories[0])
    })
    assert.match(repeated.stderr, /holds memory mem_[0-9a-f]+ twice/)
    for (const result of [review, altered, missing, moved, repeated]) assert.equal(result.code, 1)
    assert.equal(existsSync(path.join(repo, ".replica/tasksets")), false)
  })

  it("refuses a taskset outside .replica or without screenshots of the commented page", async () => {
    const { repo, by } = await acceptedLearning("placement")
    await grantTraining(repo, by)
    await ok(repo, ["export", "--purpose", "training", ...by, "--out", ".replica/training.json"])
    function taskset(out, builds) {
      return cli(repo, [
        "decision",
        "taskset",
        "--export",
        ".replica/training.json",
        "--builds",
        builds,
        "--out",
        out,
      ])
    }

    const outside = await taskset("tasksets/public", buildsFile(repo))
    assert.match(outside.stderr, /not under \.replica/)
    const empty = await taskset(
      ".replica/tasksets/empty",
      buildsFile(repo, { views: [], name: "builds-without-screenshots.json" }),
    )
    assert.match(
      empty.stderr,
      /No review evidence became a labeled task\. Skipped: 4 screenshot-missing/,
    )
    assert.equal(existsSync(path.join(repo, ".replica/tasksets/empty")), false)
    const otherPage = await taskset(
      ".replica/tasksets/other-page",
      buildsFile(repo, { route: "/checkout?step=2", name: "builds-step-2.json" }),
    )
    assert.match(otherPage.stderr, /Skipped: 4 screenshot-missing/)
    for (const result of [outside, empty, otherPage]) assert.equal(result.code, 1)
  })
})
