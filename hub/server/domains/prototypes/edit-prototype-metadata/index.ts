import type { findPrototypeDetail } from "../../../repositories/prototype-index/find-prototype-detail/index.ts"
import type { lockEditablePrototype } from "../../../repositories/prototypes/lock-editable-prototype/index.ts"
import type { updatePrototypeMetadata } from "../../../repositories/prototypes/update-prototype-metadata/index.ts"
import { PrototypeMetadataError } from "../errors.ts"

type Detail = NonNullable<Awaited<ReturnType<typeof findPrototypeDetail>>>

// Matches the database metadata guard, which also treats NEL as blank.
const edgeSpace = /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$/u

function trimName(value: string) {
  let start = 0
  let end = value.length
  while (start < end && edgeSpace.test(value.charAt(start))) start += 1
  while (end > start && edgeSpace.test(value.charAt(end - 1))) end -= 1
  return value.slice(start, end)
}

export interface PrototypeMetadataChanges {
  name?: string | null
}

export interface PrototypeMetadataRepositories {
  restoreSession(sessionDigest: string): Promise<{ userId: string } | null>
  lockPrototype(repositoryId: string, prototypeId: string): ReturnType<typeof lockEditablePrototype>
  updatePrototype(id: string, data: Parameters<typeof updatePrototypeMetadata>[2]): Promise<unknown>
  findDetail(repositoryId: string, prototypeId: string): Promise<Detail | null>
}

/** Saves metadata without changing the prototype's author or registration. */
export async function editPrototypeMetadata(
  input: {
    changes: PrototypeMetadataChanges
    prototypeId: string
    repositoryId: string
    sessionDigest: string
  },
  {
    runTransaction,
  }: {
    runTransaction: (
      operation: (repositories: PrototypeMetadataRepositories) => Promise<Detail>,
    ) => Promise<Detail>
  },
) {
  const name =
    input.changes.name === null || input.changes.name === undefined
      ? undefined
      : trimName(input.changes.name)
  if (!name) throw new PrototypeMetadataError("invalid_input", "Enter a prototype name.")
  if (/[\p{Cs}\0]/u.test(name)) {
    throw new PrototypeMetadataError(
      "invalid_input",
      "Remove unsupported characters from the prototype name.",
    )
  }
  if ([...name].length > 255) {
    throw new PrototypeMetadataError(
      "invalid_input",
      "Use at most 255 characters for the prototype name.",
    )
  }
  return runTransaction(async (repositories) => {
    const viewer = await repositories.restoreSession(input.sessionDigest)
    if (!viewer) throw new PrototypeMetadataError("not_signed_in", "Sign in to continue.")
    const prototype = await repositories.lockPrototype(input.repositoryId, input.prototypeId)
    if (!prototype?.registeredAt) {
      throw new PrototypeMetadataError("not_found", "Prototype not found.")
    }

    await repositories.updatePrototype(prototype.id, { name })
    const detail = await repositories.findDetail(input.repositoryId, input.prototypeId)
    if (!detail) throw new Error("The edited prototype is unavailable.")
    const currentViewer = await repositories.restoreSession(input.sessionDigest)
    if (!currentViewer || currentViewer.userId !== viewer.userId) {
      throw new PrototypeMetadataError("not_signed_in", "Sign in to continue.")
    }
    return detail
  })
}
