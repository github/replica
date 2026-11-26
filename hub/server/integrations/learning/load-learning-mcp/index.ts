import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export interface LearningMcpServer {
  connect(transport: unknown): Promise<void>
  close(): Promise<void>
}

export interface LearningMcp {
  createLearningMcpServer(
    backend: Record<string, (input: never) => Promise<unknown>>,
    options?: { name?: string; version?: string; onError?: (error: unknown) => void },
  ): LearningMcpServer
  LearningError: new (code: string, message: string) => Error
}

const loaded = new Map<string, Promise<LearningMcp>>()

/**
 * Loads the learning tools from the installed replica-learning package, so Hub offers
 * agents the same tools and instructions as the local server. The package's MCP SDK is
 * optional, which is why it loads only when an agent first connects.
 */
export function loadLearningMcp(cliPath: string) {
  const url = pathToFileURL(resolve(dirname(cliPath), "../src/mcp.mjs")).href
  let module = loaded.get(url)
  if (!module) {
    module = import(url) as Promise<LearningMcp>
    module.catch(() => loaded.delete(url))
    loaded.set(url, module)
  }
  return module
}
