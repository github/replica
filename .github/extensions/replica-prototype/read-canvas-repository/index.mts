import path from "node:path"

import type { CanvasContext } from "../create-canvas-context/index.mjs"
import { readRepositoryName } from "../read-repository-name/index.mjs"

export async function readCanvasRepository(
  context: Pick<CanvasContext, "repositoryPath"> & { target?: { repository: string | null } },
) {
  const repository = await readRepositoryName(context.repositoryPath)
  const targetRepository = context.target?.repository
  const localRoot = path.dirname(context.repositoryPath)
  const localName = path.basename(context.repositoryPath)
  const local =
    targetRepository === `local/${localName}` &&
    path.basename(localRoot) === "prototypes" &&
    path.basename(path.dirname(localRoot)) === ".local"

  return {
    repository: local ? targetRepository : repository.repository,
    githubRepository: repository.repository,
    legacyRepository: repository.legacyRepository,
    local,
  }
}
