import path from "node:path"

import { createPrivateStore } from "../private-store/index.mjs"

export type CommentStore = ReturnType<typeof createCommentStore>

export function createCommentStore(sessionWorkspacePath: string | undefined) {
  if (!sessionWorkspacePath) throw new Error("Comment actions require a session workspace.")
  return createPrivateStore(path.join(sessionWorkspacePath, "replica-prototype", "agent-comments"))
}
