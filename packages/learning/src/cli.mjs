import { createReadStream, existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { decodeUtf8, parseJson } from "./canonical-json.mjs"
import { LearningError } from "./errors.mjs"
import {
  openConsolidator,
  openLabeler,
  openLearningStore,
  openProvider,
  placementProblem,
  realLocation,
  resolveEnvironment,
} from "./config.mjs"
import { labelComments, labelingError } from "./labeling.mjs"
import { PRODUCER } from "./records.mjs"
import { HUB_SOURCE } from "./sources/hub-review-comments.mjs"
import { createLearningStore } from "./store.mjs"
import { parseTimeOption, timestampFromMilliseconds } from "./time.mjs"
import { askChatModel, askDecisionModel, decisionRequest } from "./decision/ask.mjs"
import decisionModelCatalog from "./decision/models.json" with { type: "json" }
import { MAX_QUESTION_LEARNINGS, brandCheckQuestions } from "./decision/questions.mjs"
import { planDecisionTasks } from "./decision/tasks.mjs"
import { writeDecisionTaskset } from "./decision/taskset.mjs"

const USAGE = `replica-learning: capture review evidence, propose learnings, and recall the accepted ones.

Usage: replica-learning <command> [options]

Inspect
  status                          Counts and anything that needs attention
  doctor                          Which provider, consolidator, scope, and directory are in use, and why
  observations [--purpose <p>] [--event <id>]...
                                  Evidence a purpose may use now; select up to
                                  100 event IDs and only their containing episodes
  memories [--state <s>]...       Learnings with their state and whether they are recalled
  show <memory-id> [--history]    One learning, its evidence, and its digests
  verify                          Re-check every record's schema, digest, and history
  copilot status                  Whether Copilot answers here, as whom, and with which models

Consent (a person decides; --by github:<login>)
  grants list
  grants add --purpose <p>... --basis <text> --by <id> [--source <s>]... [--expires <time>]
             [--evidence-from <time>] [--evidence-until <time>]
  grants withdraw <grant-id> --purpose <p>... --by <id> [--reason <text>]
  redact <event-id> --by <id> --reason <text>
                                  Remove a comment's text: every version and its labels
  redact --comment <hub-comment-id> --by <id> [--reason <text>]
                                  The same, for a Hub comment named by its Hub ID; it
                                  imports nothing and needs no active grant

Capture and propose
  import hub-comments <log.json> --grant <grant-id>... [--actor <id>] [--redact-deleted]
                                  --redact-deleted also removes the text of deleted comments
  label [--limit <n>] [--max-requests <n>] [--since <time>] [--model <model>]
                                  With Copilot, or the configured labeler, label the
                                  comments it has not been asked about and report its
                                  usage; --since skips comments written before that time,
                                  and --max-requests stops after that many requests
  label <labels.json> --actor <agent:name> [--model <model>]
                                  Record labels someone else wrote
  consolidate --from <time> --to <time> [--max <n>] [--dry-run] [--actor <id>]
                                  --max caps the new or changed proposals a run
                                  stores (default 10); unchanged ones do not count

Review (a person decides; --by github:<login>)
  accept <memory-id> --digest <sha256:...> --by <id> [--content-file <file>] [--note <text>]
  reject <memory-id> --digest <sha256:...> --by <id> --reason <text>
  retire <memory-id> --by <id> --reason <text>
  supersede <old-id>... --with <new-id> --by <id> [--reason <text>]
                                  Only for a learning that recall uses and that
                                  replaces nothing yet

Use
  recall [--task <text> | --task-file <file>] [--limit <n>] [--budget <chars>]
         [--preview --by <id>]
                                  --task-file - reads the task from standard input;
                                  --preview shows a person what an agent would get,
                                  unaudited
  export --purpose <p> --by <id> [--out <file>] [--learnings-only]

Decision model
  decision models                 Base models suggested for checking screenshots
  decision questions [--limit <n>] [--preview --by <id>]
                                  The typed questions a decision model answers about a
                                  page: one yes-or-no question per accepted learning
  decision taskset --export <file> --builds <file> --out <dir> [--brand-sheet <image>]
                                  Labeled tasks for a reinforcement learning environment,
                                  from a training export and the Builds' screenshots
  decision ask --endpoint <url> --questions <file> --screenshots <dir> [--route <path>]
               [--brand-sheet <image>] [--model <deployment>]
                                  Ask a deployed decision model how likely a Build's page
                                  follows each learning. --model asks a chat-completions
                                  deployment instead, such as Foundry managed compute. The
                                  key or token comes from REPLICA_DECISION_KEY

Options: --dir <path> data directory (default .replica/learning), --json machine output.
A host that keeps stores outside checkouts, such as Hub, names the repository with
--repository <host/owner/name> and its store with --dir.
Times: now, 7d, 12h, 30m, or an RFC 3339 time. Purposes: review, instruction, evaluation,
analytics, training, publication.
`

const OPTIONS = {
  dir: { type: "string" },
  repository: { type: "string" },
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
  note: { type: "string" },
  with: { type: "string" },
  task: { type: "string" },
  "task-file": { type: "string" },
  limit: { type: "string" },
  "max-requests": { type: "string" },
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
  endpoint: { type: "string" },
  questions: { type: "string" },
  screenshots: { type: "string" },
  route: { type: "string" },
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
    const environment = await resolveEnvironment({
      cwd,
      env,
      directory: values.dir,
      repository: values.repository,
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
      stderr,
      opened,
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
    case "grants":
      if (sub === "list") return listGrants(session)
      if (sub === "add") return addGrant(session)
      if (sub === "withdraw") return withdrawGrant(session)
      throw new UsageError("Use grants list, grants add, or grants withdraw.")
    case "import":
      if (sub === "hub-comments") return importHub(session)
      throw new UsageError("Use import hub-comments <log.json>.")
    case "label":
      return label(session)
    case "copilot":
      if (sub === "status") return copilotStatus(session)
      throw new UsageError("Use copilot status.")
    case "observations":
      return observations(session)
    case "consolidate":
      return consolidate(session)
    case "memories":
      return memories(session)
    case "show":
      return show(session)
    case "accept":
    case "reject":
      return review(session, command)
    case "retire":
      return retire(session)
    case "supersede":
      return supersede(session)
    case "redact":
      return redact(session)
    case "recall":
      return recall(session)
    case "export":
      return exportRecords(session)
    case "verify":
      return verify(session)
    case "decision":
      if (sub === "models") return decisionModels(session)
      if (sub === "questions") return decisionQuestions(session)
      if (sub === "taskset") return decisionTaskset(session)
      if (sub === "ask") return decisionAsk(session)
      throw new UsageError(
        "Use decision models, decision questions, decision taskset, or decision ask.",
      )
    default:
      throw new UsageError(`Unknown command: ${command}`)
  }
}

async function open(session) {
  const opened = await openLearningStore(session.environment, {
    clock: session.clock,
  })
  session.opened.push(opened.store)
  return opened
}

function context(session, principal) {
  return { scope: session.environment.scope, principal }
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

/** A scope the way the CLI shows it: host/owner/name. */
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

async function status(session) {
  const { store, providerSource } = await open(session)
  const result = await store.status(context(session, actor(session)))
  const { counts } = result
  const memories = counts?.memories
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
      ...(result.attention.length
        ? ["Needs attention:", ...result.attention.map((item) => `  - ${item}`)]
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

async function label(session) {
  if (!session.positionals[1]) return labelUnlabeled(session)
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
  const comments = result.events.filter((event) => event.type === "human_comment")
  session.out(
    result,
    [
      `Evidence permitted for ${purpose}: ${result.episodes.length} episodes, ${result.events.length} events.`,
      ...comments.map((event) => {
        const source = episodes.get(event.episodeId).source
        return `${event.id}  prototype ${source.prototypeId} Build ${source.buildNumber} comment ${event.payload.commentId} by ${event.actor.id}: ${quoted(event.payload.body)}`
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
  })
  const { record, status } = item
  const head = [
    `${record.id ?? id} version ${record.version ?? "?"}: ${record.state ?? "?"} ${record.kind ?? "?"}${record.themeKey ? ` (${record.themeKey})` : ""}`,
    `Review digest: ${record.reviewDigest ?? "?"}`,
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
      return `  - ${reference.eventIds.join(", ")} in ${reference.episodeId}: prototype ${pin.prototypeId ?? "?"} Build ${pin.buildNumber ?? "?"} comment ${pin.commentId ?? "?"} by ${reference.author?.id ?? "?"}`
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
    })
    session.out(
      record,
      `Accepted ${id}${record.accepted.edited ? " with edits" : ""}. The approval covers ${record.accepted.contentDigest}.`,
    )
    return
  }
  if (!session.values.reason) throw new UsageError("Say why with --reason.")
  const record = await store.rejectMemory(context(session, principal), id, {
    expectedDigest: digest,
    reason: session.values.reason,
  })
  session.out(record, `Rejected ${id}. The reason is kept with it.`)
}

async function retire(session) {
  const id = argument(session, 1, "memory ID")
  if (!session.values.reason) throw new UsageError("Say why with --reason.")
  const principal = person(session)
  const { store } = await open(session)
  const record = await store.retireMemory(context(session, principal), id, {
    reason: session.values.reason,
  })
  session.out(record, `Retired ${id}. It is no longer recalled; its history stays.`)
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
  const { store } = await open(session)
  const result = await store.recall(context(session, principal), {
    task,
    limit: positive(session.values.limit, "--limit", 20),
    budgetChars: positive(session.values.budget, "--budget", 6000),
    preview,
  })
  session.out(result, result.text)
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
  const destination = session.values.out
    ? path.resolve(session.cwd, session.values.out)
    : path.join(session.environment.dataDirectory, "exports", `${stamp}-${purpose}.json`)
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
      `Included ${counts.episodes} episodes, ${counts.events} events, ${counts.memories} learnings, ${counts.grants} grants.`,
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
  if (preview && !session.values.by)
    throw new UsageError("Name the person who previews the questions with --by github:<login>.")
  // Tasksets ask about up to MAX_QUESTION_LEARNINGS learnings, so the default shows them all.
  const limit = positive(session.values.limit, "--limit", MAX_QUESTION_LEARNINGS)
  if (limit > MAX_QUESTION_LEARNINGS)
    throw new UsageError(`--limit must be at most ${MAX_QUESTION_LEARNINGS}.`)
  const principal = preview ? person(session) : actor(session)
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
              `  ${key} (${question.type}): ${quoted(question.instructions, 160)}`,
          ),
          consent,
        ].join("\n")
      : `No accepted learnings apply yet, so there are no questions.\n${consent}`,
  )
}

async function decisionAsk(session) {
  const { values, env } = session
  const endpoint = values.endpoint ?? env.REPLICA_DECISION_ENDPOINT
  if (!endpoint || !values.questions || !values.screenshots)
    throw new UsageError(
      "Name the endpoint with --endpoint or REPLICA_DECISION_ENDPOINT, the output of decision questions --json with --questions, and a Build's screenshots folder with --screenshots.",
    )
  // The key stays out of the command line, where other accounts could read it.
  const key = env.REPLICA_DECISION_KEY
  if (!key)
    throw new UsageError(
      "Set REPLICA_DECISION_KEY to the endpoint's key or a Microsoft Entra token.",
    )
  let asked
  try {
    asked = JSON.parse(await readFile(path.resolve(session.cwd, values.questions), "utf8"))
  } catch (error) {
    throw new LearningError(
      "invalid_input",
      `Cannot read ${values.questions} as JSON (${error.code ?? error.message}).`,
    )
  }
  const route = values.route ?? "/"
  const request = await decisionRequest(asked, {
    screenshots: path.resolve(session.cwd, values.screenshots),
    route,
    brandSheet: values["brand-sheet"] && path.resolve(session.cwd, values["brand-sheet"]),
  })
  const answers = values.model
    ? await askChatModel({ endpoint, key, model: values.model, request })
    : await askDecisionModel({ endpoint, key, request })
  const learnings = asked.rules
    .filter(({ id }) => answers[id])
    .map(({ id, text }) => ({ id, text, follows: answers[id].probabilities.yes }))
    .sort((a, b) => a.follows - b.follows)
  session.out(
    { route, learnings, answers },
    [
      `Chance the page at route ${route} follows each learning, lowest first:`,
      ...learnings.map(
        ({ follows, text }) =>
          `  ${String(Math.round(follows * 100)).padStart(3)}%  ${quoted(text, 120)}`,
      ),
    ].join("\n"),
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
  const directory = path.resolve(session.cwd, values.out)
  const problem = await placementProblem(session.environment, await realLocation(directory), {
    what: "tasksets",
  })
  if (problem) throw new LearningError("invalid_input", problem)
  const manifest = await writeDecisionTaskset(plan, {
    directory,
    baseDirectory: path.dirname(path.resolve(session.cwd, values.builds)),
    brandSheet: values["brand-sheet"] && path.resolve(session.cwd, values["brand-sheet"]),
    createdAt: timestampFromMilliseconds(session.clock()),
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
