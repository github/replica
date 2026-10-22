import { createHash } from "node:crypto"
import path from "node:path"
import { readRepositoryName } from "../read-repository-name/index.mjs"
import { runCommand } from "../run-command/index.mjs"
export async function createCanvasContext({
  prototypeUrl,
  name,
  repository,
  branch,
  commitSha,
  publishedUrl,
  sessionId,
  sessionWorkspacePath,
  repositoryPath,
}) {
  if (!sessionWorkspacePath) {
    throw new Error(
      "This Copilot session has no workspace path, so Replica prototype state cannot be stored.",
    )
  }
  if (!repositoryPath) {
    throw new Error(
      "This Copilot session has no working directory, so repository status cannot be read.",
    )
  }
  const normalizedUrl = normalizePrototypeUrl(prototypeUrl)
  const stateUrl = new URL(normalizedUrl)
  stateUrl.hash = ""
  const resolvedRepositoryPath = path.resolve(repositoryPath)
  const target = await resolvePublishTarget({
    repository,
    branch,
    commitSha,
    publishedUrl,
    repositoryPath: resolvedRepositoryPath,
  })
  const stateId = createHash("sha256")
    .update(
      [
        path.resolve(sessionWorkspacePath),
        stateUrl.toString(),
        target.repository || "",
        target.branch || "",
        target.commitSha || "",
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 24)
  const stateDirectory = path.join(sessionWorkspacePath, "replica-prototype")
  return {
    name: normalizeName(name, normalizedUrl),
    normalizedUrl,
    sessionId,
    repositoryPath: resolvedRepositoryPath,
    target,
    sessionWorkspacePath: path.resolve(sessionWorkspacePath),
    stateDirectory,
    stateFile: path.join(stateDirectory, `${stateId}.json`),
    stateId,
    urlHost: new URL(normalizedUrl).host,
  }
}
// Keep stored publish state tied to the branch currently shown in the canvas.
export async function currentCanvasContext(context) {
  const [repository, branch] = await Promise.all([
    readRepositoryName(context.repositoryPath),
    runCommand("git", ["branch", "--show-current"], context.repositoryPath),
  ])
  const currentRepository =
    (isLocalRepositoryCheckout(context.target.repository, context.repositoryPath)
      ? context.target.repository
      : repository.repository) ||
    (repository.error === "The origin remote is not a GitHub repository."
      ? null
      : context.target.repository)
  const currentBranch = branch.ok ? branch.stdout.replace(/\r?\n$/, "") || null : null
  if (currentRepository === context.target.repository && currentBranch === context.target.branch)
    return context
  return createCanvasContext({
    prototypeUrl: context.normalizedUrl,
    name: context.name,
    repository: currentRepository,
    branch: currentBranch,
    publishedUrl: context.target.publishedUrl,
    sessionId: context.sessionId,
    sessionWorkspacePath: context.sessionWorkspacePath,
    repositoryPath: context.repositoryPath,
  })
}
function normalizePrototypeUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error("prototypeUrl must be a valid HTTP or HTTPS URL.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("prototypeUrl must use HTTP or HTTPS.")
  }
  url.hostname = url.hostname.toLowerCase()
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = ""
  }
  return url.toString()
}
function normalizeName(name, normalizedUrl) {
  if (name === undefined) {
    return new URL(normalizedUrl).hostname
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("name must contain visible text.")
  }
  return name.trim()
}
async function resolvePublishTarget({
  repository,
  branch,
  commitSha,
  publishedUrl,
  repositoryPath,
}) {
  const [resolvedRepository, branchResult] = await Promise.all([
    resolveRepository(repository, repositoryPath),
    runCommand("git", ["branch", "--show-current"], repositoryPath),
  ])
  const [hintedBranch, checkoutBranch] = await Promise.all([
    normalizeBranch(branch, repositoryPath),
    branchResult.ok
      ? normalizeBranch(branchResult.stdout.replace(/\r?\n$/, "") || null, repositoryPath)
      : null,
  ])
  if (branch != null && branchResult.ok && hintedBranch !== checkoutBranch) {
    throw new Error("branch does not match the current checkout.")
  }
  return {
    repository: resolvedRepository,
    branch: hintedBranch ?? checkoutBranch,
    commitSha: normalizeCommitSha(commitSha),
    publishedUrl: normalizeOptionalUrl(publishedUrl, "publishedUrl"),
  }
}
export async function resolveRepository(hint, repositoryPath) {
  const repository = normalizeRepository(hint)
  const checkout = await readRepositoryName(repositoryPath)
  const checkoutRepository = normalizeRepository(checkout.repository)
  if (repository && repository !== checkoutRepository) {
    if (isLocalRepositoryCheckout(repository, repositoryPath)) return repository
    if (repository.startsWith("local/")) {
      throw new Error("A local repository hint requires its matching .local/prototypes checkout.")
    }
    if (checkoutRepository) {
      throw new Error("repository does not match the current checkout origin.")
    }
    if (checkout.error === "The origin remote is not a GitHub repository.") {
      throw new Error(`Cannot verify repository hint: ${checkout.error}`)
    }
  }
  return repository ?? checkoutRepository
}
function isLocalRepositoryCheckout(repository, repositoryPath) {
  const localRoot = path.dirname(repositoryPath)
  return (
    repository === `local/${path.basename(repositoryPath)}` &&
    path.basename(localRoot) === "prototypes" &&
    path.basename(path.dirname(localRoot)) === ".local"
  )
}
function normalizeRepository(value) {
  if (value == null) {
    return null
  }
  if (typeof value !== "string") {
    throw new Error("repository must use GitHub owner/name format.")
  }
  const parts = value.split("/")
  const [owner, name] = parts
  if (
    parts.length !== 2 ||
    !owner ||
    !name ||
    owner.length > 39 ||
    name.length > 100 ||
    name === "." ||
    name === ".." ||
    !/^[a-z0-9-]+$/i.test(owner) ||
    !/^[a-z0-9_.-]+$/i.test(name)
  ) {
    throw new Error("repository must use GitHub owner/name format.")
  }
  return value.toLowerCase()
}
export async function normalizeBranch(value, repositoryPath) {
  if (value === "HEAD") return null
  if (value == null) {
    return null
  }
  if (typeof value !== "string" || value.trim() === "" || value.length > 255) {
    throw new Error("branch must contain between 1 and 255 characters.")
  }
  if (
    value.trim() !== value ||
    /\s/u.test(value) ||
    /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}\uFEFF]/u.test(value) ||
    value.includes("@{")
  ) {
    throw new Error("branch must be a valid Git branch name.")
  }
  const checked = await runCommand("git", ["check-ref-format", "--branch", value], repositoryPath)
  if (!checked.ok) {
    if (checked.error === "git is not installed.") {
      throw new Error("Cannot validate branch: git is not installed.")
    }
    throw new Error("branch must be a valid Git branch name.")
  }
  return value
}
function normalizeCommitSha(value) {
  if (value == null) {
    return null
  }
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("commitSha must be a full lowercase Git commit SHA.")
  }
  return value
}
function normalizeOptionalUrl(value, name) {
  if (value == null) {
    return null
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL.`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`)
  }
  return url.toString()
}
