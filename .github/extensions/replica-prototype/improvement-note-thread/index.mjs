import { githubLoginPattern, uuidPattern } from "../identity-patterns/index.mjs"
export const workStatuses = new Set(["open", "sent", "ready", "blocked"])
const requestStatuses = ["open", "sent", "blocked"]
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function isUnknownArray(value) {
  return Array.isArray(value)
}
function isWorkStatus(value) {
  return typeof value === "string" && workStatuses.has(value)
}
export function validMessageBody(body, role) {
  return (
    typeof body === "string" &&
    Boolean(body.trim()) &&
    (role === "copilot" ? body.length <= 2000 : Buffer.byteLength(body) <= 10_000)
  )
}
function invalid() {
  throw Object.assign(new Error("Invalid improvement conversation."), {
    statusCode: 422,
  })
}
function checkAuthor(author) {
  if (!isRecord(author)) invalid()
  const avatarUrl = author.avatarUrl
  if (
    typeof author.id !== "number" ||
    !Number.isSafeInteger(author.id) ||
    author.id < 1 ||
    typeof author.login !== "string" ||
    !githubLoginPattern.test(author.login) ||
    Object.keys(author).sort().join(",") !== "avatarUrl,id,login" ||
    (avatarUrl !== null &&
      (typeof avatarUrl !== "string" ||
        avatarUrl.length > 2048 ||
        !URL.canParse(avatarUrl) ||
        new URL(avatarUrl).protocol !== "https:" ||
        new URL(avatarUrl).hostname !== "avatars.githubusercontent.com" ||
        new URL(avatarUrl).username ||
        new URL(avatarUrl).password ||
        new URL(avatarUrl).port))
  )
    invalid()
}
function checkedThread(thread, localId) {
  if (
    !isRecord(thread) ||
    !isWorkStatus(thread.originalStatus) ||
    !isUnknownArray(thread.messages) ||
    Object.keys(thread).some(
      (key) => !["originalStatus", "messages", "originalAuthor"].includes(key),
    )
  )
    invalid()
  if (thread.originalAuthor !== undefined) checkAuthor(thread.originalAuthor)
  const ids = new Set([localId])
  const requests = new Set([localId])
  for (const message of thread.messages) {
    if (
      !isRecord(message) ||
      typeof message.id !== "string" ||
      !uuidPattern.test(message.id) ||
      ids.has(message.id) ||
      !validMessageBody(message.body, message.role)
    )
      invalid()
    ids.add(message.id)
    if (message.role === "author") {
      if (
        !isWorkStatus(message.status) ||
        Object.keys(message).some(
          (key) => !["id", "role", "body", "status", "author"].includes(key),
        )
      )
        invalid()
      requests.add(message.id)
      if (message.author !== undefined) checkAuthor(message.author)
    } else if (message.role === "copilot") {
      if (
        (message.status !== "ready" && message.status !== "blocked") ||
        !isUnknownArray(message.requestIds) ||
        !message.requestIds.length ||
        new Set(message.requestIds).size !== message.requestIds.length ||
        message.requestIds.some((id) => typeof id !== "string" || !requests.has(id)) ||
        Object.keys(message).some(
          (key) => !["id", "role", "body", "status", "requestIds"].includes(key),
        )
      )
        invalid()
    } else invalid()
  }
  return true
}
export function checkThread(thread, localId) {
  if (!checkedThread(thread, localId)) invalid()
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
  note.status = requestStatuses.find((value) => requestIds(note, value).length) ?? "ready"
}
