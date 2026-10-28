import { createHash, randomBytes } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { createPrivateStore } from "../private-store/index.mjs"
import { gitShaPattern } from "../identity-patterns/index.mjs"
import { runCommand } from "../run-command/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"
import { readHubError } from "../read-hub-error/index.mjs"
function anchor(input) {
  const value = readHubObject(input)
  if (!value || (value.kind !== "element" && value.kind !== "area"))
    throw Object.assign(new Error("Select a valid local preview target."), {
      statusCode: 422,
    })
  return { ...value, kind: value.kind }
}
function storedDraft(input) {
  const value = readHubObject(input)
  const comment = readHubObject(value?.comment)
  const author = readHubObject(comment?.author)
  const savedAnchor = readHubObject(comment?.anchor)
  if (
    !value ||
    !comment ||
    !author ||
    !savedAnchor ||
    (savedAnchor.kind !== "element" && savedAnchor.kind !== "area") ||
    typeof value.treeSha !== "string" ||
    !gitShaPattern.test(value.treeSha) ||
    (value.prototypeId !== null &&
      (typeof value.prototypeId !== "number" ||
        !Number.isSafeInteger(value.prototypeId) ||
        value.prototypeId < 1)) ||
    typeof comment.id !== "number" ||
    !Number.isSafeInteger(comment.id) ||
    comment.id < 1 ||
    comment.kind !== "root" ||
    typeof comment.body !== "string" ||
    !comment.body.trim() ||
    Buffer.byteLength(comment.body) > 10_000 ||
    typeof comment.draftRevisionId !== "number" ||
    !Number.isSafeInteger(comment.draftRevisionId) ||
    comment.draftRevisionId < 1 ||
    typeof comment.createdAt !== "string" ||
    !Number.isFinite(Date.parse(comment.createdAt)) ||
    typeof comment.updatedAt !== "string" ||
    (comment.editedAt !== null && typeof comment.editedAt !== "string") ||
    typeof comment.viewerCanEdit !== "boolean" ||
    typeof author.login !== "string" ||
    (author.name !== null && typeof author.name !== "string") ||
    (author.avatarUrl !== null && typeof author.avatarUrl !== "string") ||
    (value.sendingAt !== undefined &&
      (typeof value.sendingAt !== "string" || !Number.isFinite(Date.parse(value.sendingAt)))) ||
    (value.sendingAt === undefined) !== (value.sendingBuildNumber === undefined) ||
    (value.sendingBuildNumber !== undefined &&
      (typeof value.sendingBuildNumber !== "number" ||
        !Number.isSafeInteger(value.sendingBuildNumber) ||
        value.sendingBuildNumber < 1))
  )
    throw new Error("Invalid saved local review comment.")
  return {
    ...value,
    treeSha: value.treeSha,
    prototypeId: value.prototypeId,
    sendingAt: value.sendingAt,
    sendingBuildNumber: value.sendingBuildNumber,
    comment: {
      ...comment,
      id: comment.id,
      kind: "root",
      body: comment.body,
      anchor: { ...savedAnchor, kind: savedAnchor.kind },
      draftRevisionId: comment.draftRevisionId,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      editedAt: comment.editedAt,
      viewerCanEdit: comment.viewerCanEdit,
      author: {
        login: author.login,
        name: author.name,
        avatarUrl: author.avatarUrl,
      },
    },
  }
}
export function createLocalReviewComments(context, options = {}) {
  const store = createPrivateStore(
    options.directory || path.join(os.homedir(), ".config", "replica", "canvas", "local-comments"),
  )
  function filename(scope) {
    if (!scope.hubOrigin || !scope.repository || !scope.branch || !scope.viewerLogin)
      throw new Error("Connect to a named branch before saving local comments.")
    return `${createHash("sha256")
      .update(
        JSON.stringify([
          context.repositoryPath,
          scope.hubOrigin,
          scope.repository,
          scope.branch,
          scope.viewerLogin,
        ]),
      )
      .digest("hex")}.json`
  }
  function validateBody(body) {
    if (typeof body !== "string" || !body.trim() || Buffer.byteLength(body) > 10_000)
      throw Object.assign(new Error("Comments must contain between 1 and 10000 bytes."), {
        statusCode: 422,
      })
    return body.trim()
  }
  async function entries(scope) {
    const saved = await store.read(filename(scope))
    if (saved === null) return []
    if (!Array.isArray(saved)) throw new Error("Invalid saved local review comments.")
    return saved.map(storedDraft)
  }
  async function mutate(scope, action) {
    const file = filename(scope)
    return store.lock(file, async () => {
      const drafts = await entries(scope)
      const result = await action(drafts)
      await store.write(file, drafts)
      return result
    })
  }
  function editable(drafts, id, discarding = false) {
    const draft = drafts.find((entry) => entry.comment.id === Number(id))
    if (!draft)
      throw Object.assign(new Error("Local comment not found."), {
        statusCode: 404,
      })
    if (draft.sendingAt && !discarding)
      throw new Error("Check Hub before changing this comment: its upload could not be confirmed.")
    return draft
  }
  function withAuthor(scope, comment) {
    if (
      scope.author?.login?.toLowerCase() !== scope.viewerLogin.toLowerCase() ||
      comment.author.login.toLowerCase() !== scope.viewerLogin.toLowerCase()
    )
      return comment
    return {
      ...comment,
      author: {
        ...comment.author,
        name: scope.author.name ?? comment.author.name,
        avatarUrl: scope.author.avatarUrl ?? comment.author.avatarUrl,
      },
    }
  }
  return {
    async list(scope) {
      return (await entries(scope)).map((entry) => ({
        ...withAuthor(scope, entry.comment),
        viewerCanEdit: !entry.sendingAt,
      }))
    },
    async create(scope, revision, attributes) {
      const body = validateBody(attributes.body)
      if (
        !Number.isSafeInteger(revision.id) ||
        revision.id < 1 ||
        !gitShaPattern.test(revision.treeSha) ||
        !attributes.anchor
      )
        throw Object.assign(new Error("Select a valid local preview target."), {
          statusCode: 422,
        })
      const selectedAnchor = anchor(attributes.anchor)
      return mutate(scope, (drafts) => {
        const now = new Date().toISOString()
        const comment = withAuthor(scope, {
          id: 2 ** 48 + randomBytes(6).readUIntBE(0, 6),
          kind: "root",
          body,
          anchor: selectedAnchor,
          buildNumber: null,
          buildPath: null,
          draftRevisionId: revision.id,
          createdAt: now,
          updatedAt: now,
          editedAt: null,
          deletedAt: null,
          author: { login: scope.viewerLogin, name: null, avatarUrl: null },
          viewerCanEdit: true,
          viewerCanDelete: true,
          reactions: [],
          resolvedAt: null,
          resolvedBy: null,
          activityVersion: 1,
          viewerLastSeenActivityVersion: 1,
        })
        drafts.push({
          treeSha: revision.treeSha,
          prototypeId: revision.prototypeId ?? null,
          comment,
        })
        return comment
      })
    },
    async update(scope, id, body) {
      const text = validateBody(body)
      return mutate(scope, (drafts) => {
        const draft = editable(drafts, id)
        const now = new Date().toISOString()
        draft.comment = withAuthor(scope, {
          ...draft.comment,
          body: text,
          editedAt: now,
          updatedAt: now,
        })
        return draft.comment
      })
    },
    async remove(scope, id) {
      return mutate(scope, (drafts) => {
        const draft = editable(drafts, id, true)
        drafts.splice(drafts.indexOf(draft), 1)
        return {
          ...draft.comment,
          body: null,
          deletedAt: new Date().toISOString(),
        }
      })
    },
    async sync(scope, build, hub) {
      if (!(await entries(scope)).length) return
      if (!gitShaPattern.test(build.commitSha))
        throw new Error("Hub returned an invalid Build commit.")
      if (!Number.isFinite(Date.parse(build.publishedAt)))
        throw new Error("Hub did not return the Build publication time.")
      const tree = await runCommand(
        "git",
        ["rev-parse", `${build.commitSha}^{tree}`],
        context.repositoryPath,
      )
      if (!tree.ok) throw new Error("Fetch the published Build commit to sync local comments.")
      const file = filename(scope)
      await store.lock(file, async () => {
        const drafts = await entries(scope)
        const base = `/api/canvas/repositories/${build.repositoryId}/prototypes/${build.prototypeId}/review_comments`
        for (const draft of [...drafts]) {
          if (draft.prototypeId !== null && draft.prototypeId !== build.prototypeId) continue
          if (draft.treeSha !== tree.stdout.trim()) continue
          if (Date.parse(build.publishedAt) < Date.parse(draft.comment.createdAt)) continue
          if (draft.sendingAt) {
            const remote = await hub.request(base, {
              expectedTarget: scope,
              connectionScope: { identity: scope.connectionId },
            })
            if (!Array.isArray(remote.comments))
              throw new Error("Hub returned invalid review comments.")
            const saved = remote.comments.some((input) => {
              const comment = readHubObject(input)
              return Boolean(
                comment &&
                comment.kind === "root" &&
                comment.buildNumber === draft.sendingBuildNumber &&
                readHubObject(comment.author)?.login === scope.viewerLogin &&
                comment.body === draft.comment.body &&
                isDeepStrictEqual(comment.anchor, draft.comment.anchor) &&
                typeof comment.createdAt === "string" &&
                Date.parse(comment.createdAt) >= Date.parse(draft.sendingAt ?? "") - 1000,
              )
            })
            if (!saved)
              throw new Error(
                "A local comment upload could not be confirmed. Check the published review, then discard the local copy before saving it again if needed.",
              )
          } else {
            draft.sendingAt = new Date().toISOString()
            draft.sendingBuildNumber = build.number
            await store.write(file, drafts)
            try {
              const result = await hub.request(base, {
                method: "POST",
                interactive: true,
                expectedTarget: scope,
                connectionScope: { identity: scope.connectionId },
                body: {
                  review_comment: {
                    build_number: build.number,
                    body: draft.comment.body,
                    anchor: draft.comment.anchor,
                  },
                },
              })
              if (
                !Array.isArray(result.comments) ||
                !result.comments.some((input) => {
                  const comment = readHubObject(input)
                  return comment?.kind === "root" && comment.buildNumber === build.number
                })
              )
                throw new Error("Hub did not confirm the saved comment.")
            } catch (caught) {
              const error = readHubError(caught)
              // An HTTP rejection confirms no save; transport failures require reconciliation.
              if (
                typeof error.statusCode === "number" &&
                error.statusCode >= 400 &&
                error.statusCode < 500
              ) {
                delete draft.sendingAt
                delete draft.sendingBuildNumber
                await store.write(file, drafts)
              }
              throw error
            }
          }
          drafts.splice(drafts.indexOf(draft), 1)
          await store.write(file, drafts)
        }
      })
    },
  }
}
