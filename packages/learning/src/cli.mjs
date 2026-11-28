import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants, createReadStream, existsSync } from "node:fs"
import {
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, promisify } from "node:util"
import { decodeUtf8, parseJson } from "./canonical-json.mjs"
import { LearningError } from "./errors.mjs"
import { createCopilotEvaluator, scoreUsedLearning } from "./evaluation.mjs"
import {
  importSqliteStore,
  openConsolidator,
  openLabeler,
  openLegacyRedactionStore,
  openLearningStore,
  openProvider,
  migrateScopeOffline,
  placementProblem,
  realLocation,
  resolveEnvironment,
} from "./config.mjs"
import { labelComments, labelingError } from "./labeling.mjs"
import { setupLocalLearning } from "./setup.mjs"
import { migratePostgres } from "./providers/postgres-database.mjs"
import { FEEDBACK_TYPES, feedbackText, PRODUCER } from "./records.mjs"
import { NO_FOLLOW } from "./providers/files.mjs"
import { createFileLock } from "./providers/lock.mjs"
import {
  MAX_REPORT_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_BYTES,
  createScreenshotStore,
} from "./screenshots.mjs"
import { HUB_SOURCE } from "./sources/hub-review-comments.mjs"
import { createLearningStore } from "./store.mjs"
import * as localLearning from "./local-learning.mjs"
import { createCopilotDrafter, proposeUpdates } from "./updates.mjs"
import { parseTimeOption, timestampFromMilliseconds } from "./time.mjs"
import decisionModelCatalog from "./decision/models.json" with { type: "json" }
import { MAX_QUESTION_LEARNINGS, brandCheckQuestions } from "./decision/questions.mjs"
import { planDecisionTasks } from "./decision/tasks.mjs"
import { writeDecisionTaskset } from "./decision/taskset.mjs"

const USAGE = `replica-learning: capture review evidence, propose learnings, and recall the accepted ones.

Usage: replica-learning <command> [options]

Set up
  setup [--actor <agent:name>]    Set up local learning mode in this prototype checkout:
                                  keep .replica/ out of Git and write a private MCP
                                  config there, then print how to start Copilot CLI

Inspect
  status                          Counts and anything that needs attention
  doctor                          Which provider, consolidator, scope, and directory are in use, and why
  observations [--purpose <p>] [--event <id>]...
                                  Evidence a purpose may use now; select up to
                                  100 event IDs and only their containing episodes
  memories [--state <s>]... [--purpose <p>]
                                  Learnings with their state and whether they are
                                  recalled; --purpose instruction shows what agents see
  show <memory-id> [--history] [--purpose <p>]
                                  One learning, its evidence, and its digests
  operation-status <memory-id> --operation-id <uuid>
                                  Whether one host decision operation is in intact history
  verify                          Re-check every record's schema, digest, and history
  migrate                         Set up PostgreSQL using REPLICA_LEARNING_MIGRATION_DATABASE_URL
  migrate-scope --offline         Confirm and migrate a legacy store after stopping older clients
                [--empty]         Confirm that a new custom-provider store is empty
  import-sqlite --offline         Copy a stopped Hub SQLite store into PostgreSQL
  copilot status                  Whether Copilot answers here, as whom, and with which models

Consent (a person decides; --by github:<login>)
  grants list
  grants withdrawals
  grants add --purpose <p>... --basis <text> --by <id> [--source <s>]... [--expires <time>]
             [--evidence-from <time>] [--evidence-until <time>]
  grants withdraw <grant-id> --purpose <p>... --by <id> [--reason <text>]
  redact <event-id> --by <id> --reason <text>
                                  Remove a comment's text: every version and its labels
  redact --comment <hub-comment-id> --by <id> [--reason <text>]
                                  The same, for a Hub comment named by its Hub ID; it
                                  imports nothing and needs no active grant
  delete <memory-id> --by <id> --reason <text>
                                  Remove a learning for good, with the records of its
                                  deliveries and use and their screenshots
  expire-guidance --by <id> [--days <n>]
                                  Remove recall records older than n days (default 365)
                                  that no usage report names
  delete-repository --by <id> --confirm <owner/name>
                                  Remove every record this repository's store holds,
                                  including the audit trail

Capture and propose
  import hub-comments <log.json> --grant <grant-id>... [--actor <id>] [--redact-deleted]
                                  --redact-deleted also removes the text of deleted comments
  import agent-session <session.json> --grant <grant-id>... --actor <agent:name>
                                  Store a coding agent session's user and agent
                                  messages and outcome; sending it again updates it
  label [--relabel] [--limit <n>] [--max-requests <n>] [--since <time>] [--model <model>]
                                  With Copilot, or the configured labeler, label the
                                  comments it has not been asked about and report its
                                  usage; --relabel asks about them again and replaces
                                  this labeler's earlier judgments; --since skips older
                                  comments, and --max-requests bounds labeler requests
  label <labels.json> --actor <agent:name> [--model <model>]
                                  Record labels someone else wrote
  consolidate --from <time> --to <time> [--max <n>] [--dry-run] [--actor <id>]
                                  --max caps the new or changed proposals a run
                                  stores (default 10); unchanged ones do not count
  analyze [--commit <sha>]        Label, then consolidate the last 90 days; with
                                  --commit, also score the learnings an agent used
                                  in it and suggest new wording; mcp starts this

Review (a person decides; --by github:<login>)
  accept <memory-id> --digest <sha256:...> --by <id> [--content-file <file>] [--note <text>]
  reject <memory-id> --digest <sha256:...> --by <id> (--reason <text> | --reason-file <file>)
  retire <memory-id> --by <id> (--reason <text> | --reason-file <file>)
  edit <memory-id> --digest <sha256:...> --by <id> (--reason <text> | --reason-file <file>)
                   [--title-file <file>] [--content-file <file>]
  reinstate <memory-id> --digest <sha256:...> --by <id> (--reason <text> | --reason-file <file>)
                                  Use the version digest from show for edit and reinstate
  supersede <old-id>... --with <new-id> --by <id> [--reason <text>]
                                  Only for a learning that recall uses and that
                                  replaces nothing yet
  updates <memory-id>             List suggested new wording for a learning
  apply-update <proposal-id> --by <id> (--reason <text> | --reason-file <file>)
               --operation-id <uuid> [--title-file <file>] [--content-file <file>]
                                  Make the suggested wording, or your edit of it,
                                  the learning's next version
  dismiss-update <proposal-id> [--operation-id <uuid>] --by <id>
                 (--reason <text> | --reason-file <file>)

Use
  recall [--task <text> | --task-file <file>] [--limit <n>] [--budget <chars>]
         [--session-id <id> [--session-label <text>]] [--preview --by <id>]
         [--shared-file <file>]
                                  --task-file - reads the task from standard input;
                                  --shared-file adds accepted learnings other
                                  repositories shared to a preview, as a JSON
                                  list of records;
                                  --preview shows a person what an agent would get,
                                  unaudited
  report-usage <report.json> --actor <id> [--grant <grant-id>]
                                  Record which recalled learnings an agent used for a
                                  commit, with optional before and after screenshots;
                                  --grant names the consent that allows them
  usage --commit <sha>            List what agents reported using for one commit
  outcomes <memory-id>            List how agents' uses of one learning were scored
  score <used-learning-id> --operation-id <uuid> [--diff-file <file>]
        [--screenshots <dir>] [--reviewer-verified-at <time>]
                                  Score how well one used learning helped, with
                                  Copilot Fusion or else Auto; --screenshots names
                                  a directory of PNGs named by their sha256 hex for
                                  a store that does not keep them;
                                  --reviewer-verified-at says when a reviewer
                                  confirmed the work addressed their feedback
  propose-update <memory-id>      Suggest new wording for an accepted learning when
                                  scored uses keep showing the same issue; Copilot
                                  drafts it only when the evidence is enough
  export --purpose <p> --by <id> [--out <file>] [--learnings-only] [--preview]
  mcp [--actor <agent:name>] [--grant <grant-id>]... [--manual]
                                  Serve the learning tools to a coding agent over
                                  standard input and output. It asks the person in a
                                  form to agree to learning and to decide on
                                  suggestions, and runs analyze in the background;
                                  --grant limits it to those grants, and --manual
                                  leaves analyze to you. Screenshots must sit in
                                  this directory

Decision model
  decision models                 Base models suggested for checking screenshots
  decision questions --by <id> [--limit <n>] [--preview]
                                  The typed questions a decision model answers about a
                                  page: one yes-or-no question per accepted learning
  decision taskset --export <file> --builds <file> --out <dir> [--brand-sheet <image>]
                   [--created-at <time>]
                                  Labeled tasks for a reinforcement learning environment,
                                  from a training export and the Builds' screenshots
Options: --dir <path> data directory (default .replica/learning), --json machine output.
A host that keeps stores outside checkouts, such as Hub, names the repository with
--repository github.com/repositories/<id> and its store with --dir. It may name the
previous scope with --legacy-repository <host/owner/name> when migrating an existing store.
In a checkout, use --legacy-repository only with migrate-scope --offline.
Times: now, 7d, 12h, 30m, or an RFC 3339 time. Purposes: review, instruction, evaluation,
analytics, training, publication.
`

