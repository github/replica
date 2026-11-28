import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, constants, fstatSync, mkdirSync, openSync, writeSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { LearningError } from "./errors.mjs"
import { NO_FOLLOW } from "./providers/files.mjs"

const SCRIPT = fileURLToPath(new URL("../bin/replica-learning.mjs", import.meta.url))
// Enterprise Managed Users have logins like jdoe_acme, so an underscore is allowed.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,98}[A-Za-z0-9])?$/
// A person may take a while to read a learning, so a form waits longer than a call.
export const FORM_TIMEOUT_MS = 30 * 60 * 1000
const DONE = { accept: "accepted", reject: "rejected", apply: "applied", dismiss: "dismissed" }
// The detached launcher preserves the analysis and relays its completion status.
const LAUNCH = `const [command, ...rest] = process.argv.slice(1)
const child = require("node:child_process")
  .spawn(command, rest, { detached: true, stdio: "inherit" })
child.on("error", () => { process.exitCode = 1 })
child.on("close", (code) => { process.exitCode = code ?? 1 })`

/**
 * Starts `replica-learning analyze` as its own process, so it finishes even when the
 * agent session that asked for it ends first. Its output goes to analysis.log in the
 * data directory, so a person can see what it did and what Copilot usage it spent.
 *
 * A detached middle process keeps it running if Copilot CLI stops the server's process
 * tree when the session ends. It also relays the exit status while the server is alive.
 *
 * @param {{ cwd: string, env: object, dataDirectory: string, args: string[] }} options
 */
export function startAnalysis({ cwd, env, dataDirectory, args }) {
  const log = openPrivateAppend(dataDirectory, "analysis.log")
  try {
    const child = spawn(
      process.execPath,
      ["-e", LAUNCH, process.execPath, SCRIPT, "analyze", ...args],
      {
        cwd,
        env,
        detached: true,
        stdio: ["ignore", log, log],
      },
    )
    child.on("error", () => {})
    child.unref()
    return child
  } finally {
    closeSync(log)
  }
}

/**
 * Adds one analysis run to activity.jsonl in the data directory. A local Hub reads it
 * to show the same daily activity grid that Hub's own runs fill in.
 *
 * @param {string} dataDirectory
 * @param {{
 *   startedAt: string,
 *   state: "succeeded" | "failed",
 *   commentsConsidered: number,
 *   commentsLabeled: number,
 *   suggestions: number,
 * }} run
 */
export function recordActivity(dataDirectory, run) {
  const file = openPrivateAppend(dataDirectory, "activity.jsonl")
  try {
    writeSync(file, `${JSON.stringify(run)}\n`)
  } finally {
    closeSync(file)
  }
}

/** Opens a data directory file for appending, refusing one that isn't ours alone. */
function openPrivateAppend(dataDirectory, name) {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  // A cloned repository could commit a link here, so the file must be our own.
  const file = openSync(
    path.join(dataDirectory, name),
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW,
    0o600,
  )
  const stats = fstatSync(file)
  const owner = process.getuid?.()
  if (!stats.isFile() || stats.nlink !== 1 || (owner !== undefined && stats.uid !== owner)) {
    closeSync(file)
    throw new Error(`${path.join(dataDirectory, name)} is not a private file.`)
  }
  return file
}

/** The GitHub CLI's signed-in login, to fill in a form for the person. */
export async function signedInLogin(env) {
  try {
    const { stdout } = await promisify(execFile)("gh", ["api", "user", "--jq", ".login"], {
      env,
      timeout: 5000,
    })
    const login = stdout.trim()
    return LOGIN.test(login) ? login : undefined
  } catch {
    return undefined
  }
}

/**
 * Asks the person, not the agent, whether this repository may learn from their chats.
 * The client shows the form to the person and sends their answer straight back, so an
 * agent can neither see nor fill it in. Returns null unless the person agreed. A login
 * that isn't valid is asked for again rather than taken as a no, because the server
 * remembers a no for the rest of the session.
 *
 * @param {(params: object) => Promise<{ action: string, content?: object }>} elicit
 * @param {{ repository: string, login?: string, grantManagement?: string[] }} details
 */
export async function askConsent(elicit, { repository, login, grantManagement = [] }) {
  let problem = ""
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await elicit(consentForm(repository, login, problem, grantManagement))
    if (answer.action !== "accept" || answer.content?.allow !== true) return null
    const person = loginOf(answer.content.login)
    if (person) return { login: person, screenshots: answer.content.screenshots === true }
    problem = `"${String(answer.content.login ?? "").slice(0, 100)}" isn't a GitHub login. Enter it as it appears on github.com, such as ana-designer.\n\n`
  }
  throw new LearningError(
    "invalid_input",
    "The person didn't enter a valid GitHub login. Call the tool again to show the form again.",
  )
}

