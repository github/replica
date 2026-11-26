import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { MemoryReading } from "./index.mjs"

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
    /** The whole conversation in order; a tool message holds its place with empty text. */
    messages: Array<{ role: "user" | "agent" | "tool"; text: string; at?: string }>
    outcome?: { status: "success" | "failure" | "partial" | "unknown"; summary?: string }
  }): Promise<unknown>
  /** Returns the store's memory readings; the tool shortens them for the agent. */
  listLearnings(input: {
    state?: Array<"proposed" | "accepted" | "rejected" | "retired">
  }): Promise<MemoryReading[]>
  getLearning(input: { id: string }): Promise<unknown>
}

/** A screenshot an agent names by a PNG file's path. */
export interface McpScreenshot {
  file: string
  route: string
  viewport: { width: number; height: number }
  theme: string
  /** UTC with six fractional digits, such as 2026-10-09T12:00:00.000000Z. */
  capturedAt: string
}

/** Builds the learning MCP server around a host's backend. Connect it to a transport. */
export function createLearningMcpServer(
  backend: LearningMcpBackend,
  options?: {
    name?: string
    version?: string
    /** Receives failures the agent sees only as a generic error, so the host can log them. */
    onError?: (error: unknown) => void
  },
): McpServer