const OPTIONS = {
  dir: { type: "string" },
  repository: { type: "string" },
  "legacy-repository": { type: "string" },
  offline: { type: "boolean" },
  empty: { type: "boolean" },
  "legacy-redaction": { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  purpose: { type: "string", multiple: true },
  source: { type: "string", multiple: true },
  basis: { type: "string" },
  by: { type: "string" },
  actor: { type: "string" },
  model: { type: "string" },
  expires: { type: "string" },
  "evidence-from": { type: "string" },
  "evidence-until": { type: "string" },
  reason: { type: "string" },
  grant: { type: "string", multiple: true },
  from: { type: "string" },
  to: { type: "string" },
  max: { type: "string" },
  "dry-run": { type: "boolean" },
  state: { type: "string", multiple: true },
  type: { type: "string", multiple: true },
  event: { type: "string", multiple: true },
  history: { type: "boolean" },
  digest: { type: "string" },
  "content-file": { type: "string" },
  "title-file": { type: "string" },
  "reason-file": { type: "string" },
  "operation-id": { type: "string" },
  note: { type: "string" },
  with: { type: "string" },
  task: { type: "string" },
  "task-file": { type: "string" },
  "shared-file": { type: "string" },
  limit: { type: "string" },
  "max-requests": { type: "string" },
  relabel: { type: "boolean" },
  since: { type: "string" },
  "redact-deleted": { type: "boolean" },
  comment: { type: "string" },
  budget: { type: "string" },
  preview: { type: "boolean" },
  out: { type: "string" },
  "learnings-only": { type: "boolean" },
  export: { type: "string" },
  builds: { type: "string" },
  "brand-sheet": { type: "string" },
  "created-at": { type: "string" },
  "session-id": { type: "string" },
  "session-label": { type: "string" },
  commit: { type: "string" },
  "diff-file": { type: "string" },
  "reviewer-verified-at": { type: "string" },
  screenshots: { type: "string" },
  days: { type: "string" },
  confirm: { type: "string" },
  manual: { type: "boolean" },
}

class UsageError extends Error {}

/**
 * Run the CLI. Returns the exit code: 0 on success, 1 when the store refuses or a check
 * fails, 2 for a usage error.
 *
 * @param {string[]} argv arguments after the program name
 */
export async function main(
  argv,
  {
    cwd = process.cwd(),
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    stdin = process.stdin,
    clock = Date.now,
    startAnalysis = localLearning.startAnalysis,
  } = {},
) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    })
  } catch (error) {
    stderr.write(`${error.message}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  if (values.help || !positionals.length) {
    ;(values.help ? stdout : stderr).write(USAGE)
    return values.help ? 0 : 2
  }
  function out(data, text) {
    stdout.write(values.json ? `${JSON.stringify(data, null, 2)}\n` : `${text.trimEnd()}\n`)
  }
  // Stores this command opened. A database provider holds connections that keep Node
  // running, so every one is closed before the command returns, whatever happened.
  const opened = []
  try {
    if (positionals[0] === "migrate") {
      if (positionals.length !== 1)
        throw new UsageError("Use migrate without additional arguments.")
      const result = await migratePostgres({
        connectionString: env.REPLICA_LEARNING_MIGRATION_DATABASE_URL,
      })
      out(result, `PostgreSQL learning schema is at migration ${result.version}.`)
      return 0
    }
    if (
      positionals[0] === "import-sqlite" &&
      (positionals.length !== 1 ||
        !values.offline ||
        !values.dir ||
        !values.repository ||
        !/^github\.com\/repositories\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          values["legacy-repository"] ?? "",
        ))
    )
      throw new UsageError(
        "Stop older clients, then use import-sqlite --offline with --dir, --repository, and the Hub UUID as --legacy-repository.",
      )
    if (
      values["legacy-redaction"] &&
      (positionals.length !== 1 ||
        positionals[0] !== "redact" ||
        values.comment === undefined ||
        !values["legacy-repository"] ||
        values.repository)
    )
      throw new UsageError(
        "--legacy-redaction is only for redact --comment with a Hub UUID in --legacy-repository.",
      )
    if (
      values.empty &&
      (positionals[0] !== "migrate-scope" || !values.offline || values["legacy-repository"])
    )
      throw new UsageError("--empty is used only with migrate-scope --offline and no old name.")
    if (
      values["legacy-repository"] &&
      !values.repository &&
      !values["legacy-redaction"] &&
      (positionals[0] !== "migrate-scope" || !values.offline)
    )
      throw new UsageError(
        "A checkout's --legacy-repository is used only with migrate-scope --offline.",
      )
    const environment = await resolveEnvironment({
      cwd,
      env,
      directory: values.dir,
      repository: values.repository,
      legacyRepository: values["legacy-repository"],
      legacyRedaction: values["legacy-redaction"],
      resolveIdentity:
        [
          "status",
          "doctor",
          "migrate-scope",
          "label",
          "observations",
          "consolidate",
          "analyze",
          "memories",
          "show",
          "operation-status",
          "accept",
          "reject",
          "retire",
          "edit",
          "reinstate",
          "supersede",
          "redact",
          "recall",
          "report-usage",
          "usage",
          "outcomes",
          "score",
          "propose-update",
          "updates",
          "apply-update",
          "dismiss-update",
          "delete",
          "expire-guidance",
          "delete-repository",
          "export",
          "mcp",
          "verify",
          "setup",
        ].includes(positionals[0]) ||
        (positionals[0] === "grants" &&
          ["list", "withdrawals", "add", "withdraw"].includes(positionals[1])) ||
        (positionals[0] === "import" &&
          ["hub-comments", "agent-session"].includes(positionals[1])) ||
        (positionals[0] === "decision" && positionals[1] === "questions"),
    })
    const session = {
      environment,
      values,
      positionals,
      out,
      clock,
      cwd,
      env,
      stdin,
      stdout,
      stderr,
      opened,
      startAnalysis,
    }
    return (await run(session)) ?? 0
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`${error.message}\n\nRun replica-learning --help for usage.\n`)
      return 2
    }
    if (error instanceof LearningError) {
      stderr.write(`error (${error.code}): ${error.message}\n`)
      return 1
    }
    if (env.REPLICA_LEARNING_DEBUG) throw error
    stderr.write(`error: ${error.message}\nSet REPLICA_LEARNING_DEBUG=1 for details.\n`)
    return 1
  } finally {
    for (const store of opened)
      await store.close().catch((error) => {
        stderr.write(`warning: the provider did not close: ${error.message}\n`)
      })
  }
}

async function run(session) {
  const { positionals } = session
  const [command, sub] = positionals
  switch (command) {
    case "status":
      return status(session)
    case "doctor":
      return doctor(session)
    case "migrate-scope":
      return migrateScope(session)
    case "import-sqlite": {
      const result = await importSqliteStore(session.environment, { clock: session.clock })
      session.out(
        result,
        result.alreadyImported
          ? "SQLite history was already imported."
          : "SQLite history was imported.",
      )
      return 0
    }
    case "grants":
      if (sub === "list") return listGrants(session)
      if (sub === "withdrawals") return listWithdrawals(session)
      if (sub === "add") return addGrant(session)
      if (sub === "withdraw") return withdrawGrant(session)
      throw new UsageError("Use grants list, grants withdrawals, grants add, or grants withdraw.")
    case "import":
      if (sub === "hub-comments") return importHub(session)
      if (sub === "agent-session") return importSession(session)
      throw new UsageError(
        "Use import hub-comments <log.json> or import agent-session <session.json>.",
      )
    case "label":
      return label(session)
    case "copilot":
      if (sub === "status") return copilotStatus(session)
      throw new UsageError("Use copilot status.")
    case "observations":
      return observations(session)
    case "consolidate":
      return consolidate(session)
    case "analyze":
      return analyze(session)
    case "memories":
      return memories(session)
    case "show":
      return show(session)
    case "operation-status":
      return operationStatus(session)
    case "accept":
    case "reject":
      return review(session, command)
    case "edit":
    case "reinstate":
      return changeAccepted(session, command)
    case "retire":
      return retire(session)
    case "supersede":
      return supersede(session)
    case "redact":
      return redact(session)
    case "recall":
      return recall(session)
    case "report-usage":
      return reportUsage(session)
    case "usage":
      return usage(session)
    case "outcomes":
      return outcomes(session)
    case "score":
      return score(session)
    case "propose-update":
      return proposeUpdate(session)
    case "updates":
      return updates(session)
    case "apply-update":
      return applyUpdate(session)
    case "dismiss-update":
      return dismissUpdate(session)
    case "delete":
      return deleteMemory(session)
    case "expire-guidance":
      return expireGuidance(session)
    case "delete-repository":
      return deleteRepository(session)
    case "export":
      return exportRecords(session)
    case "setup":
      return setup(session)
    case "mcp":
      return serveMcp(session)
    case "verify":
      return verify(session)
    case "decision":
      if (sub === "models") return decisionModels(session)
      if (sub === "questions") return decisionQuestions(session)
      if (sub === "taskset") return decisionTaskset(session)
      throw new UsageError("Use decision models, decision questions, or decision taskset.")
    default:
      throw new UsageError(`Unknown command: ${command}`)
  }
}

async function migrateScope(session) {
  if (session.positionals.length !== 1 || !session.values.offline)
    throw new UsageError("Stop older clients, then run migrate-scope --offline.")
  const result = await migrateScopeOffline(session.environment, {
    clock: session.clock,
    empty: session.values.empty,
  })
  const lines = [
    result.empty
      ? "Confirmed the new store is empty. The configured provider is unchanged."
      : result.sourceProvider
        ? `Repository history is in ${result.file}. The original provider is unchanged and may contain other repositories.`
        : `Repository history is in ${result.file}. The provider is used in place.`,
    ...(result.redactionFollowUps ? redactionFollowUpLines(result.redactionFollowUps) : []),
  ]
  session.out(result, lines.join("\n"))
}

async function open(session) {
  const openStore = session.environment.legacyRedaction
    ? openLegacyRedactionStore
    : openLearningStore
  const opened = await openStore(session.environment, {
    clock: session.clock,
  })
  session.opened.push(opened.store)
  if (!session.environment.hosted && session.positionals[0] !== "status") {
    const lines = (opened.migrationRedactionFollowUps ?? []).flatMap(redactionFollowUpLines)
    if (lines.length) session.stderr.write(`${[...new Set(lines)].join("\n")}\n`)
  }
  return opened
}

function redactionFollowUpLines(followUps) {
  return [
    ...(followUps.memoriesNeedingRebuild ?? []).map(
      (id) => `Rebuild learning ${id} because its evidence was removed.`,
    ),
    ...(followUps.exportsToFollowUp ?? []).map(
      (item) =>
        `Follow up on export ${item.id} at ${quoted(item.destination, Infinity)}; it may contain removed text.`,
    ),
  ]
}

function context(session, principal) {
  return {
    scope: session.environment.scope,
    sourceRepository: session.environment.sourceRepository,
    principal,
  }
}

/** Where the data directory sits and whether that is safe, for doctor. */
function placementLabel(environment) {
  if (!environment.insideCheckout)
    return environment.hosted ? "outside any checkout" : "outside the checkout"
  if (environment.hosted)
    return environment.ignoredByGit
      ? `inside ${environment.checkout}, ignored by Git`
      : `NOT ignored by Git in ${environment.checkout}; choose a directory Git ignores`
  if (!environment.underReplica) return "NOT under .replica/; move it there"
  return environment.ignoredByGit
    ? "under .replica/, ignored by Git"
    : "NOT ignored by Git; add .replica/ to .gitignore"
}

/** A scope the way the CLI shows it. */
function scopeLabel(scope) {
  return [scope.host, scope.repository].filter(Boolean).join("/")
}

/** The person making a decision. The local CLI cannot authenticate them, so the identity is marked asserted. */
function person(session) {
  const id = session.values.by
  if (!id) throw new UsageError("Name the person deciding with --by github:<login>.")
  if (!/^(?:github|human):\S+$/.test(id))
    throw new LearningError(
      "human_required",
      "Only a person can make this decision. Pass --by github:<login>.",
    )
  return { kind: "human", id, asserted: true }
}

function actor(session, { required = false } = {}) {
  const id = session.values.actor
  if (!id) {
    if (required)
      throw new UsageError(
        "Name who is acting with --actor agent:<name> or --actor github:<login>.",
      )
    return { kind: "system", id: "system:replica-learning-cli" }
  }
  const kind = id.startsWith("agent:")
    ? "agent"
    : /^(?:github|human):/.test(id)
      ? "human"
      : id.startsWith("system:")
        ? "system"
        : null
  if (!kind || !/^[a-z][a-z0-9-]*:\S+$/.test(id))
    throw new UsageError("--actor must look like agent:<name>, github:<login>, or system:<name>.")
  return {
    kind,
    id,
    ...(session.values.model ? { model: session.values.model } : {}),
    ...(kind === "human" ? { asserted: true } : {}),
  }
}

function single(values, label) {
  if (!values?.length) return undefined
  if (values.length > 1) throw new UsageError(`${label} takes one value here.`)
  return values[0]
}

function time(session, value, label) {
  if (value === undefined) return undefined
  try {
    return parseTimeOption(value, session.clock())
  } catch {
    throw new UsageError(`${label} must be now, 7d, 12h, 30m, or an RFC 3339 time.`)
  }
}

function positive(value, label, fallback) {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1)
    throw new UsageError(`${label} must be a positive whole number.`)
  return number
}

function argument(session, index, label) {
  const value = session.positionals[index]
  if (!value) throw new UsageError(`Missing ${label}.`)
  return value
}

async function readJsonFile(session, file) {
  const target = path.resolve(session.cwd, file)
  let bytes
  try {
    bytes = await readFile(target)
  } catch (error) {
    throw new LearningError("not_found", `Cannot read ${file} (${error.code}).`)
  }
  try {
    return parseJson(decodeUtf8(bytes, target), file)
  } catch (error) {
    throw new LearningError("invalid_input", error.message)
  }
}

/** Untrusted text, quoted so control characters and escape sequences cannot reach the terminal. */
function quoted(text, limit = 120) {
  if (text === null || text === undefined) return "(deleted)"
  return JSON.stringify(text.length > limit ? `${text.slice(0, limit - 1)}…` : text)
}

async function setup(session) {
  if (session.positionals.length !== 1)
    throw new UsageError("Use setup without additional arguments.")
  const result = await setupLocalLearning({ cwd: session.cwd, actor: session.values.actor })
  session.out(
    result,
    [
      `Local learning mode is set up in ${result.root}.`,
      ...result.steps.map((step) => `- ${step}`),
      "Next, quit Copilot CLI and start it again in that folder with:",
      `  ${result.command}`,
    ].join("\n"),
  )
}

async function status(session) {
  const { store, providerSource } = await open(session)
  const result = await store.status(context(session, actor(session)))
  const { counts } = result
  const memories = counts?.memories
  const attention = [
    ...result.attention,
    ...(result.migrationRedactionFollowUps?.memoriesNeedingRebuild ?? []).map(
      (id) => `Rebuild learning ${id} because its evidence was removed.`,
    ),
  ]
  session.out(
    result,
    [
      `Scope: ${scopeLabel(result.scope)}`,
      `Provider: ${result.provider.id} ${result.provider.version} (${providerSource})`,
      ...(counts
        ? [
            `Evidence: ${counts.episodes} episodes and ${counts.events} events from ${counts.completeCollections} complete and ${counts.incompleteCollections} incomplete collections`,
            `Grants: ${counts.activeGrants} active of ${counts.grants}`,
            `Learnings: ${memories.proposed} proposed, ${memories.accepted} accepted (${counts.recallable} recalled), ${memories.rejected} rejected, ${memories.retired} retired`,
          ]
        : []),
      ...(attention.length
        ? [
            "Needs attention:",
            ...attention.map((item) => `  - ${quoted(item, Infinity).slice(1, -1)}`),
          ]
        : ["Nothing needs attention."]),
    ].join("\n"),
  )
  return counts ? 0 : 1
}

async function doctor(session) {
  const { environment } = session
  const report = {
    cli: PRODUCER,
    root: environment.hosted ? null : environment.root,
    dataDirectory: environment.dataDirectory,
    config: { path: environment.configPath, found: environment.configFound },
    scope: environment.scope,
    scopeSource: environment.scopeSource,
    ignoredByGit: environment.insideCheckout ? environment.ignoredByGit : null,
    underReplica: environment.insideCheckout ? environment.underReplica : null,
  }
  try {
    const { provider, source } = await openProvider(environment)
    let store
    try {
      store = await createLearningStore({ provider, clock: session.clock })
    } catch (error) {
      await provider.close?.()
      throw error
    }
    session.opened.push(store)
    report.provider = {
      source,
      manifest: store.manifest,
      health: await store.health(),
    }
  } catch (error) {
    report.provider = { error: error.message }
  }
  try {
    const { consolidator, source } = await openConsolidator(environment)
    report.consolidator = { source, manifest: consolidator.manifest }
  } catch (error) {
    report.consolidator = { error: error.message }
  }
  const manifest = report.provider.manifest
  session.out(
    report,
    [
      environment.hosted
        ? "Checkout: none; the program that ran this command names the repository"
        : `Checkout: ${report.root}`,
      report.scope
        ? `Scope: ${scopeLabel(report.scope)} from ${report.scopeSource}; ${environment.hosted ? "asserted by the program that ran this command" : "a local assertion"}, not checked repository access`
        : `Scope: unknown (${report.scopeSource ? `no host and owner/name in ${report.scopeSource}` : "no origin remote"})`,
      `Data directory: ${report.dataDirectory}`,
      `Config: ${report.config.found ? report.config.path : "none; using defaults"}`,
      `Data placement: ${placementLabel(environment)}`,
      manifest
        ? `Provider: ${manifest.id} ${manifest.version} from ${report.provider.source}; storage ${manifest.storage.kind}${manifest.storage.location ? ` at ${manifest.storage.location}` : ""}; sends data to ${manifest.externalCalls.length ? manifest.externalCalls.join(", ") : "nothing outside this machine"}`
        : `Provider: unavailable: ${report.provider.error}`,
      manifest ? `Capabilities: ${manifest.capabilities.join(", ")}` : "",
      manifest
        ? `Health: ${report.provider.health.ok ? "ok" : "failing"}: ${report.provider.health.detail}`
        : "",
      report.consolidator.manifest
        ? `Consolidator: ${report.consolidator.manifest.id} ${report.consolidator.manifest.version} from ${report.consolidator.source}`
        : `Consolidator: unavailable: ${report.consolidator.error}`,
    ]
      .filter(Boolean)
      .join("\n"),
  )
  const safe =
    !environment.insideCheckout ||
    ((environment.hosted || environment.underReplica) && environment.ignoredByGit === true)
  return report.scope &&
    safe &&
    manifest &&
    report.provider.health.ok &&
    report.consolidator.manifest
    ? 0
    : 1
}

async function listGrants(session) {
  const { store } = await open(session)
  const grants = await store.listGrants(context(session, actor(session)))
  session.out(
    grants,
    grants.length
      ? grants
          .map(({ grant, activePurposes, withdrawnPurposes, expired }) =>
            [
              `${grant.id}  ${activePurposes.length ? `permits ${activePurposes.join(", ")}` : "permits nothing now"}${withdrawnPurposes.length ? `; withdrawn ${withdrawnPurposes.join(", ")}` : ""}${expired ? "; expired" : ""}`,
              `    sources ${grant.sources.join(", ")}; granted by ${grant.grantedBy.id} on ${grant.grantedAt.slice(0, 10)}`,
              `    evidence ${grant.evidenceFrom ? `from ${grant.evidenceFrom}` : "from any time"}${grant.evidenceUntil ? ` until ${grant.evidenceUntil}` : ""}${grant.expiresAt ? `; expires ${grant.expiresAt}` : ""}`,
              `    basis ${quoted(grant.basis, 200)}`,
            ].join("\n"),
          )
          .join("\n")
      : "No grants. Record one with grants add before importing evidence.",
  )
}

async function listWithdrawals(session) {
  const { store } = await open(session)
  const withdrawals = await store.listWithdrawals(context(session, actor(session)))
  session.out(withdrawals, `${withdrawals.length} grant withdrawal(s).`)
}

async function addGrant(session) {
  const { values } = session
  if (!values.purpose?.length) throw new UsageError("Name each permitted purpose with --purpose.")
  if (!values.basis) throw new UsageError("Say why this use is allowed with --basis.")
  const principal = person(session)
  const { store } = await open(session)
  const grant = await store.addGrant(context(session, principal), {
    purposes: values.purpose,
    sources: values.source?.length ? values.source : [HUB_SOURCE],
    basis: values.basis,
    expiresAt: time(session, values.expires, "--expires"),
    evidenceFrom: time(session, values["evidence-from"], "--evidence-from"),
    evidenceUntil: time(session, values["evidence-until"], "--evidence-until"),
  })
  session.out(
    grant,
    `Recorded ${grant.id}: ${grant.sources.join(", ")} may be used for ${grant.purposes.join(", ")}.`,
  )
}

async function withdrawGrant(session) {
  const grantId = argument(session, 2, "grant ID")
  if (!session.values.purpose?.length)
    throw new UsageError("Name each purpose to end with --purpose.")
  const { store } = await open(session)
  const result = await store.withdrawGrant(context(session, person(session)), grantId, {
    purposes: session.values.purpose,
    reason: session.values.reason,
  })
  session.out(
    result,
    [
      `Withdrew ${result.withdrawal.purposes.join(", ")} from ${grantId}.`,
      result.memoriesNeedingRebuild.length
        ? `No longer recalled, needs rebuilding: ${result.memoriesNeedingRebuild.join(", ")}`
        : "No accepted learning depended on it alone.",
      ...result.exportsToFollowUp.map(
        (item) =>
          `Ask the owner of export ${item.id} (${item.purpose}, ${item.destination}) to delete the covered records.`,
      ),
    ].join("\n"),
  )
}

async function importHub(session) {
  const log = await readJsonFile(session, argument(session, 2, "collection log file"))
  if (!session.values.grant?.length)
    throw new UsageError("Name the consent grant that covers these comments with --grant.")
  const { store } = await open(session)
  const result = await store.importHubReviewComments(context(session, actor(session)), log, {
    grantIds: session.values.grant,
    redactDeleted: session.values["redact-deleted"] === true,
  })
  const { collection } = result
  session.out(
    result,
    [
      `Snapshot ${collection.snapshotId}: ${collection.counts.threads} threads, ${collection.counts.messages} messages.`,
      `Added ${result.addedEpisodes} episodes and ${result.addedEvents} events.`,
      ...(result.identityUpdates?.memoryIds.length
        ? [
            `${result.identityUpdates.reason} Affected learnings: ${result.identityUpdates.memoryIds.join(", ")}.`,
          ]
        : []),
      ...(result.redacted.length
        ? [
            `Removed the text of ${result.redacted.length} event(s) for comments deleted at the source. ${OUTSIDE_THE_STORE}`,
          ]
        : []),
      ...removalFollowUps(result),
      result.complete
        ? "Collection complete."
        : [
            "Collection INCOMPLETE. Windows it does not cover will report incomplete evidence:",
            ...result.problems.map((item) => `  - ${item}`),
          ].join("\n"),
    ].join("\n"),
  )
}

async function importSession(session) {
  const input = await readJsonFile(session, argument(session, 2, "session file"))
  if (!session.values.grant?.length)
    throw new UsageError("Name the consent grant that covers agent sessions with --grant.")
  const principal = actor(session, { required: true })
  if (principal.kind !== "agent")
    throw new UsageError("Name the agent that ran the session with --actor agent:<name>.")
  const { store } = await open(session)
  const result = await store.importAgentSession(context(session, principal), input, {
    grantIds: session.values.grant,
  })
  session.out(
    result,
    [
      `Session ${result.sessionId}: added ${result.addedEpisodes} episodes and ${result.addedEvents} events.`,
      ...(result.skippedMessages
        ? [`Skipped ${result.skippedMessages} tool or empty message(s).`]
        : []),
    ].join("\n"),
  )
}

async function label(session) {
  if (!session.positionals[1]) return labelUnlabeled(session)
  if (session.values.relabel)
    throw new UsageError("--relabel applies only when asking the configured labeler.")
  if (session.values["max-requests"] !== undefined)
    throw new UsageError(
      "--max-requests applies only when asking the configured labeler, not a labels file.",
    )
  const data = await readJsonFile(session, argument(session, 1, "labels file"))
  const labels = Array.isArray(data) ? data : data?.labels
  const { store } = await open(session)
  const created = await store.annotate(context(session, actor(session, { required: true })), labels)
  session.out(
    { added: created.map((event) => event.id) },
    `Added ${created.length} label(s)${created.length < labels.length ? `; ${labels.length - created.length} were already recorded` : ""}.`,
  )
}

/**
 * Label the comments the configured labeler has not been asked about, Copilot by default, and
 * report what it cost. Labels are the labeler's judgment; only a person accepts a learning.
 */
async function labelUnlabeled(session) {
  if (session.values.actor)
    throw new UsageError("The labeler labels as itself; --actor names who wrote a labels file.")
  const maxRequests = positive(session.values["max-requests"], "--max-requests")
  const { store } = await open(session)
  const { labeler, source } = await openLabeler(session.environment, {
    env: session.env,
    model: session.values.model,
  })
  let result
  let failure
  let cleanupError
  try {
    const principal = { kind: "agent", id: `agent:${labeler.manifest.id}` }
    result = await labelComments(store, context(session, principal), {
      labeler,
      limit: positive(session.values.limit, "--limit", 400),
      maxRequests,
      since: time(session, session.values.since, "--since"),
      relabel: session.values.relabel,
    })
  } catch (error) {
    failure = error instanceof UsageError ? error : labelingError(error)
  }
  try {
    await labeler.close?.()
  } catch (error) {
    const cleanupFailure = labelingError(error)
    cleanupError = cleanupFailure.message
    failure ??= cleanupFailure
  }
  if (failure) {
    const partial =
      result ?? (failure instanceof LearningError ? failure.details.labelingResult : undefined)
    if (partial && failure instanceof LearningError) {
      const report = {
        ...partial,
        ...(cleanupError !== undefined ? { cleanupError } : {}),
      }
      failure.details = { ...failure.details, labelingResult: report }
      if (session.values.json)
        session.out({
          labeler: { ...labeler.manifest, source },
          ...report,
          error: { code: failure.code, message: failure.message },
        })
    }
    if (partial?.usageError && !session.values.json)
      session.stderr.write(`warning: ${partial.usageError}\n`)
    if (cleanupError !== undefined && (!partial || !session.values.json))
      session.stderr.write(`warning: the labeler did not close: ${cleanupError}\n`)
    throw failure
  }
  const report = { labeler: { ...labeler.manifest, source }, ...result }
  session.out(
    report,
    [
      result.considered
        ? `${labeler.manifest.name} labeled ${result.labeled} of ${result.considered} comment(s); ${result.unlabeled} did not need a design label.`
        : "No comment is waiting for a label.",
      result.remaining ? `${result.remaining} more comment(s) wait for the next run.` : "",
      result.rejected.length
        ? `Refused ${result.rejected.length} label(s) that broke the contract: ${result.rejected.map((item) => item.reason).join(" ")}`
        : "",
      result.usage.requests
        ? `Usage: ${result.usage.requests} request(s) to ${result.models.join(", ") || "Copilot"}, ${result.usage.inputTokens + result.usage.outputTokens} tokens, ${aiCredits(result.usage.nanoAiu)} AI credits as Copilot reported them.`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  )
}

/** AI credits from nano-AI units, as the Copilot SDK documents them. */
function aiCredits(nanoAiu) {
  return (nanoAiu / 1e9).toFixed(4)
}

/** Whether the configured labeler can answer, as whom, and with which models. */
async function copilotStatus(session) {
  const { labeler, source } = await openLabeler(session.environment, {
    env: session.env,
    model: session.values.model,
  })
  try {
    if (typeof labeler.status !== "function")
      throw new LearningError("unsupported", `The labeler from ${source} cannot report its status.`)
    const status = await labeler.status()
    session.out(
      { labeler: { ...labeler.manifest, source }, ...status },
      [
        `${labeler.manifest.name} answers${status.login ? ` as ${status.login}` : ""}${status.via ? ` through ${status.via} sign-in` : ""}${status.host ? ` at ${status.host}` : ""}.`,
        `Model: ${labeler.manifest.model}. ${status.models.length} model(s) available.`,
      ].join("\n"),
    )
  } finally {
    await labeler.close?.()
  }
}

async function observations(session) {
  const purpose = single(session.values.purpose, "--purpose") ?? "review"
  const { store } = await open(session)
  const result = await store.queryObservations(context(session, actor(session)), {
    purpose,
    types: session.values.type,
    eventIds: session.values.event,
  })
  const episodes = new Map(result.episodes.map((episode) => [episode.id, episode]))
  const feedback = result.events.filter((event) => FEEDBACK_TYPES.includes(event.type))
  session.out(
    result,
    [
      `Evidence permitted for ${purpose}: ${result.episodes.length} episodes, ${result.events.length} events.`,
      ...feedback.map((event) => {
        const source = episodes.get(event.episodeId).source
        const where =
          event.type === "user_message"
            ? `session ${source.sessionId} message`
            : `prototype ${source.prototypeId} Build ${source.buildNumber} comment ${event.payload.commentId}`
        return `${event.id}  ${where} by ${event.actor.id}: ${quoted(feedbackText(event))}`
      }),
    ].join("\n"),
  )
}

async function consolidate(session) {
  const { values } = session
  const from = time(session, values.from, "--from")
  if (!from) throw new UsageError("Name the window with --from, such as --from 7d.")
  const to = time(session, values.to ?? "now", "--to")
  const { store } = await open(session)
  const { consolidator, source } = await openConsolidator(session.environment)
  const result = await store.consolidate(context(session, actor(session)), {
    consolidator,
    window: { from, to },
    purpose: single(values.purpose, "--purpose") ?? "instruction",
    maxProposals: positive(values.max, "--max", 10),
    dryRun: Boolean(values["dry-run"]),
  })
  const proposals = result.proposals.map((item) =>
    values["dry-run"]
      ? `  [${item.themeKey ?? item.kind}] ${quoted(item.content)}`
      : `  ${item.id} [${item.themeKey ?? item.kind}] ${quoted(item.content)}\n    review digest ${item.reviewDigest}`,
  )
  session.out(
    result,
    [
      `Window ${from} to ${to}. Consolidator ${consolidator.manifest.id} (${source}).`,
      `Status: ${result.status}. ${result.summary}`,
      ...(proposals.length
        ? [values["dry-run"] ? "Would propose:" : "Proposed:", ...proposals]
        : []),
      ...(result.diagnostics.length
        ? [
            "Notes:",
            ...result.diagnostics.map(
              (item) => `  - ${item.themeKey ? `${item.themeKey}: ` : ""}${item.message}`,
            ),
          ]
        : []),
    ].join("\n"),
  )
}

async function memories(session) {
  const { store } = await open(session)
  const items = await store.queryMemory(context(session, actor(session)), {
    states: session.values.state,
    purpose: single(session.values.purpose, "--purpose") ?? "review",
  })
  session.out(
    items,
    items.length
      ? items
          .map(({ record, status, withheld }) =>
            [
              `${record.id ?? "(unreadable ID)"}  ${record.state ?? "?"}${status.recallEligible ? ", recalled" : ""}${status.identityNeedsReview ? ", needs identity review" : status.needsRebuild ? ", needs rebuild" : ""}${status.conflicts.length ? `, ${status.inEffect ? "a later replacement lost" : "not used"}: another replacement came first` : ""}${status.problems.length ? ", damaged; run verify" : ""}  [${record.kind ?? "?"}] ${record.themeKey ?? ""}`,
              `    ${withheld ? (status.problems.length ? "(content withheld: this learning failed its integrity checks)" : status.identityNeedsReview ? "(content withheld: reviewer identities need rebuilding and review)" : "(content withheld: its evidence is no longer permitted for review)") : quoted(record.content)}`,
              `    review digest ${record.reviewDigest ?? "?"}`,
            ].join("\n"),
          )
          .join("\n")
      : "No learnings yet.",
  )
}

async function show(session) {
  const id = argument(session, 1, "memory ID")
  const { store } = await open(session)
  const item = await store.getMemory(context(session, actor(session)), id, {
    history: Boolean(session.values.history),
    purpose: single(session.values.purpose, "--purpose") ?? "review",
  })
  const { record, status } = item
  const head = [
    `${record.id ?? id} version ${record.version ?? "?"}: ${record.state ?? "?"} ${record.kind ?? "?"}${record.themeKey ? ` (${record.themeKey})` : ""}`,
    `Review digest: ${record.reviewDigest ?? "?"}`,
    `Version digest: ${record.digest ?? "?"}`,
    `Recalled: ${status.recallEligible ? "yes" : "no"}${status.identityNeedsReview ? "; reviewer identities need rebuilding and review" : status.needsRebuild ? "; needs rebuild" : ""}${status.superseded ? "; superseded" : ""}${status.expired ? "; expired" : ""}${status.conflicts.length ? `; ${status.conflicts.join("; ")}` : ""}${status.problems.length ? `; integrity problems: ${status.problems.join("; ")}` : ""}`,
  ]
  if (item.withheld) {
    session.out(
      item,
      [
        ...head,
        status.problems.length
          ? "Content, evidence, and rationale are withheld: this learning failed its integrity checks. Run verify."
          : status.identityNeedsReview
            ? "Content, evidence, and rationale are withheld: reviewer identities need rebuilding and review."
            : "Content, evidence, and rationale are withheld: the evidence is no longer permitted for review.",
      ].join("\n"),
    )
    return
  }

  const lines = [
    ...head,
    ...(record.title ? [`Title: ${quoted(record.title, 120)}`] : []),
    `Content: ${quoted(record.content, 4000)}`,
    ...(record.support
      ? [
          `Support: ${record.support.distinctEpisodes} threads, ${record.support.distinctPrototypes} prototypes, ${record.support.distinctReviewers} reviewers, ${record.support.distinctBuilds} Builds`,
        ]
      : []),
    `Why: ${record.proposal.rationale.recurrence}`,
    ...(record.proposal.rationale.contradictions
      ? [`Disagreement: ${record.proposal.rationale.contradictions}`]
      : []),
    `Expected benefit: ${record.proposal.rationale.expectedBenefit}`,
    `How we would know it is wrong: ${record.proposal.rationale.falsification}`,
    ...(record.appliesTo?.length
      ? [`Applies to: ${record.appliesTo.map((item) => `${item.kind} ${item.ref}`).join("; ")}`]
      : []),
    ...(record.state === "proposed" && record.proposal.lifecycle.targets?.length
      ? [
          `Accepting it replaces: ${record.proposal.lifecycle.targets.join(", ")} (${record.proposal.lifecycle.action})`,
        ]
      : record.supersedes?.length
        ? [`Replaces: ${record.supersedes.join(", ")}`]
        : []),
    "Evidence:",
    ...record.evidence.map((reference) => {
      const pin = reference.source ?? {}
      const where =
        pin.sessionId === undefined
          ? `prototype ${pin.prototypeId ?? "?"} Build ${pin.buildNumber ?? "?"} comment ${pin.commentId ?? "?"}`
          : `session ${pin.sessionId}`
      return `  - ${reference.eventIds.join(", ")} in ${reference.episodeId}: ${where} by ${reference.author?.id ?? "?"}`
    }),
    ...(record.contradictions?.length
      ? [
          "Contradicting evidence:",
          ...record.contradictions.map(
            (reference) => `  - ${reference.eventIds.join(", ")} by ${reference.author?.id ?? "?"}`,
          ),
        ]
      : []),
    ...(record.accepted
      ? [
          `Accepted by ${record.accepted.by.id} at ${record.accepted.at}${record.accepted.edited ? " with edits" : ""}`,
        ]
      : []),
    ...(record.rejected
      ? [`Rejected by ${record.rejected.by.id}: ${quoted(record.rejected.reason, 400)}`]
      : []),
    ...(record.retired ? [`Retired: ${quoted(record.retired.reason, 400)}`] : []),
    ...(item.versions
      ? [
          "History:",
          ...item.versions.map(
            (version) =>
              `  v${version.version} ${version.state} at ${version.updatedAt} ${version.digest}`,
          ),
        ]
      : []),
  ]
  session.out(item, lines.join("\n"))
}

async function operationStatus(session) {
  const id = argument(session, 1, "memory ID")
  const operationId = session.values["operation-id"]
  if (!operationId) throw new UsageError("Name the host operation with --operation-id.")
  const { store } = await open(session)
  const result = await store.findMemoryOperation(context(session, actor(session)), id, operationId)
  session.out(
    result,
    result.state ? `${operationId}: ${result.state}` : `${operationId}: not found`,
  )
}

async function review(session, command) {
  const id = argument(session, 1, "memory ID")
  const digest = session.values.digest
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? ""))
    throw new UsageError("Pass the review digest you checked with --digest sha256:...")
  const principal = person(session)
  const { store } = await open(session)
  if (command === "accept") {
    let content
    if (session.values["content-file"]) {
      const bytes = await readFile(path.resolve(session.cwd, session.values["content-file"]))
      content = decodeUtf8(bytes, session.values["content-file"]).replace(/\r?\n$/, "")
    }
    const record = await store.acceptMemory(context(session, principal), id, {
      expectedDigest: digest,
      content,
      note: session.values.note,
      operationId: session.values["operation-id"],
    })
    session.out(
      record,
      `Accepted ${id}${record.accepted.edited ? " with edits" : ""}. The approval covers ${record.accepted.contentDigest}.`,
    )
    return
  }
  const reason = await reasonOf(session)
  const record = await store.rejectMemory(context(session, principal), id, {
    expectedDigest: digest,
    reason,
    operationId: session.values["operation-id"],
  })
  session.out(record, `Rejected ${id}. The reason is kept with it.`)
}

async function retire(session) {
  const id = argument(session, 1, "memory ID")
  const reason = await reasonOf(session)
  const principal = person(session)
  const { store } = await open(session)
  const record = await store.retireMemory(context(session, principal), id, {
    reason,
    operationId: session.values["operation-id"],
  })
  session.out(record, `Retired ${id}. It is no longer recalled; its history stays.`)
}

async function changeAccepted(session, command) {
  const id = argument(session, 1, "memory ID")
  const digest = session.values.digest
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? ""))
    throw new UsageError("Pass the version digest you checked with --digest sha256:...")
  const reason = await reasonOf(session)
  const principal = person(session)
  const { store } = await open(session)
  let title
  let content
  if (command === "edit" && session.values["title-file"]) {
    const file = session.values["title-file"]
    title = decodeUtf8(await readFile(path.resolve(session.cwd, file)), file).replace(/\r?\n$/, "")
  }
  if (command === "edit" && session.values["content-file"]) {
    const file = session.values["content-file"]
    content = decodeUtf8(await readFile(path.resolve(session.cwd, file)), file).replace(
      /\r?\n$/,
      "",
    )
  }
  const options = {
    expectedDigest: digest,
    reason,
    operationId: session.values["operation-id"],
  }
  const record =
    command === "edit"
      ? await store.editMemory(context(session, principal), id, { ...options, title, content })
      : await store.reinstateMemory(context(session, principal), id, options)
  session.out(record, command === "edit" ? `Edited ${id}.` : `Reinstated ${id}.`)
}

async function reasonOf(session) {
  const file = session.values["reason-file"]
  if (file !== undefined && session.values.reason !== undefined)
    throw new UsageError("Pass either --reason or --reason-file, not both.")
  if (file === undefined) {
    if (!session.values.reason) throw new UsageError("Say why with --reason or --reason-file.")
    return session.values.reason
  }
  const bytes = await readFile(path.resolve(session.cwd, file))
  const reason = decodeUtf8(bytes, file).replace(/\r?\n$/, "")
  if (!reason) throw new UsageError("The reason file is empty.")
  return reason
}

async function redact(session) {
  if (session.values.comment !== undefined) return redactHubComment(session)
  const eventId = argument(session, 1, "event ID")
  if (!session.values.reason)
    throw new UsageError("Say why the comment is being removed with --reason.")
  const principal = person(session)
  const { store } = await open(session)
  const result = await store.redactComment(context(session, principal), eventId, {
    reason: session.values.reason,
  })
  session.out(
    result,
    [
      result.redacted.length
        ? `Removed the text of ${result.redacted.length} event(s): ${result.redacted.join(", ")}\n${OUTSIDE_THE_STORE}`
        : "Nothing to remove; the comment's text was already removed.",
      ...removalFollowUps(result),
    ].join("\n"),
  )
}

/** redact --comment: the text of one Hub comment, named by its Hub ID, which needs no import. */
async function redactHubComment(session) {
  if (session.positionals.length > 1)
    throw new UsageError("Name the comment with an event ID or with --comment, not both.")
  const value = session.values.comment
  const commentId = /^[1-9][0-9]*$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(commentId))
    throw new UsageError("--comment needs a Hub comment ID, a positive whole number.")
  const principal = person(session)
  const { store } = await open(session)
  const result = await store.redactHubComment(
    context(session, principal),
    commentId,
    session.values.reason === undefined ? {} : { reason: session.values.reason },
  )
  session.out(
    { commentId, removed: result.redacted.length, ...result },
    [
      result.redacted.length
        ? `Removed the text of ${result.redacted.length} event(s) of Hub comment ${commentId}: ${result.redacted.join(", ")}\n${OUTSIDE_THE_STORE}`
        : `Nothing to remove; the store holds no text of Hub comment ${commentId}.`,
      ...removalFollowUps(result),
    ].join("\n"),
  )
}

const OUTSIDE_THE_STORE =
  "Files outside the store, such as snapshots saved for import, still hold it. Delete them."

/** What a person still has to do after a comment's text was removed from the store. */
function removalFollowUps(result) {
  return [
    ...(result.memoriesNeedingRebuild.length
      ? [`No longer recalled, needs rebuilding: ${result.memoriesNeedingRebuild.join(", ")}`]
      : []),
    ...result.exportsToFollowUp.map(
      (item) =>
        `Ask the owner of export ${item.id} (${item.purpose}, ${item.destination}) to delete the covered records.`,
    ),
  ]
}

async function supersede(session) {
  const oldIds = session.positionals.slice(1)
  if (!oldIds.length || !session.values.with)
    throw new UsageError("Use supersede <old-id>... --with <new-id>.")
  const principal = person(session)
  const { store } = await open(session)
  const record = await store.supersedeMemory(
    context(session, principal),
    oldIds,
    session.values.with,
    {
      reason: session.values.reason,
    },
  )
  session.out(record, `${session.values.with} now replaces ${oldIds.join(", ")}.`)
}

async function recall(session) {
  const task = await taskOf(session)
  const preview = session.values.preview === true
  if (preview && !session.values.by)
    throw new UsageError("Name the person who previews recall with --by github:<login>.")
  const principal = preview ? person(session) : actor(session)
  const sharedFile = session.values["shared-file"]
  const shared = sharedFile === undefined ? [] : await readJsonFile(session, sharedFile)
  const { store } = await open(session)
  const result = await store.recall(context(session, principal), {
    task,
    limit: positive(session.values.limit, "--limit", 20),
    budgetChars: positive(session.values.budget, "--budget", 6000),
    preview,
    session: sessionOption(session),
    shared,
  })
  session.out(result, result.text)
}

function sessionOption(session) {
  const { "session-id": id, "session-label": label } = session.values
  if (id === undefined) {
    if (label !== undefined) throw new UsageError("--session-label needs --session-id.")
    return undefined
  }
  return label === undefined ? { id } : { id, label }
}

/**
 * report-usage: the report file names each screenshot by a PNG file beside it, or carries
 * its base64 data, so the bytes are read here and only their digest reaches the records.
 */
async function reportUsage(session) {
  const file = argument(session, 1, "report file")
  const report = await readJsonFile(session, file)
  const directory = path.dirname(path.resolve(session.cwd, file))
  const principal = actor(session, { required: true })
  if ((session.values.grant?.length ?? 0) > 1)
    throw new UsageError("Name at most one --grant for a usage report.")
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw new LearningError("invalid_input", `${file} must be a JSON object.`)
  const used = await readReportScreenshots(directory, report.used)
  const { store } = await open(session)
  const result = await store.reportUsage(context(session, principal), {
    ...report,
    used,
    ...(session.values.grant ? { consentGrantId: session.values.grant[0] } : {}),
  })
  session.out(
    result,
    result.stored
      ? `Stored usage report ${result.reportId}.`
      : `Usage report ${result.reportId} was already stored.`,
  )
}

async function usage(session) {
  const commitSha = session.values.commit
  if (!commitSha) throw new UsageError("Name the commit with --commit <sha>.")
  const { store } = await open(session)
  const reports = await store.usageForCommit(context(session, actor(session)), { commitSha })
  session.out(
    { reports },
    reports.length
      ? reports
          .map((report) =>
            [
              `${report.reportId}  reported ${report.reportedAt}`,
              ...report.used.map(
                (item) => `    ${item.memoryId} v${item.version ?? "?"}  ${item.title ?? ""}`,
              ),
            ].join("\n"),
          )
          .join("\n")
      : "No usage reports for this commit.",
  )
}

/**
 * Score one used learning with Copilot and report what it cost. Copilot scores as itself, and
 * a failed attempt still reports the usage it spent so a host can keep to its budget.
 */
async function score(session) {
  const usedLearningId = argument(session, 1, "used learning ID")
  const operationId = session.values["operation-id"]
  if (!operationId) throw new UsageError("Name the scoring attempt with --operation-id <uuid>.")
  const diff = session.values["diff-file"]
    ? decodeUtf8(
        await readFile(path.resolve(session.cwd, session.values["diff-file"])),
        session.values["diff-file"],
      )
    : undefined
  const kept = session.values.screenshots
    ? createScreenshotStore(path.resolve(session.cwd, session.values.screenshots))
    : null
  const { store } = await open(session)
  const verifiedAt = time(session, session.values["reviewer-verified-at"], "--reviewer-verified-at")
  const evaluator = createCopilotEvaluator({ token: session.env.COPILOT_GITHUB_TOKEN || undefined })
  const result = await withCopilot(session, evaluator, (copilotContext) =>
    scoreUsedLearning(store, copilotContext, {
      evaluator,
      usedLearningId,
      operationId,
      diff,
      ...(kept ? { readScreenshot: (sha256) => kept.read(sha256) } : {}),
      ...(verifiedAt !== undefined ? { reviewerVerifiedAt: verifiedAt } : {}),
    }),
  )
  const usage = totals(result.usage)
  session.out(
    { score: result.score, stored: result.stored, route: result.route, usage },
    [
      `${result.stored ? "Scored" : "Already scored"} ${usedLearningId}: ${result.score.efficiency} of 4, ${result.score.followed.replace("_", " ")}.`,
      `Route: ${result.route.kind === "fusion" ? `Copilot Fusion ${result.route.fusionTier}` : `Auto ${result.route.model} at ${result.route.reasoningEffort ?? "default"} reasoning`}.`,
      usageLine(usage),
    ].join("\n"),
  )
}

/**
 * Suggest new wording for one accepted learning and report what it cost. Copilot drafts as
 * itself, and only when the evidence is enough, so most runs cost nothing.
 */
async function proposeUpdate(session) {
  const memoryId = argument(session, 1, "memory ID")
  const { store } = await open(session)
  const drafter = createCopilotDrafter({ token: session.env.COPILOT_GITHUB_TOKEN || undefined })
  const result = await withCopilot(session, drafter, (copilotContext) =>
    proposeUpdates(store, copilotContext, { drafter, memoryId }),
  )
  const usage = totals(result.usage)
  const ids = result.proposals.map((item) => item.id).join(", ")
  const summary = {
    insufficient_evidence: "Not enough scored uses show the same issue yet.",
    up_to_date: "No new scored uses since the last suggestion.",
    no_change: "Copilot found no wording change the evidence supports.",
    proposed: `Suggested ${result.proposals.length} update(s): ${ids}.`,
  }[result.state]
  session.out(
    { state: result.state, proposals: result.proposals, usage },
    `${summary}\n${usageLine(usage)}`,
  )
}

/**
 * Do for one checkout what Hub's learning jobs do, so no one runs each step by hand.
 * It labels new feedback, then suggests themes that recur over the last 90 days. With
 * a commit, it also scores each learning an agent used there and may suggest new
 * wording. Hub's caps keep one run's Copilot usage bounded. A failed step is reported
 * and the rest still run. Runs take turns so two never repeat the same work.
 */
async function analyze(session) {
  const commitSha = session.values.commit
  if (commitSha !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commitSha))
    throw new UsageError("Name the commit by its full SHA with --commit.")
  const failed = []
  // Each step is the command a person would run, so it keeps all the same checks.
  async function step(name, arguments_) {
    let output = ""
    const code = await main([...arguments_, ...storeArguments(session), "--json"], {
      cwd: session.cwd,
      env: session.env,
      stdin: session.stdin,
      stdout: { write: (text) => ((output += text), true) },
      stderr: session.stderr,
      clock: session.clock,
      startAnalysis: session.startAnalysis,
    })
    if (code !== 0) failed.push(name)
    try {
      return code === 0 ? JSON.parse(output) : undefined
    } catch {
      return undefined
    }
  }
  const directory = session.environment.dataDirectory
  await mkdir(directory, { recursive: true, mode: 0o700 })
  /** Labels, consolidates, and scores in one go, holding the analysis lock. */
  async function work() {
    const startedAt = timestampFromMilliseconds(session.clock())
    const labeled = await step("label", [
      "label",
      "--since",
      "90d",
      "--limit",
      "400",
      "--max-requests",
      "10",
    ])
    const consolidated = await step("consolidate", [
      "consolidate",
      "--from",
      "90d",
      "--to",
      "now",
      "--max",
      "10",
    ])
    const scored = new Set()
    const updates = []
    if (commitSha) {
      const reports = (await step("usage", ["usage", "--commit", commitSha]))?.reports ?? []
      const temporary = await mkdtemp(path.join(tmpdir(), "replica-learning-analyze-"))
      try {
        const diffFile = path.join(temporary, "commit.diff")
        const diff = await commitDiff(session.cwd, commitSha)
        if (diff) await writeFile(diffFile, diff, { mode: 0o600 })
        for (const used of reports.flatMap((report) => report.used)) {
          // The same ID for the same use, so a second run keeps the first score.
          const result = await step("score", [
            "score",
            used.id,
            "--operation-id",
            operationIdFor(`analyze-score:${used.id}`),
            ...(diff ? ["--diff-file", diffFile] : []),
          ])
          if (result?.stored) scored.add(used.memoryId)
        }
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
      for (const memoryId of scored) {
        const result = await step("propose-update", ["propose-update", memoryId])
        updates.push(...(result?.proposals ?? []))
      }
    }
    const result = {
      startedAt,
      labeled: labeled?.labeled ?? 0,
      proposals: consolidated?.changed?.length ?? 0,
      scored: scored.size,
      updates: updates.length,
      failed,
    }
    localLearning.recordActivity(directory, {
      startedAt,
      state: failed.length ? "failed" : "succeeded",
      commentsConsidered: labeled?.considered ?? 0,
      commentsLabeled: result.labeled,
      suggestions: result.proposals,
    })
    return result
  }
  const lock = createFileLock({
    path: path.join(directory, "analysis.lock"),
    timeoutMs: 60 * 60 * 1000,
  })
  // One run may wait behind the running one for each commit, or for chats alone. A
  // later request finds that run waiting and leaves the new data to it.
  const waiting = createFileLock({
    path: path.join(directory, `analysis-waiting-${commitSha ?? "chats"}.lock`),
    timeoutMs: 1000,
  })
  let running
  try {
    await waiting.run(
      () =>
        new Promise((started) => {
          running = lock.run(async () => {
            started()
            return work()
          })
          running.catch(started)
        }),
    )
  } catch (error) {
    if (running || error?.code !== "conflict") throw error
    session.out(
      { waiting: true },
      "Another analysis is waiting to run and will include this one's data.",
    )
    return 0
  }
  const summary = await running
  session.out(
    summary,
    [
      `Analysis from ${summary.startedAt}: labeled ${summary.labeled} comment(s), ${summary.proposals} suggested learning(s), scored ${summary.scored} learning(s), ${summary.updates} suggested update(s).`,
      failed.length ? `These steps failed: ${failed.join(", ")}. Their errors are above.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  )
  return failed.length ? 1 : 0
}

