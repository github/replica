import path from "node:path"
import { createPrivateStore } from "../private-store/index.mjs"
export function createCommentStore(sessionWorkspacePath) {
  if (!sessionWorkspacePath) throw new Error("Comment actions require a session workspace.")
  return createPrivateStore(path.join(sessionWorkspacePath, "replica-prototype", "agent-comments"))
}
