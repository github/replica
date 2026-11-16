import type { findPrototypeDetail } from "../../../repositories/prototype-index/find-prototype-detail/index.ts"
import type { lockVisiblePrototype } from "../../../repositories/prototypes/lock-visible-prototype/index.ts"

type Detail = NonNullable<Awaited<ReturnType<typeof findPrototypeDetail>>>
type Viewer = { membershipId: string; userId: string }

export class PrototypeViewError extends Error {
  readonly code: "not_found" | "not_signed_in"

  constructor(code: PrototypeViewError["code"]) {
    super(
      code === "not_found" ? "Prototype or successful Build not found." : "Sign in to continue.",
    )
    this.name = "PrototypeViewError"
    this.code = code
  }
}

export interface PrototypeViewRepositories {
  restoreSession(digest: string): Promise<Viewer | null>
  lockPrototype(repositoryId: string, prototypeId: string): ReturnType<typeof lockVisiblePrototype>
  findDetail(
    repositoryId: string,
    prototypeId: string,
    buildNumber?: number,
  ): Promise<Detail | null>
  recordIntroduction(userId: string, prototypeId: string): Promise<boolean>
}

/** Records a view only when its response can be prepared under current authority. */
export async function readPrototypeWithIntroduction(
  input: {
    buildNumber?: number
    membershipId: string
    prototypeId: string
    repositoryId: string
    sessionDigest: string
    userId: string
  },
  {
    prepare,
    runTransaction,
  }: {
    prepare: (detail: Detail, showPrototypeInfo: boolean) => string
    runTransaction: (
      operation: (repositories: PrototypeViewRepositories) => Promise<string>,
    ) => Promise<string>
  },
) {
  return runTransaction(async (repositories) => {
    async function checkViewer() {
      const viewer = await repositories.restoreSession(input.sessionDigest)
      if (!viewer || viewer.membershipId !== input.membershipId || viewer.userId !== input.userId) {
        throw new PrototypeViewError("not_signed_in")
      }
    }

    await checkViewer()
    const prototype = await repositories.lockPrototype(input.repositoryId, input.prototypeId)
    await checkViewer()
    if (!prototype) throw new PrototypeViewError("not_found")
    const detail = await repositories.findDetail(
      input.repositoryId,
      input.prototypeId,
      input.buildNumber,
    )
    await checkViewer()
    if (!detail || (input.buildNumber !== undefined && !detail.selectedBuild)) {
      throw new PrototypeViewError("not_found")
    }
    const showPrototypeInfo = await repositories.recordIntroduction(input.userId, input.prototypeId)
    await checkViewer()
    const body = prepare(detail, showPrototypeInfo)
    await checkViewer()
    return body
  })
}