/** The options that point another run of this CLI at the same store. */
function storeArguments(session) {
  return ["dir", "repository"].flatMap((name) =>
    session.values[name] === undefined ? [] : [`--${name}`, session.values[name]],
  )
}

/** The commit's own changes, or null when Git cannot show them. */
async function commitDiff(cwd, commitSha) {
  try {
    const { stdout } = await promisify(execFile)(
      "git",
      ["show", "--format=", "--no-color", "--no-ext-diff", commitSha, "--"],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
    )
    return stdout || null
  } catch {
    return null
  }
}

/** The same UUID for the same name, so a retried step is not done twice. */
function operationIdFor(name) {
  const hex = createHash("sha256").update(name).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function updates(session) {
  const memoryId = argument(session, 1, "memory ID")
  const { store } = await open(session)
  const items = await store.updatesFor(context(session, actor(session)), { memoryId })
  session.out(
    { updates: items },
    items.length
      ? items
          .map(
            (item) =>
              `${item.id}  v${item.version}  ${item.state}  ` +
              (item.withheld ? "(withheld)" : quoted(item.issue, 500)),
          )
          .join("\n")
      : "No suggested updates for this learning.",
  )
}

async function applyUpdate(session) {
  const id = argument(session, 1, "proposal ID")
  const reason = await reasonOf(session)
  const principal = person(session)
  const { store } = await open(session)
  const result = await store.applyUpdate(context(session, principal), id, {
    title: await optionalFile(session, "title-file"),
    content: await optionalFile(session, "content-file"),
    reason,
    operationId: session.values["operation-id"],
  })
  session.out(
    result,
    result.stored
      ? `Applied ${id} as version ${result.update.decision.appliedVersion}.`
      : `${id} was already applied.`,
  )
}

async function dismissUpdate(session) {
  const id = argument(session, 1, "proposal ID")
  const reason = await reasonOf(session)
  const principal = person(session)
  const { store } = await open(session)
  const result = await store.dismissUpdate(context(session, principal), id, {
    reason,
    operationId: session.values["operation-id"],
  })
  session.out(result, result.stored ? `Dismissed ${id}.` : `${id} was already dismissed.`)
}

/** A file's text without its final line break, or undefined when the option is absent. */
async function optionalFile(session, option) {
  const file = session.values[option]
  if (file === undefined) return undefined
  return decodeUtf8(await readFile(path.resolve(session.cwd, file)), file).replace(/\r?\n$/, "")
}

/**
 * Runs one step as Copilot and always closes its client. A failed step still reports what
 * it spent, so a host can keep to its budget.
 */
async function withCopilot(session, client, run) {
  try {
    return await run(context(session, { kind: "agent", id: "agent:copilot" }))
  } catch (error) {
    if (session.values.json && error instanceof LearningError)
      session.out({
        usage: totals(error.details?.usage ?? []),
        error: { code: error.code, message: error.message },
      })
    throw error
  } finally {
    await client.close().catch(() => {})
  }
}

function usageLine(usage) {
  return `Usage: ${usage.requests} request(s), ${aiCredits(usage.nanoAiu)} AI credits as Copilot reported them.`
}

/** One model call list as totals a host can add to its monthly budget. */
function totals(calls) {
  return {
    requests: calls.length,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    nanoAiu: calls.reduce((sum, call) => sum + call.nanoAiu, 0),
  }
}

async function outcomes(session) {
  const memoryId = argument(session, 1, "memory ID")
  const { store } = await open(session)
  const items = await store.outcomesFor(context(session, actor(session)), { memoryId })
  session.out(
    { outcomes: items },
    items.length
      ? items
          .map(
            (item) =>
              `${item.scoredAt}  v${item.version}  ${item.commitSha.slice(0, 12)}  efficiency ${item.efficiency}, ${item.followed.replace("_", " ")}`,
          )
          .join("\n")
      : "No scored uses of this learning yet.",
  )
}

/**
 * Swap each screenshot's file or base64 data for its bytes. The store checks these limits
 * too, but only after every file is in memory, so the count and total size are checked here
 * first and files are read one at a time.
 */
async function readReportScreenshots(directory, items) {
  if (!Array.isArray(items)) return items
  if (items.length > 1000)
    throw new LearningError("invalid_input", "used lists at most 1000 delivered learnings.")
  const used = []
  let total = 0
  for (const item of items) {
    if (!item || typeof item !== "object") {
      used.push(item)
      continue
    }
    const copy = { ...item }
    for (const role of ["before", "after"])
      if (copy[role]?.data !== undefined) {
        copy[role] = screenshotData(copy[role], MAX_REPORT_SCREENSHOT_BYTES - total)
        total += copy[role].bytes.length
      } else if (copy[role]?.file !== undefined) {
        copy[role] = await screenshotFile(
          directory,
          copy[role],
          MAX_REPORT_SCREENSHOT_BYTES - total,
        )
        total += copy[role].bytes.length
      }
    used.push(copy)
  }
  return used
}

function screenshotData({ data, file, ...rest }, remaining) {
  if (file !== undefined)
    throw new LearningError("invalid_input", "A screenshot names a file or carries data, not both.")
  // Strict base64, so a typo is refused instead of silently decoding to other bytes.
  if (
    typeof data !== "string" ||
    !data ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new LearningError("invalid_input", "A screenshot's data must be base64 PNG bytes.")
  if (Math.floor((data.length * 3) / 4) > MAX_SCREENSHOT_BYTES + 2)
    throw new LearningError("invalid_input", "A screenshot can be at most 10 MB.")
  const bytes = Buffer.from(data, "base64")
  if (bytes.length > remaining)
    throw new LearningError("invalid_input", "A report's screenshots can total at most 100 MB.")
  return { ...rest, bytes }
}

async function screenshotFile(directory, { file, ...rest }, remaining) {
  if (typeof file !== "string" || !file)
    throw new LearningError("invalid_input", "A screenshot names its PNG file.")
  // An agent writes the report, so a screenshot path must not reach other files on disk.
  // Node cannot open a file relative to a held folder, so a process that renames
  // folders under the report while this runs could still redirect the read. That
  // process already has the same access, so the checks stop wrong or crafted
  // paths, not such a process.
  if (path.isAbsolute(file))
    throw new LearningError(
      "invalid_input",
      `${file} must be a path inside the report's directory.`,
    )
  let handle
  try {
    const home = await realpath(directory)
    const parent = await realpath(path.dirname(path.resolve(home, file)))
    const inside = path.relative(home, parent)
    if (inside.startsWith("..") || path.isAbsolute(inside))
      throw new LearningError(
        "invalid_input",
        `${file} must be a path inside the report's directory.`,
      )
    // Checking the open handle, not the path, means a file swapped in after the check
    // cannot be read in its place.
    handle = await openFile(path.join(parent, path.basename(file)), constants.O_RDONLY | NO_FOLLOW)
  } catch (error) {
    if (error instanceof LearningError) throw error
    if (error.code === "ELOOP")
      throw new LearningError("invalid_input", `${file} must be a regular file.`)
    throw new LearningError("not_found", `Cannot read ${file} (${error.code}).`)
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new LearningError("invalid_input", `${file} must be a regular file.`)
    // A hard link can give a file outside the directory a second name inside it.
    if (info.nlink > 1)
      throw new LearningError("invalid_input", `${file} must not be a hard link to another file.`)
    if (info.size > MAX_SCREENSHOT_BYTES)
      throw new LearningError("invalid_input", `${file} is larger than 10 MB.`)
    if (info.size > remaining)
      throw new LearningError("invalid_input", "A report's screenshots can total at most 100 MB.")
    return { ...rest, bytes: await handle.readFile() }
  } finally {
    await handle.close()
  }
}

/**
 * mcp: serves the shared learning tools over standard input and output until the client
 * hangs up. Each call opens the store and closes it again, like a separate command, so
 * nothing stays locked between calls.
 */
async function serveMcp(session) {
  if (session.positionals.length !== 1) throw new UsageError("Use mcp without arguments.")
  const principal =
    session.values.actor === undefined ? { kind: "agent", id: "agent:mcp" } : actor(session)
  if (principal.kind !== "agent") throw new UsageError("Name the agent with --actor agent:<name>.")
  let mcp
  let stdio
  try {
    mcp = await import("./mcp.mjs")
    stdio = await import("@modelcontextprotocol/sdk/server/stdio.js")
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND")
      throw new LearningError(
        "unsupported",
        "The MCP server needs @modelcontextprotocol/sdk. Run npm ci in packages/learning.",
      )
    throw error
  }
  async function withStore(call) {
    const { store } = await open(session)
    try {
      return await call(store, context(session, principal))
    } finally {
      session.opened.splice(session.opened.indexOf(store), 1)
      await store.close()
    }
  }
  // Without --grant, any consent a person recorded in this store counts, so the server
  // works without anyone naming grant IDs.
  function startedWith(grant) {
    return !session.values.grant?.length || session.values.grant.includes(grant.id)
  }
  // Of the grants this server may use, the one that allows screenshots now.
  async function screenshotGrantId(store, ctx) {
    return (await store.listGrants(ctx)).find(
      ({ grant, activePurposes }) =>
        startedWith(grant) &&
        grant.sources.includes("agent_screenshots") &&
        activePurposes.includes("evaluation"),
    )?.grant.id
  }
  async function sessionGrants(store, ctx) {
    return (await store.listGrants(ctx)).filter(
      ({ grant, activePurposes }) =>
        startedWith(grant) &&
        grant.sources.includes("agent_session") &&
        activePurposes.includes("review"),
    )
  }
  // A checkout without a GitHub repository is named by its folder in forms.
  const checkout = session.environment.checkout
  const repositoryName =
    session.environment.sourceRepository ?? (checkout ? path.basename(checkout) : "this repository")
  function canAskPerson() {
    return Boolean(server.server.getClientCapabilities()?.elicitation)
  }
  function askPerson(params) {
    return server.server.elicitInput(params, { timeout: localLearning.FORM_TIMEOUT_MS })
  }
  // The login a form suggests: whoever agreed to learning here, or the GitHub CLI's.
  async function suggestedLogin() {
    const agreed = await withStore(async (store, ctx) =>
      (await sessionGrants(store, ctx)).map(({ grant }) => grant.grantedBy.id).at(-1),
    )
    return agreed?.replace(/^github:/, "") ?? (await localLearning.signedInLogin(session.env))
  }
  /** Asks the person to agree to learning from chats, and records their consent. */
  async function askToLearn() {
    if (!canAskPerson()) return []
    const answer = await localLearning.askConsent(askPerson, {
      repository: repositoryName,
      login: await localLearning.signedInLogin(session.env),
    })
    if (!answer) return []
    return withStore(async (store) => {
      const ctx = context(session, { kind: "human", id: `github:${answer.login}`, asserted: true })
      const grant = await store.addGrant(ctx, {
        purposes: ["review", "instruction", "evaluation"],
        sources: ["agent_session"],
        basis: "Agreed in Copilot to learn from chats in this repository.",
      })
      if (answer.screenshots)
        await store.addGrant(ctx, {
          purposes: ["evaluation"],
          sources: ["agent_screenshots"],
          basis: "Agreed in Copilot to let Copilot see screenshots when it scores a learning.",
        })
      return [grant.id]
    })
  }
  // The person answers once per server, even when calls overlap, so a declined form
  // doesn't come back after every request. A failed form can be shown again.
  let consent
  function agreeToLearn() {
    consent ??= askToLearn().catch((error) => {
      consent = undefined
      throw error
    })
    return consent
  }
  /** What a person has yet to decide: suggested learnings and suggested new wording. */
  async function waitingForReview(store) {
    const ctx = context(session, { kind: "system", id: "system:replica-learning-mcp" })
    const items = await store.queryMemory(ctx, { purpose: "review" })
    const usable = items.filter(
      ({ withheld, status }) => !withheld && !status.problems.length && !status.identityNeedsReview,
    )
    const updates = []
    for (const { record } of usable.filter(({ record }) => record.state === "accepted"))
      for (const update of await store.updatesFor(ctx, { memoryId: record.id }))
        if (update.state === "open" && !update.withheld)
          updates.push({ ...update, current: { title: record.title, content: record.content } })
    return {
      proposals: usable
        .filter(({ record }) => record.state === "proposed")
        .map(({ record }) => record),
      updates,
    }
  }
  // Commits whose analysis this server started. A retried report for one of them
  // needs no second run, but a report this server never analyzed does.
  const analyzedCommits = new Set()
  /** Starts the labeling, consolidating, and scoring a person would otherwise run. */
  function analyzeLater(commitSha) {
    if (session.values.manual || analyzedCommits.has(commitSha)) return
    try {
      session.startAnalysis({
        cwd: session.cwd,
        env: session.env,
        dataDirectory: session.environment.dataDirectory,
        args: [...storeArguments(session), ...(commitSha ? ["--commit", commitSha] : [])],
      })
      if (commitSha) analyzedCommits.add(commitSha)
    } catch (error) {
      session.stderr.write(`replica-learning mcp: analysis did not start: ${error.message}\n`)
    }
  }
  const server = mcp.createLearningMcpServer(
    {
      getGuidance: ({ task, limit, session: agentSession }) =>
        withStore(async (store, ctx) => {
          const result = await store.recall(ctx, {
            task,
            limit: limit ?? 20,
            budgetChars: 6000,
            session: agentSession,
          })
          // Only the framed text was recorded as delivered, so raw learnings stay out.
          return {
            guidanceId: result.guidanceId,
            text: result.text,
            learnings: result.memories.map(({ id, deliveryId }) => ({ id, deliveryId })),
            screenshotsAllowed: Boolean(await screenshotGrantId(store, ctx)),
            // A count only, so the agent can offer a review without seeing what waits.
            waitingForReview: Object.values(await waitingForReview(store)).flat().length,
          }
        }),
      reportUsage: async (report) => {
        const hasShots = report.used?.some?.((item) => item?.before || item?.after)
        const screenshotGrant = hasShots
          ? await withStore((store, ctx) => screenshotGrantId(store, ctx))
          : undefined
        // Screenshots are kept only while someone allows Copilot to see them.
        if (hasShots && !screenshotGrant)
          throw new LearningError(
            "grant_inactive",
            "No one has agreed to let Copilot see screenshots here. Send the report without them.",
          )
        const used = await readReportScreenshots(session.cwd, report.used)
        const result = await withStore((store, ctx) =>
          store.reportUsage(ctx, {
            ...report,
            used,
            ...(screenshotGrant ? { consentGrantId: screenshotGrant } : {}),
          }),
        )
        analyzeLater(report.commitSha)
        return result
      },
      submitSession: async (input) => {
        // An explicit --grant list may also name screenshot grants, which don't cover
        // chats, so only its session grants go to the import.
        let grantIds = (await withStore((store, ctx) => sessionGrants(store, ctx))).map(
          ({ grant }) => grant.id,
        )
        if (!grantIds.length && !session.values.grant?.length) grantIds = await agreeToLearn()
        if (!grantIds.length)
          throw new LearningError(
            "grant_inactive",
            consent && canAskPerson()
              ? "The person didn't agree to learn from chats in this session. They can run replica-learning grants add, or start a new session to be asked again."
              : "No one has agreed to learn from sessions here. Ask the person to agree in the form this tool shows, or to start the server with --grant.",
          )
        const result = await withStore((store, ctx) =>
          store.importAgentSession(ctx, input, { grantIds }),
        )
        const waitingCount = await withStore(
          async (store) => Object.values(await waitingForReview(store)).flat().length,
        )
        // A resubmitted conversation with nothing new has nothing new to learn from.
        if (result.addedEpisodes || result.addedEvents) analyzeLater()
        return { ...result, waitingForReview: waitingCount }
      },
      // Agents read with the instruction purpose, so they see only what recall gives.
      listLearnings: ({ state }) =>
        withStore((store, ctx) =>
          store.queryMemory(ctx, { states: state, purpose: "instruction" }),
        ),
      getLearning: ({ id }) =>
        withStore(async (store, ctx) => {
          const item = await store.getMemory(ctx, id, { purpose: "instruction" })
          const { record } = item
          // Just what list_learnings gives, so evidence and history stay with people.
          if (record.state === "accepted" && !item.withheld && item.status.recallEligible)
            return {
              id: record.id,
              state: record.state,
              kind: record.kind,
              title: record.title,
              content: record.content,
              recalled: true,
            }
          // A learning no one accepted is not guidance, so its text stays with people.
          const summary = { id: record.id, state: record.state, withheld: true }
          if (record.state !== "proposed") return summary
          // There is no sign-in here, so a person runs the decision themselves.
          const command = decisionCommandPrefix(session)
          return {
            ...summary,
            decide: {
              note: canAskPerson()
                ? "Only a person can decide. Call review_learnings so they can decide in a form, or ask them to run one of these with their GitHub login."
                : "Only a person can decide. Ask them to run one of these with their GitHub login.",
              accept: `${command} accept ${record.id} --digest ${record.reviewDigest} --by github:<login>`,
              reject: `${command} reject ${record.id} --digest ${record.reviewDigest} --by github:<login> --reason <text>`,
            },
          }
        }),
      reviewLearnings: async () => {
        if (!canAskPerson())
          throw new LearningError(
            "unsupported",
            "This client cannot show the person a form. get_learning gives the commands they can run instead.",
          )
        const waiting = await withStore((store) => waitingForReview(store))
        const digests = new Map(waiting.proposals.map((record) => [record.id, record.reviewDigest]))
        const counts = await localLearning.reviewWithPerson(askPerson, {
          repository: repositoryName,
          login: await suggestedLogin(),
          ...waiting,
          decide: ({ kind, id, login, content, reason }) =>
            withStore(async (store) => {
              const ctx = context(session, { kind: "human", id: `github:${login}`, asserted: true })
              // The digest is what the person saw, so a later change is refused.
              const expectedDigest = digests.get(id)
              if (kind === "accept") await store.acceptMemory(ctx, id, { expectedDigest, content })
              if (kind === "reject") await store.rejectMemory(ctx, id, { expectedDigest, reason })
              if (kind === "apply")
                await store.applyUpdate(ctx, id, { reason, operationId: randomUUID() })
              if (kind === "dismiss")
                await store.dismissUpdate(ctx, id, { reason, operationId: randomUUID() })
            }),
        })
        const left = await withStore((store) => waitingForReview(store))
        return { ...counts, waitingForReview: Object.values(left).flat().length }
      },
    },
    {
      submitEachRequest: true,
      onError: (error) =>
        session.stderr.write(`replica-learning mcp: ${error?.stack ?? String(error)}\n`),
    },
  )
  const transport = new stdio.StdioServerTransport(session.stdin, session.stdout)
  const closed = new Promise((resolve) => {
    server.server.onclose = resolve
  })
  await server.connect(transport)
  function hangUp() {
    server.close()
  }
  session.stdin.once("end", hangUp)
  session.stdin.once("close", hangUp)
  await closed
}

/** The start of a decision command that opens the same store this server opened. */
function decisionCommandPrefix(session) {
  const script = fileURLToPath(new URL("../bin/replica-learning.mjs", import.meta.url))
  const parts = ["cd", shellQuote(session.cwd), "&&", "node", shellQuote(script)]
  for (const name of ["dir", "repository", "legacy-repository"])
    if (session.values[name] !== undefined)
      parts.push(`--${name}`, shellQuote(session.values[name]))
  return parts.join(" ")
}

function shellQuote(value) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

async function deleteMemory(session) {
  const id = argument(session, 1, "memory ID")
  const reason = await reasonOf(session)
  const principal = person(session)
  const { store } = await open(session)
  const result = await store.deleteMemory(context(session, principal), id, { reason })
  session.out(result, `Deleted ${id} and ${deletedCount(result)} related record(s).`)
}

async function expireGuidance(session) {
  const principal = person(session)
  const days = positive(session.values.days, "--days", 365)
  const { store } = await open(session)
  const result = await store.expireGuidance(context(session, principal), { days })
  session.out(result, `Removed ${deletedCount(result)} recall record(s) older than ${days} days.`)
}

async function deleteRepository(session) {
  const principal = person(session)
  const { environment } = session
  const { store } = await open(session)
  // Naming the repository again guards against deleting the wrong store by accident. A
  // GitHub scope is a numeric ID, so its owner/name is accepted too.
  const names = [environment.scope.repository, environment.legacyScope?.repository].filter(Boolean)
  const { confirm } = session.values
  if (typeof confirm !== "string" || !confirm || !names.includes(confirm))
    throw new UsageError(
      `Confirm with --confirm ${names.at(-1) ?? names[0]} to delete this repository's records.`,
    )
  const result = await store.deleteRepository(context(session, principal))
  session.out(
    result,
    `Deleted ${deletedCount(result)} record(s) and ${result.memories} learning version(s).\n${OUTSIDE_THE_STORE}`,
  )
}

function deletedCount(result) {
  return Object.values(result.records).reduce((sum, count) => sum + count, 0)
}

// The most task text recall reads from a file or standard input.
const TASK_BYTES = 64 * 1024

/**
 * The task from --task, or from the file --task-file names, where - is standard input. A host
 * passes a person's prompt on standard input so it never shows in the process list.
 */
async function taskOf(session) {
  const file = session.values["task-file"]
  if (file === undefined) return session.values.task
  if (session.values.task !== undefined)
    throw new UsageError("Give the task with --task or --task-file, not both.")
  const label = file === "-" ? "standard input" : file
  const chunks = []
  let size = 0
  try {
    const stream = file === "-" ? session.stdin : createReadStream(path.resolve(session.cwd, file))
    for await (const chunk of stream) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk
      size += bytes.length
      if (size > TASK_BYTES)
        throw new UsageError(`The task on ${label} is longer than ${TASK_BYTES} bytes.`)
      chunks.push(bytes)
    }
  } catch (error) {
    if (error instanceof UsageError) throw error
    throw new LearningError("not_found", `Cannot read ${label} (${error.code ?? error.message}).`)
  }
  try {
    return decodeUtf8(Buffer.concat(chunks), label)
  } catch (error) {
    throw new LearningError("invalid_input", error.message)
  }
}

async function exportRecords(session) {
  const purpose = single(session.values.purpose, "--purpose")
  if (!purpose) throw new UsageError("Name the purpose of the export with --purpose.")
  const principal = person(session)
  const stamp = new Date(session.clock()).toISOString().replace(/[:.]/g, "-")
  const requestedDestination = session.values.out
    ? path.resolve(session.cwd, session.values.out)
    : path.join(session.environment.dataDirectory, "exports", `${stamp}-${purpose}.json`)
  const destination = await realLocation(requestedDestination)
  if (existsSync(destination))
    throw new LearningError("invalid_input", `${destination} already exists. Choose another --out.`)
  const problem = await placementProblem(session.environment, await realLocation(destination), {
    what: "exports",
    directory: false,
  })
  if (problem) throw new LearningError("invalid_input", problem)
  const { store } = await open(session)
  const { manifest, bundle } = await store.exportRecords(context(session, principal), {
    purpose,
    destination,
    contents: session.values["learnings-only"] ? "learnings" : "all",
    preview: session.values.preview === true,
  })
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await writeFile(destination, `${JSON.stringify(bundle, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  })
  const { counts } = manifest
  session.out(
    manifest,
    [
      `Exported for ${purpose} to ${destination} (${manifest.id}).`,
      `Included ${counts.collections ?? 0} collections, ${counts.episodes} episodes, ${counts.events} events, ${counts.memories} learnings, ${counts.grants} grants.`,
      ...(manifest.excluded.length
        ? [
            `Held back: ${manifest.excluded.map((item) => `${item.count} ${item.reason}`).join(", ")}.`,
          ]
        : []),
    ].join("\n"),
  )
}

async function verify(session) {
  const { store } = await open(session)
  const result = await store.verify(context(session, actor(session)))
  session.out(
    result,
    result.ok
      ? "Every record verifies."
      : ["Problems:", ...result.problems.map((item) => `  - ${item}`)].join("\n"),
  )
  return result.ok ? 0 : 1
}

const COMMERCIAL_USE = {
  allowed: "commercial use allowed",
  limited: "commercial use limited, read the license",
  terms: "commercial use under the maker's terms",
}

function decisionModels(session) {
  const { checkedAt, models } = decisionModelCatalog
  session.out(
    decisionModelCatalog,
    [
      `Base models for checking screenshots, as checked on ${checkedAt}:`,
      ...models.map(
        (model) =>
          `  ${model.id}\n    ${model.maker}, ${model.parameters} parameters, ${model.readout === "decision" ? "answers typed questions directly" : "learns a decision readout in training"}. ${model.license.name}, ${COMMERCIAL_USE[model.license.commercialUse]}.`,
      ),
    ].join("\n"),
  )
}

// Recall's character budget limits what an agent reads. Questions take every learning they ask
// about, up to --limit, so this budget never drops one.
const QUESTION_BUDGET = 1_000_000

async function decisionQuestions(session) {
  const preview = session.values.preview === true
  if (!session.values.by)
    throw new UsageError("Name the person who reads the questions with --by github:<login>.")
  // Tasksets ask about up to MAX_QUESTION_LEARNINGS learnings, so the default shows them all.
  const limit = positive(session.values.limit, "--limit", MAX_QUESTION_LEARNINGS)
  if (limit > MAX_QUESTION_LEARNINGS)
    throw new UsageError(`--limit must be at most ${MAX_QUESTION_LEARNINGS}.`)
  const principal = person(session)
  const { store } = await open(session)
  const { memories } = await store.recall(context(session, principal), {
    limit,
    budgetChars: QUESTION_BUDGET,
    preview,
  })
  const grants = await store.listGrants(context(session, principal))
  const result = {
    ...brandCheckQuestions(memories),
    // Tasks come only from Hub review comments, so only a grant that covers them counts.
    trainingConsent: grants.some(
      ({ grant, activePurposes }) =>
        activePurposes.includes("training") && grant.sources.includes(HUB_SOURCE),
    ),
  }
  const consent = result.trainingConsent
    ? "Training consent: recorded for Hub review comments."
    : "Training consent: not recorded for Hub review comments. Record a grant for training before exporting tasks."
  session.out(
    result,
    result.rules.length
      ? [
          `Questions about each candidate page, from ${result.rules.length} accepted ${result.rules.length === 1 ? "learning" : "learnings"}:`,
          ...Object.entries(result.questions).map(
            ([key, question]) =>
              `  ${key} (${question.type}): ${quoted(
                question.learning_text
                  ? `${question.instructions} ${question.learning_text}`
                  : question.instructions,
                160,
              )}`,
          ),
          consent,
        ].join("\n")
      : `No accepted learnings apply yet, so there are no questions.\n${consent}`,
  )
}

async function decisionTaskset(session) {
  const { values } = session
  if (!values.export || !values.builds || !values.out)
    throw new UsageError(
      "Name the training export with --export, the Builds file with --builds, and a new directory with --out.",
    )
  const plan = planDecisionTasks(
    await readJsonFile(session, values.export),
    await readJsonFile(session, values.builds),
  )
  const directory = await realLocation(path.resolve(session.cwd, values.out))
  const problem = await placementProblem(session.environment, directory, {
    what: "tasksets",
  })
  if (problem) throw new LearningError("invalid_input", problem)
  const manifest = await writeDecisionTaskset(plan, {
    directory,
    baseDirectory: path.dirname(path.resolve(session.cwd, values.builds)),
    brandSheet: values["brand-sheet"] && path.resolve(session.cwd, values["brand-sheet"]),
    createdAt: values["created-at"]
      ? parseTimeOption(values["created-at"], session.clock())
      : timestampFromMilliseconds(session.clock()),
  })
  const { counts } = manifest
  session.out(
    { directory, ...manifest },
    [
      `Wrote ${counts.tasks} tasks to ${directory}: ${counts.train} train, ${counts.dev} dev, ${counts.test} test.`,
      `Labels: ${counts.breaks} breaks, ${counts.follows} follows, across ${manifest.learnings} learnings.`,
      ...(Object.keys(manifest.skipped).length
        ? [
            `Skipped: ${Object.entries(manifest.skipped)
              .map(([reason, count]) => `${count} ${reason}`)
              .join(", ")}.`,
          ]
        : []),
      `The taskset copies data from export ${manifest.exportId}. Delete it whenever copies of that export must be deleted.`,
    ].join("\n"),
  )
}
