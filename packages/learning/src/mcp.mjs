import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { LearningError } from "./errors.mjs"

// Agents see a code and message only for this exact class, so hosts need it too.
export { LearningError }

const SUBMIT_AT_END =
  "When the session ends, call submit_session with the conversation so reviewers' feedback can become new learnings. If you completed a Pick & Polish batch, also pass the notes returned by improvement_results unchanged as pickAndPolishNotes. Those notes include the confirmed Copilot replies; do not send the earlier immutable batch notes instead."

// A person working alone rarely ends a chat on purpose, so a local server asks for the
// conversation after every request instead. A resent session stores only what's new.
const SUBMIT_EACH_REQUEST =
  "After you finish each request, call submit_session with the whole conversation so far, using the same sessionId each time, so feedback can become new learnings. Do not wait for the session to end. If you completed a Pick & Polish batch, also pass the notes returned by improvement_results unchanged as pickAndPolishNotes. Those notes include the confirmed Copilot replies; do not send the earlier immutable batch notes instead."

function instructionsFor(submitEachRequest) {
  return `This server holds the learnings a team accepted from past reviews of its prototypes.

Before you start a task, call get_guidance with a short description of the task and follow the learnings it returns. Keep its guidanceId and each learning's deliveryId.

When a learning may change something visible, capture a screenshot before you edit and another once the change is in place, but only when get_guidance returned screenshotsAllowed: true. After you commit, call report_usage with the commit SHA and only the learnings you actually applied.

${submitEachRequest ? SUBMIT_EACH_REQUEST : SUBMIT_AT_END}

Only a person can accept, reject, edit, or delete a learning. get_learning tells you how a person can decide on a proposed one.`
}

// Added only when the host can ask the person itself, so other hosts' agents are not
// told about a tool they do not have. Tool descriptions repeat it, because a client may
// not pass server instructions on to the agent.
const REVIEW_OFFER =
  "at the next natural pause tell the person how many suggestions are waiting and ask whether they want to review them. Offer to call review_learnings, but call it only if they agree. It shows a form when supported or gives commands they can run. Offer at most once in a session unless the waiting count increases."

const REVIEW_INSTRUCTIONS = `

When submit_session or get_guidance returns waitingForReview above 0, ${REVIEW_OFFER} The person sees the suggestions in a form when supported; otherwise, they get commands to review them.`

const session = z
  .object({
    id: z.string().describe("The agent session ID, so recall and reports link to one session."),
    label: z.string().optional().describe("A short readable name for the session."),
  })
  .optional()

const screenshot = z
  .object({
    file: z
      .string()
      .optional()
      .describe("A PNG file's path, inside the directory the server runs in. Local only."),
    data: z
      .string()
      .optional()
      .describe("The PNG bytes in base64, instead of file. Hub accepts only this."),
    route: z.string().describe("The prototype route shown, such as /settings."),
    viewport: z.object({ width: z.number().int(), height: z.number().int() }),
    theme: z.string().describe("The color theme shown, such as light or dark."),
    capturedAt: z
      .string()
      .describe(
        "When it was captured, in UTC with six fractional digits, such as 2026-10-09T12:00:00.000000Z.",
      ),
  })
  .refine(({ file, data }) => (file === undefined) !== (data === undefined), {
    message: "Provide exactly one screenshot source: file or data.",
  })
  .optional()

const login = z.object({ login: z.string() })

