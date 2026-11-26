import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { LearningError } from "./errors.mjs"

// Agents see a code and message only for this exact class, so hosts need it too.
export { LearningError }

const INSTRUCTIONS = `This server holds the learnings a team accepted from past reviews of its prototypes.

Before you start a task, call get_guidance with a short description of the task and follow the learnings it returns. Keep its guidanceId and each learning's deliveryId.

When a learning may change something visible, capture a screenshot before you edit and another once the change is in place, but only when get_guidance returned screenshotsAllowed: true. After you commit, call report_usage with the commit SHA and only the learnings you actually applied.

When the session ends, call submit_session with the conversation so reviewers' feedback can become new learnings.

Only a person can accept, reject, edit, or delete a learning. get_learning tells you how a person can decide on a proposed one.`

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
  .optional()

/**
 * Builds the learning MCP server around a host's backend. The tools, their descriptions,
 * and the agent instructions live here once, so the local server and Hub behave the same
 * while each host decides how to reach its store.
 *
 * @param {{
 *   getGuidance(input: object): Promise<unknown>
 *   reportUsage(input: object): Promise<unknown>
 *   submitSession(input: object): Promise<unknown>
 *   listLearnings(input: object): Promise<unknown>
 *   getLearning(input: object): Promise<unknown>
 * }} backend
 * @param {{ name?: string, version?: string, onError?: (error: unknown) => void }} [options]
 *   onError receives any failure that is not a LearningError, so the host can log the
 *   cause the agent is not shown.
 */
export function createLearningMcpServer(
  backend,
  { name = "replica-learning", version = "0.0.0", onError } = {},
) {
  const server = new McpServer({ name, version }, { instructions: INSTRUCTIONS })
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
      description:
        "Returns the accepted learnings that fit a task, as text to follow plus each learning's id and deliveryId, and whether report_usage accepts screenshots. Records that this guidance was given. Call it before starting work.",
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
        "Records which delivered learnings you applied in a commit. When get_guidance said screenshotsAllowed, capture a before screenshot ahead of the edit and an after screenshot once the change is in place. Sending the same reportId again changes nothing.",
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
      description:
        "Stores this session's user and agent messages and its outcome, so feedback in it can become learnings. Messages are matched by position, so always send the whole conversation in order, with each tool call or output as an empty tool message, and keep each earlier message's user and time unchanged. Sending the same sessionId again adds the new messages.",
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
        "Lists learnings and their states. Only accepted learnings that recall can give include their text. Read only.",
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
        // Text no one accepted, or that consent no longer lets agents use, stays withheld.
        ...(record.state === "accepted" && !withheld && status.recallEligible
          ? { title: record.title, content: record.content }
          : { withheld: true }),
        recalled: status.recallEligible,
      })),
  )
  tool(
    "get_learning",
    {
      title: "Get learning",
      description:
        "Shows one accepted learning that recall can give. Any other learning shows only its state, and a proposed one says how a person can accept or reject it. Read only.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (input) => backend.getLearning(input),
  )
  return server
}
