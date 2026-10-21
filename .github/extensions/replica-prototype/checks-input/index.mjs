import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { lstat, open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { validateChecksConfig } from "../checks-config/index.mjs"
import { validateChecksGuidance } from "../checks-config/files.mjs"
import { matchesCheckFile as matches } from "../checks-file-matches/index.mjs"

const execute = promisify(execFile)
const MAX_BYTES = 64 * 1024 * 1024
const SECRET = /(^|\/)(\.env(?:\..*)?|\.npmrc|\.netrc|id_(?:rsa|ed25519)|[^/]*\.(?:pem|key))$/

export async function captureChecksInput(repositoryPath, baseline, selection) {
  const { stdout: topLevel } = await execute("git", ["rev-parse", "--show-toplevel"], {
    cwd: repositoryPath,
    timeout: 10000,
  })
  const root = await realpath(topLevel.trim())
  async function git(...args) {
    const { stdout } = await execute("git", args, {
      cwd: root,
      maxBuffer: MAX_BYTES,
      timeout: 10000,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    })
    return stdout
  }
  const [branch, head] = await Promise.all([
    git("branch", "--show-current"),
    git("rev-parse", "--verify", "HEAD"),
  ])
  if (!branch.trim()) throw new Error("Checks require a named prototype branch.")
  const manifestPath = path.join(root, ".replica/checks.json")
  try {
    if ((await realpath(manifestPath)) !== manifestPath)
      throw new Error("Checks configuration cannot be a symbolic link.")
  } catch (error) {
    if (error.code === "ENOENT") return { state: "unconfigured", branch: branch.trim() }
    throw error
  }
  const names = await git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
  const files = new Map()
  const versions = []
  let bytes = 0
  for (const name of [...new Set(names.split("\0").filter(Boolean))].sort()) {
    if (
      name.startsWith("/") ||
      name.split("/").some((part) => part === "..") ||
      name.includes("\\") ||
      name.includes("\n")
    )
      throw new Error("The checkout contains an unsupported file path.")
    if (
      SECRET.test(name) ||
      name.split("/").some((part) => part === ".git" || part === "node_modules")
    )
      continue
    let file
    let sourceStat
    try {
      const location = path.join(root, name)
      if ((await realpath(location)) !== location)
        throw new Error(`Checks cannot snapshot symbolic links: ${name}.`)
      sourceStat = await lstat(location)
      if (!sourceStat.isFile()) throw new Error(`Checks cannot snapshot nonregular files: ${name}.`)
      file = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    } catch (error) {
      if (error.code === "ENOENT") continue
      if (error.code === "ELOOP")
        throw new Error(`Checks cannot snapshot symbolic links: ${name}.`, { cause: error })
      throw error
    }
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error(`Checks cannot snapshot nonregular files: ${name}.`)
      if (
        stat.dev !== sourceStat.dev ||
        stat.ino !== sourceStat.ino ||
        (await realpath(path.join(root, name))) !== path.join(root, name)
      )
        throw new Error("Files changed while capturing checks. Retry.")
      bytes += stat.size
      if (stat.size > 8 * 1024 * 1024 || bytes > MAX_BYTES || files.size >= 10000)
        throw new Error("The checks snapshot exceeds its file or byte limit.")
      const buffer = Buffer.alloc(stat.size + 1)
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      if (offset !== stat.size) throw new Error("Files changed while capturing checks. Retry.")
      const content = buffer.subarray(0, offset)
      files.set(name, content)
      versions.push([name, stat.dev, stat.ino, stat.mtimeMs, stat.ctimeMs, stat.size])
    } finally {
      await file.close()
    }
  }
  const document = files.get(".replica/checks.json")
  if (!document) throw new Error("Track .replica/checks.json or remove it from Git ignore rules.")
  const config = validateChecksConfig(JSON.parse(document.toString("utf8")))
  const savedBase = baseline?.[`${branch.trim()}:${config.base}`]
  let pinnedBase = savedBase?.sha
  if (pinnedBase) {
    try {
      await git("merge-base", "--is-ancestor", pinnedBase, "HEAD")
    } catch (error) {
      if (error.code !== 1) throw error
      pinnedBase = undefined
    }
  }
  const base =
    pinnedBase ??
    (
      await git(
        "merge-base",
        "HEAD",
        (await git("rev-parse", "--verify", "--end-of-options", `${config.base}^{commit}`)).trim(),
      )
    ).trim()
  const baseFiles = new Map(
    (await git("ls-tree", "-r", "-z", base))
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("\t")
        return [entry.slice(separator + 1), entry.slice(0, separator).split(" ")[2]]
      }),
  )
  const changed = new Set()
  // Compare captured contents, not a moving git diff, including deletions and untracked inputs.
  for (const name of new Set([...baseFiles.keys(), ...files.keys()])) {
    if (
      SECRET.test(name) ||
      name === ".replica/checks.json" ||
      (config.ignore ?? []).some((pattern) => matches(pattern, name))
    )
      continue
    const content = files.get(name)
    if (!baseFiles.has(name)) {
      if (content) changed.add(name)
      continue
    }
    const oldHash = baseFiles.get(name)
    if (!content || blobHash(content, oldHash.length) !== oldHash) changed.add(name)
  }
  const pages = (config.pages ?? []).filter((page) =>
    [...changed].some((name) => page.inputs.some((pattern) => matches(pattern, name))),
  )
  const guidanceFiles = new Set(
    config.checks.flatMap((check) => [
      ...(check.context ?? []),
      ...(check.runner.type === "agent" ? [check.runner.instructions] : []),
    ]),
  )
  const unknown = [...changed].filter(
    (name) =>
      !guidanceFiles.has(name) &&
      !(config.pages ?? []).some((page) => page.inputs.some((pattern) => matches(pattern, name))),
  )
  const selectionKey = hash(
    JSON.stringify({
      base,
      branch: branch.trim(),
      pages: config.pages,
      changed: [...changed].map((name) => [name, files.has(name) ? hash(files.get(name)) : null]),
    }),
  )
  const resolved = selection?.key === selectionKey
  const selectedPages = resolved
    ? (config.pages ?? []).filter(
        (page) =>
          pages.some((included) => included.id === page.id) || selection.pageIds.includes(page.id),
      )
    : pages
  for (const check of config.checks) {
    for (const file of [
      ...(check.context ?? []),
      ...(check.runner.type === "agent" ? [check.runner.instructions] : []),
    ]) {
      validateChecksGuidance(files.get(file), file, check.id)
    }
  }
  const fingerprint = hash(
    JSON.stringify([
      branch.trim(),
      head.trim(),
      base,
      config,
      selectedPages.map((page) => page.id),
      [...files].map(([name, content]) => [name, hash(content)]),
    ]),
  )
  for (const [name, device, inode, modified, changedTime, size] of versions) {
    const current = await stat(path.join(root, name))
    if (
      current.dev !== device ||
      current.ino !== inode ||
      current.mtimeMs !== modified ||
      current.ctimeMs !== changedTime ||
      current.size !== size
    )
      throw new Error("Files changed while capturing checks. Retry after saving.")
  }
  const [finalHead, finalBranch, finalNames] = await Promise.all([
    git("rev-parse", "--verify", "HEAD"),
    git("branch", "--show-current"),
    git("ls-files", "-z", "--cached", "--others", "--exclude-standard"),
  ])
  if (finalHead !== head || finalBranch !== branch || finalNames !== names)
    throw new Error("The checkout changed while capturing checks. Retry.")
  return {
    repositoryPath: root,
    state:
      config.checks.some((check) => check.targets) && unknown.length && !resolved
        ? "scope_required"
        : config.checks.some((check) => !check.targets) || selectedPages.length
          ? "ready"
          : "no_pages",
    branch: branch.trim(),
    head: head.trim(),
    config,
    files,
    base,
    baseline: { branch: branch.trim(), ref: config.base, sha: base },
    pages: selectedPages,
    unknown,
    selectionKey,
    fingerprint,
    pageFiles: Object.fromEntries(
      selectedPages.map((page) => [
        page.id,
        [...files.keys()].filter((name) => page.inputs.some((pattern) => matches(pattern, name))),
      ]),
    ),
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex")
}

function blobHash(content, hashLength) {
  return createHash(hashLength === 64 ? "sha256" : "sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex")
}
