import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { MemoryReading, PickAndPolishNote } from "./index.mjs"

export { LearningError } from "./index.mjs"

/**
 * What a host supplies to serve the learning tools. Each method receives the tool's
 * checked input and returns the JSON the agent sees. Throw a LearningError to give the
 * agent its code and message; any other error reaches the agent as a generic failure.
 */
export interface LearningMcpBackend {
  getGuidance(input: {
    task?: string
    limit?: number
    session?: { id: string; label?: string }
  }): Promise<unknown>
  reportUsage(input: {
    reportId: string
    guidanceIds: string[]
    commitSha: string
    prototypeId?: string
    session?: { id: string; label?: string }
    used: Array<{
      deliveryId: string
      before?: McpScreenshot
      after?: McpScreenshot
    }>
  }): Promise<unknown>
  submitSession(input: {
    sessionId: string
    task?: string
    user?: string
    startedAt?: string
    /** The whole conversation in order; a tool message keeps its place, empty. */
    messages: Array<{ role: "user" | "agent" | "tool"; text: string; at?: string }>
    outcome?: { status: "success" | "failure" | "partial" | "unknown"; summary?: string }
    /** The notes improvement_batch returned, so they become evidence too. */
    pickAndPolishNotes?: PickAndPolishNote[]
  }): Promise<unknown>
  /** Returns the store's memory readings; the tool shortens them for the agent. */
  listLearnings(input: {
    state?: Array<"proposed" | "accepted" | "rejected" | "retired">
  }): Promise<MemoryReading[]>
  getLearning(input: { id: string }): Promise<unknown>
  /**
   * Optional. Asks the person, never the agent, to decide on what waits for review.
   * Offer it only when the host can show the person a form.
   */
  reviewLearnings?(): Promise<unknown>
}

/** A screenshot an agent names by a PNG file's path, or sends as base64 PNG data. */
export type McpScreenshot = ({ file: string; data?: never } | { data: string; file?: never }) & {
  route: string
  viewport: { width: number; height: number }
  theme: string
  /** UTC with six fractional digits, such as 2026-10-09T12:00:00.000000Z. */
  capturedAt: string
}

/** Builds the learning MCP server around a host's backend. Connect a transport. */
export function createLearningMcpServer(
  backend: LearningMcpBackend,
  options?: {
    name?: string
    version?: string
    /** Asks the agent to submit after every request, not when the session ends. */
    submitEachRequest?: boolean
    /** Gets failures the agent sees only as a generic error, so the host can log. */
    onError?: (error: unknown) => void
  },
): McpServer