function consentForm(repository, login, problem, grantManagement) {
  return {
    message: [
      `${problem}Learn from your feedback in Copilot chats for ${repository}?`,
      "",
      "Each chat's messages are kept on this machine in .replica/learning. So are the Pick & Polish notes you ask Copilot to fix, with their follow-ups and Copilot's replies. In the background, Copilot looks for feedback that repeats across chats and suggests it as a learning. When the agent reports which learnings a commit used, Copilot also reads that commit's changes to score them. That uses your Copilot sign-in and counts toward your Copilot usage.",
      "",
      "Only learnings you accept reach an agent.",
      ...grantManagement,
    ].join("\n"),
    requestedSchema: {
      type: "object",
      properties: {
        allow: { type: "boolean", title: "Learn from my chats in this repository", default: true },
        screenshots: {
          type: "boolean",
          title: "Also let Copilot look at before and after screenshots when it scores a learning",
          default: false,
        },
        login: {
          type: "string",
          title: "Your GitHub login",
          description: "Recorded as the person who agreed.",
          ...(login ? { default: login } : {}),
        },
      },
      required: ["allow", "login"],
    },
  }
}

/**
 * Walks the person through each suggested learning and each suggested update, one form
 * at a time, and records only what they choose. Closing a form stops the review; what
 * was already decided stays decided.
 *
 * @param {(params: object) => Promise<{ action: string, content?: object }>} elicit
 * @param {{
 *   repository: string,
 *   login?: string,
 *   proposals: Array<{
 *     id: string, title?: string, content: string, themeKey?: string,
 *     proposal?: {
 *       lifecycle?: { action: string, targets?: string[] },
 *       rationale?: {
 *         recurrence?: string, contradictions?: string,
 *         expectedBenefit?: string, falsification?: string,
 *       },
 *     },
 *     support?: {
 *       distinctEpisodes: number, distinctPrototypes: number,
 *       distinctReviewers: number, distinctBuilds: number,
 *     },
 *     evidence?: Array<{
 *       eventIds: string[], episodeId: string,
 *       source?: {
 *         sessionId?: string, prototypeId?: string,
 *         buildNumber?: number, commentId?: string,
 *       },
 *     }>,
 *     evidenceCommand?: string,
 *   }>,
 *   updates: Array<{
 *     id: string, issue: string, title?: string, content: string,
 *     current: { title?: string, content: string },
 *   }>,
 *   decide(choice: object): Promise<void>,
 * }} review
 */