// Only what learning keeps from a Pick & Polish note. Anything else the canvas
// returns, such as selectors and request IDs, is dropped here.
const pickAndPolishNote = z.object({
  localId: z.string(),
  body: z.string().nullable().optional(),
  anchor: z
    .object({
      route: z.object({ pathname: z.string().optional() }).optional(),
      tagName: z.string().optional(),
      accessibleName: z.string().optional(),
    })
    .optional(),
  thread: z
    .object({
      originalAuthor: login.optional(),
      messages: z
        .array(
          z.object({
            id: z.string(),
            role: z.enum(["author", "copilot"]),
            body: z.string(),
            author: login.optional(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
})

/**
 * Builds the learning MCP server around a host's backend. The tools, their
 * descriptions, and the agent instructions live here once, so the local server and Hub
 * behave the same while each host decides how to reach its store.
 *
 * @param {{
 *   getGuidance(input: object): Promise<unknown>
 *   reportUsage(input: object): Promise<unknown>
 *   submitSession(input: object): Promise<unknown>
 *   listLearnings(input: object): Promise<unknown>
 *   getLearning(input: object): Promise<unknown>
 *   reviewLearnings?(): Promise<unknown>
 * }} backend
 *   reviewLearnings is optional. Only a host that can show the person a form offers it.
 * @param {{
 *   name?: string
 *   version?: string
 *   submitEachRequest?: boolean
 *   onError?: (error: unknown) => void
 * }} [options]
 *   submitEachRequest asks the agent to submit after every request rather than when
 *   the session ends. onError receives any failure that is not a LearningError, so the
 *   host can log the cause the agent is not shown.
 */
export function createLearningMcpServer(
  backend,
  { name = "replica-learning", version = "0.0.0", submitEachRequest = false, onError } = {},
) {
  const canReview = typeof backend.reviewLearnings === "function"
  const base = instructionsFor(submitEachRequest)
  const instructions = canReview ? base + REVIEW_INSTRUCTIONS : base
  const reviewOffer = canReview ? ` When waitingForReview is above 0, ${REVIEW_OFFER}` : ""
  const server = new McpServer({ name, version }, { instructions })
  function tool(id, config, call) {
    server.registerTool(id, config, async (input) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await call(input), null, 2) }] }
      } catch (error) {
        // Learning errors are written for people. Anything else may name local paths or
        // internals, so the agent gets a plain message instead.
        if (!(error instanceof LearningError)) onError?.(error)
        const text =
          error instanceof LearningError
            ? `${error.code}: ${error.message}`
            : "The learning store could not complete this request."
        return { isError: true, content: [{ type: "text", text }] }
      }
    })
  }

  tool(
    "get_guidance",
    {
      title: "Get guidance",
      description: `Returns the accepted learnings that fit a task, as text to follow plus each learning's id and deliveryId, and whether report_usage accepts screenshots. Records that this guidance was given. Call it before starting work, and after you commit, call report_usage with only the learnings you applied.${reviewOffer}`,
      inputSchema: {
        task: z.string().optional().describe("A short description of the task."),
        limit: z.number().int().positive().optional().describe("The most learnings to return."),
        session,
      },
    },
    (input) => backend.getGuidance(input),
  )
  tool(
    "report_usage",
    {
      title: "Report usage",
      description:
        "Records which delivered learnings you applied in a commit. Call it after each commit that applied any. When get_guidance said screenshotsAllowed, capture a before screenshot ahead of the edit and an after screenshot once the change is in place. Sending the same reportId again changes nothing.",
      inputSchema: {
        reportId: z.string().describe("An ID you choose, so a retry is not counted twice."),
        guidanceIds: z
          .array(z.string())
          .min(1)
          .describe("The guidanceIds the learnings came from."),
        commitSha: z.string().describe("The full SHA of the commit that applied them."),
        prototypeId: z.string().optional(),
        session,
        used: z.array(
          z.object({
            deliveryId: z.string().describe("A deliveryId from get_guidance."),
            before: screenshot,
            after: screenshot,
          }),
        ),
      },
      annotations: { idempotentHint: true },
    },
    (input) => backend.reportUsage(input),
  )
  tool(
    "submit_session",
    {
      title: "Submit session",
      description: `Stores this session's user and agent messages and its outcome, so feedback in it can become learnings. ${submitEachRequest ? "Call it after you finish each request, not only when the session ends. " : ""}When available, waitingForReview says how many suggestions are waiting for a person's decision. Messages are matched by position, so always send the whole conversation in order, with each tool call or output as an empty tool message, and keep each earlier message's user and time unchanged. Sending the same sessionId again adds the new messages.${reviewOffer}`,
      inputSchema: {
        sessionId: z.string(),
        task: z.string().optional(),
        user: z.string().optional().describe("The person, as github:<login>, if known."),
        startedAt: z.string().optional().describe("An ISO 8601 time."),
        messages: z.array(
          z.object({
            role: z.enum(["user", "agent", "tool"]),
            text: z.string().describe("Leave empty for a tool message; it is not stored."),
            at: z.string().optional().describe("An ISO 8601 time."),
          }),
        ),
        outcome: z
          .object({
            status: z.enum(["success", "failure", "partial", "unknown"]),
            summary: z.string().optional(),
          })
          .optional(),
        pickAndPolishNotes: z
          .array(pickAndPolishNote)
          .optional()
          .describe(
            "The notes array returned by improvement_results after you complete a Pick & Polish batch, unchanged. It includes the confirmed Copilot replies. Each note is stored once and resending it adds only new replies.",
          ),
      },
      annotations: { idempotentHint: true },
    },
    (input) => backend.submitSession(input),
  )
  tool(
    "list_learnings",
    {
      title: "List learnings",
      description:
        "Lists learning IDs and states without their text. Use get_guidance to read accepted learnings; that records what the agent received.",
      inputSchema: {
        state: z
          .array(z.enum(["proposed", "accepted", "rejected", "retired"]))
          .optional()
          .describe("Only these states. All states when omitted."),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      (await backend.listLearnings(input)).map(({ record, status, withheld }) => ({
        id: record.id,
        state: record.state,
        kind: record.kind,
        withheld: !(record.state === "accepted" && !withheld && status.recallEligible),
        recalled: status.recallEligible,
      })),
  )
  tool(
    "get_learning",
    {
      title: "Get learning",
      description:
        "Shows one learning's ID, state, and any decision commands, never its text. Use get_guidance to read accepted learning text; that records what the agent received.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const { id, state, kind, withheld, recalled, decide } = await backend.getLearning(input)
      return {
        id,
        state,
        ...(kind === undefined ? {} : { kind }),
        ...(withheld === undefined ? {} : { withheld }),
        ...(recalled === undefined ? {} : { recalled }),
        ...(decide === undefined ? {} : { decide }),
      }
    },
  )
  if (typeof backend.reviewLearnings === "function")
    tool(
      "review_learnings",
      {
        title: "Review learnings",
        description:
          "Offers the person a way to review suggested learnings and updates. It shows forms when supported or returns commands they can run. Call it only when the person agrees.",
        inputSchema: {},
      },
      () => backend.reviewLearnings(),
    )
  return server
}
