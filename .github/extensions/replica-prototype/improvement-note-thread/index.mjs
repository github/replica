import { githubLoginPattern, uuidPattern } from "../identity-patterns/index.mjs"

export const workStatuses = new Set(["open", "sent", "ready", "blocked"])

export function validMessageBody(body, role) {
  return (
    typeof body === "string" &&
    Boolean(body.trim()) &&
    (role === "copilot" ? body.length <= 2000 : Buffer.byteLength(body) <= 10_000)
  )
}

export function checkThread(thread, localId) {
  function invalid() {
    throw Object.assign(new Error("Invalid improvement conversation."), {
      statusCode: 422,
    })
  }
  if (
    !thread ||
    !workStatuses.has(thread.originalStatus) ||
    !Array.isArray(thread.messages) ||
    Object.keys(thread).some(
      (key) => !["originalStatus", "messages", "originalAuthor"].includes(key),
    )
  )
    invalid()
  function checkAuthor(author) {
    if (
      !author ||
      !Number.isSafeInteger(author.id) ||
      author.id < 1 ||
      typeof author.login !== "string" ||
      !githubLoginPattern.test(author.login) ||
      Object.keys(author).sort().join(",") !== "avatarUrl,id,login" ||
      (author.avatarUrl !== null &&
        (typeof author.avatarUrl !== "string" ||
          author.avatarUrl.length > 2048 ||
          !URL.canParse(author.avatarUrl) ||
          new URL(author.avatarUrl).protocol !== "https:" ||
          new URL(author.avatarUrl).hostname !== "avatars.githubusercontent.com" ||
          new URL(author.avatarUrl).username ||
          new URL(author.avatarUrl).password ||
          new URL(author.avatarUrl).port))
    )
      invalid()
  }
  if (thread.originalAuthor !== undefined) checkAuthor(thread.originalAuthor)
  const ids = new Set([localId])
  const requests = new Set([localId])
  for (const message of thread.messages) {
    if (
      !message ||
      typeof message.id !== "string" ||
      !uuidPattern.test(message.id) ||
      ids.has(message.id) ||
      !validMessageBody(message.body, message.role)
    )
      invalid()
    ids.add(message.id)
    if (message.role === "author") {
      if (
        !workStatuses.has(message.status) ||
        Object.keys(message).some(
          (key) => !["id", "role", "body", "status", "author"].includes(key),
        )
      )
        invalid()
      requests.add(message.id)
      if (message.author !== undefined) checkAuthor(message.author)
    } else if (message.role === "copilot") {
      if (
        !["ready", "blocked"].includes(message.status) ||
        !Array.isArray(message.requestIds) ||
        !message.requestIds.length ||
        new Set(message.requestIds).size !== message.requestIds.length ||
        message.requestIds.some((id) => !requests.has(id)) ||
        Object.keys(message).some(
          (key) => !["id", "role", "body", "status", "requestIds"].includes(key),
        )
      )
        invalid()
    } else invalid()
  }
  return thread
}

export function requestIds(note, status) {
  return [
    ...(note.thread.originalStatus === status ? [note.localId] : []),
    ...note.thread.messages
      .filter((message) => message.role === "author" && message.status === status)
      .map((message) => message.id),
  ]
}

export function updateRequests(note, ids, status) {
  if (ids.includes(note.localId)) note.thread.originalStatus = status
  for (const message of note.thread.messages) {
    if (message.role === "author" && ids.includes(message.id)) message.status = status
  }
  note.status =
    ["open", "sent", "blocked"].find((value) => requestIds(note, value).length) ?? "ready"
}