export async function reviewWithPerson(elicit, { repository, login, proposals, updates, decide }) {
  const items = [
    ...proposals.map((proposal) => {
      const lifecycle = proposal.proposal?.lifecycle
      const rationale = proposal.proposal?.rationale
      const support = proposal.support
      const evidence = (proposal.evidence ?? []).map((reference) => {
        const source = reference.source ?? {}
        const where =
          source.sessionId === undefined
            ? `prototype ${source.prototypeId ?? "?"} Build ${source.buildNumber ?? "?"} comment ${source.commentId ?? "?"}`
            : `session ${source.sessionId}`
        return `${reference.eventIds.join(", ")} in ${reference.episodeId}: ${where}`
      })
      return {
        id: proposal.id,
        heading: "Suggested learning",
        body: [
          `Learning ID: ${proposal.id}`,
          ...(proposal.title ? [proposal.title, ""] : []),
          proposal.content,
          ...(proposal.themeKey ? ["", `Theme: ${proposal.themeKey}`] : []),
          ...(support
            ? [
                "",
                `Support: ${support.distinctEpisodes} feedback sources, ${support.distinctPrototypes} prototypes, ${support.distinctReviewers} reviewers, ${support.distinctBuilds} Builds`,
              ]
            : []),
          ...(rationale?.recurrence ? ["", `Why: ${rationale.recurrence}`] : []),
          ...(rationale?.contradictions ? [`Disagreement: ${rationale.contradictions}`] : []),
          ...(rationale?.expectedBenefit ? [`Expected benefit: ${rationale.expectedBenefit}`] : []),
          ...(rationale?.falsification
            ? [`How we would know it is wrong: ${rationale.falsification}`]
            : []),
          ...(evidence.length ? ["", "Evidence:", ...evidence] : []),
          ...(proposal.evidenceCommand
            ? ["", "Look up the full evidence before deciding:", proposal.evidenceCommand]
            : []),
          // Accepting can retire other learnings, so the person sees which ones.
          ...(lifecycle?.targets?.length
            ? ["", `Accepting it replaces: ${lifecycle.targets.join(", ")} (${lifecycle.action})`]
            : []),
        ],
        choices: [
          { const: "accept", title: "Accept: agents follow it from now on" },
          { const: "reject", title: "Reject" },
        ],
        wording: proposal.content,
      }
    }),
    ...updates.map((update) => ({
      id: update.id,
      heading: "Suggested update",
      body: [
        "Agents kept running into this:",
        update.issue,
        "",
        "Current wording:",
        update.current.content,
        "",
        "Suggested wording:",
        ...(update.title ? [update.title] : []),
        update.content,
      ],
      choices: [
        { const: "apply", title: "Use the suggested wording" },
        { const: "dismiss", title: "Keep the current wording" },
      ],
    })),
  ]
  const counts = { accepted: 0, rejected: 0, applied: 0, dismissed: 0, skipped: 0 }
  let reviewer = login
  for (const [index, item] of items.entries()) {
    const answer = await elicit({
      message: [
        `${item.heading} ${index + 1} of ${items.length} for ${repository}`,
        "",
        ...item.body,
      ].join("\n"),
      requestedSchema: {
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: "Decision",
            oneOf: [...item.choices, { const: "skip", title: "Decide later" }],
            default: "skip",
          },
        },
        required: ["decision"],
      },
    })
    if (answer.action !== "accept") return { ...counts, stopped: true }
    const selected = item.choices.find((option) => option.const === answer.content?.decision)
    if (!selected) {
      counts.skipped++
      continue
    }
    const kind = selected.const
    const details = await elicit({
      message: [
        `Confirm: ${selected.title}`,
        "",
        ...item.body,
        "",
        "Submitting records your decision. Closing this form leaves it undecided.",
      ].join("\n"),
      requestedSchema: {
        type: "object",
        properties: {
          ...(kind === "accept"
            ? {
                content: {
                  type: "string",
                  title: "Wording",
                  description: "Edit to accept different wording.",
                  default: item.wording,
                },
              }
            : {
                reason: {
                  type: "string",
                  title: "Reason",
                  ...(kind === "reject" ? { minLength: 1, maxLength: 2000 } : {}),
                },
              }),
          login: {
            type: "string",
            title: "Your GitHub login",
            description: "Recorded as the person who decided.",
            ...(reviewer ? { default: reviewer } : {}),
          },
        },
        required:
          kind === "reject"
            ? ["reason", "login"]
            : kind === "accept"
              ? ["content", "login"]
              : ["login"],
      },
    })
    if (details.action !== "accept") return { ...counts, stopped: true }
    const choice = details.content ?? {}
    // A blank or mistyped login is not anyone's decision, so the item stays undecided.
    const confirmed = loginOf(choice.login)
    if (!confirmed) {
      counts.skipped++
      continue
    }
    reviewer = confirmed
    const suppliedContent = typeof choice.content === "string"
    const content = typeof choice.content === "string" ? choice.content.trim() : ""
    if (kind === "accept" && (!suppliedContent || !content)) {
      counts.skipped++
      continue
    }
    const reason = typeof choice.reason === "string" ? choice.reason.trim().slice(0, 2000) : ""
    if (kind === "reject" && !reason) {
      counts.skipped++
      continue
    }
    await decide({
      kind,
      id: item.id,
      login: reviewer,
      ...(content && content !== item.wording ? { content } : {}),
      ...(kind !== "accept"
        ? {
            reason:
              reason ||
              `${DONE[kind][0].toUpperCase()}${DONE[kind].slice(1)} while reviewing in Copilot.`,
          }
        : {}),
    })
    counts[DONE[kind]]++
  }
  return { ...counts, stopped: false }
}

function loginOf(value) {
  const login = typeof value === "string" ? value.trim().replace(/^(?:github:|@)/, "") : ""
  return LOGIN.test(login) ? login : undefined
}

/**
 * The same operation ID every time a person applies an update here, so an apply that
 * saved the new wording but stopped before recording the decision can finish later.
 */
export function applyOperationId(proposalId) {
  const hex = createHash("sha256").update(`replica-learning mcp apply ${proposalId}`).digest("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-")
}

/**
 * Finishes applies that stopped halfway. Their new wording is already in use, so the
 * update no longer looks open and would otherwise never be shown or recorded again.
 * The store requires the same person and reason as the first try, so both come from
 * the version that apply saved.
 *
 * @param {object} store
 * @param {{ system: object, as: (principal: object) => object }} contexts
 */
export async function finishStoppedApplies(store, { system, as }) {
  const accepted = await store.queryMemory(system, { states: ["accepted"], purpose: "review" })
  for (const { record } of accepted) {
    const stopped = (await store.updatesFor(system, { memoryId: record.id })).filter(
      (update) => update.state === "stale" && !update.decision,
    )
    if (!stopped.length) continue
    const { versions } = await store.getMemory(system, record.id, { history: true })
    for (const update of stopped) {
      const operationId = applyOperationId(update.id)
      const saved = versions.find((version) => version.accepted?.operationId === operationId)
      if (!saved || saved.withheld) continue
      await store.applyUpdate(as(saved.accepted.by), update.id, {
        reason: saved.accepted.note,
        operationId,
      })
    }
  }
}
