import type { findPrototypeDetail } from "../../../repositories/prototype-index/find-prototype-detail/index.ts"
import type { lockEditablePrototype } from "../../../repositories/prototypes/lock-editable-prototype/index.ts"
import type { updatePrototypeMetadata } from "../../../repositories/prototypes/update-prototype-metadata/index.ts"
import { normalizeStartPage } from "../../../utils/normalize-start-page/index.ts"
import { trimPrototypeMetadata } from "../../../utils/trim-prototype-metadata/index.ts"
import { PrototypeMetadataError } from "../errors.ts"

type Detail = NonNullable<Awaited<ReturnType<typeof findPrototypeDetail>>>

export interface PrototypeMetadataChanges {
  name?: string | null
  description?: string | null
  startPage?: string | null
}

export interface PrototypeMetadataRepositories {
  restoreSession(sessionDigest: string): Promise<{ userId: string } | null>
  lockPrototype(repositoryId: string, prototypeId: string): ReturnType<typeof lockEditablePrototype>
  updatePrototype(id: string, data: Parameters<typeof updatePrototypeMetadata>[2]): Promise<unknown>
  findDetail(repositoryId: string, prototypeId: string): Promise<Detail | null>
}

function readText(value: string | null | undefined, maximum: number, label: string) {
  if (value === undefined) return undefined
  const text = value === null ? null : trimPrototypeMetadata(value) || null
  if (text && /[\p{Cs}\0]/u.test(text)) {
    throw new PrototypeMetadataError(
      "invalid_input",
      `Remove unsupported characters from the ${label}.`,
    )
  }
  if (text && [...text].length > maximum) {
    throw new PrototypeMetadataError(
      "invalid_input",
      `Use at most ${maximum} characters for the ${label}.`,
    )
  }
  return text
}

/** Registers a draft on its first edit and preserves later registration history. */
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
  const { changes } = input
  if (
    changes.name === undefined &&
    changes.description === undefined &&
    changes.startPage === undefined
  ) {
    throw new PrototypeMetadataError("invalid_input", "Send a prototype edit.")
  }
  const name = readText(changes.name, 255, "prototype name")
  if (name === null) throw new PrototypeMetadataError("invalid_input", "Enter a prototype name.")
  const description = readText(changes.description, 500, "description")
  const startPageText =
    changes.startPage === undefined
      ? undefined
      : changes.startPage === null
        ? null
        : trimPrototypeMetadata(changes.startPage) || null
  const startPage = startPageText ? normalizeStartPage(startPageText) : startPageText
  if (startPageText && !startPage) {
    throw new PrototypeMetadataError(
      "invalid_input",
      "Enter a start page path within this prototype, such as /settings.",
    )
  }

  return runTransaction(async (repositories) => {
    const viewer = await repositories.restoreSession(input.sessionDigest)
    if (!viewer) throw new PrototypeMetadataError("not_signed_in", "Sign in to continue.")
    const prototype = await repositories.lockPrototype(input.repositoryId, input.prototypeId)
    if (!prototype) {
      throw new PrototypeMetadataError("not_found", "Prototype not found.")
    }

    let savedName = name
    if (!prototype.registeredAt && savedName === undefined) {
      savedName = [prototype.name, prototype.branchName]
        .map((candidate) => (candidate === null ? "" : trimPrototypeMetadata(candidate)))
        .find(
          (candidate) =>
            candidate && !/[\p{Cs}\0]/u.test(candidate) && [...candidate].length <= 255,
        )
      if (!savedName) throw new PrototypeMetadataError("invalid_input", "Enter a prototype name.")
    }

    await repositories.updatePrototype(prototype.id, {
      name: savedName,
      description,
      startPage,
      ...(prototype.registeredAt ? {} : { authorId: viewer.userId, registeredAt: new Date() }),
    })
    const detail = await repositories.findDetail(input.repositoryId, input.prototypeId)
    if (!detail) throw new Error("The edited prototype is unavailable.")
    const currentViewer = await repositories.restoreSession(input.sessionDigest)
    if (!currentViewer || currentViewer.userId !== viewer.userId) {
      throw new PrototypeMetadataError("not_signed_in", "Sign in to continue.")
    }
    return detail
  })
}
