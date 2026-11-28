import { execFile, spawn } from "node:child_process"
import { closeSync, constants, fstatSync, mkdirSync, openSync, writeSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { NO_FOLLOW } from "./providers/files.mjs"

const SCRIPT = fileURLToPath(new URL("../bin/replica-learning.mjs", import.meta.url))
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
// A person may take a while to read a learning, so a form waits longer than a call.
export const FORM_TIMEOUT_MS = 30 * 60 * 1000
const DONE = { accept: "accepted", reject: "rejected", apply: "applied", dismiss: "dismissed" }
// Starts the command in its arguments and exits, so that command has no living parent.
const LAUNCH = `const [command, ...rest] = process.argv.slice(1)
require("node:child_process")
  .spawn(command, rest, { detached: true, stdio: "inherit" })
  .on("error", () => {})
  .unref()`

/**
 * Starts `replica-learning analyze` as its own process, so it finishes even when the
 * agent session that asked for it ends first. Its output goes to analysis.log in the
 * data directory, so a person can see what it did and what Copilot usage it spent.
 *
 * A short-lived middle process starts it. Copilot CLI stops an MCP server's whole
 * process tree when a session ends, and that would stop a direct child mid-analysis.
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
 * agent can neither see nor fill it in. Returns null unless the person agreed.
 *
 * @param {(params: object) => Promise<{ action: string, content?: object }>} elicit
 * @param {{ repository: string, login?: string }} details
 */
export async function askConsent(elicit, { repository, login }) {
  const answer = await elicit({
    message: [
      `Learn from your feedback in Copilot chats for ${repository}?`,
      "",
      "Each chat's messages are kept on this machine in .replica/learning. In the background, Copilot looks for feedback that repeats across chats and suggests it as a learning. That uses your Copilot sign-in and counts toward your Copilot usage.",
      "",
      "Nothing reaches an agent until you accept it. Run replica-learning grants withdraw to stop at any time.",
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
  })
  if (answer.action !== "accept" || answer.content?.allow !== true) return null
  const person = loginOf(answer.content.login)
  if (!person) return null
  return { login: person, screenshots: answer.content.screenshots === true }
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
    ...proposals.map((proposal) => ({
      id: proposal.id,
      heading: "Suggested learning",
      body: [
        ...(proposal.title ? [proposal.title, ""] : []),
        proposal.content,
        ...(proposal.themeKey ? ["", `Theme: ${proposal.themeKey}`] : []),
      ],
      choices: [
        { const: "accept", title: "Accept: agents follow it from now on" },
        { const: "reject", title: "Reject" },
      ],
      wording: proposal.content,
    })),
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
        required: kind === "reject" ? ["reason", "login"] : ["login"],
      },
    })
    if (details.action !== "accept") return { ...counts, stopped: true }
    const choice = details.content ?? {}
    reviewer = loginOf(choice.login) ?? reviewer
    if (!reviewer) {
      counts.skipped++
      continue
    }
    const content = typeof choice.content === "string" ? choice.content.trim() : ""
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
  const login = typeof value === "string" ? value.trim().replace(/^github:/, "") : ""
  return LOGIN.test(login) ? login : undefined
}
