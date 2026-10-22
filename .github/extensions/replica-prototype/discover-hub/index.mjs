import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { normalizeHubOrigin } from "../normalize-hub-origin/index.mjs"
import { createPrivateStore } from "../private-store/index.mjs"
import { readCanvasRepository } from "../read-canvas-repository/index.mjs"
import { gitShaPattern } from "../identity-patterns/index.mjs"

const execFileAsync = promisify(execFile)
const TTL = 5 * 60_000
const CACHE_VERSION = 2
const FILE = ".github/replica.json"

async function runDiscoveryCommand(command, args, cwd) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: Infinity,
      timeout: 10_000,
      windowsHide: true,
    })
    return { ok: true, stdout }
  } catch (error) {
    return {
      ok: false,
      error:
        error.code === "ENOENT"
          ? `${command} is not installed.`
          : error.stderr?.trim() || error.message,
    }
  }
}

export async function discoverHub(context, options = {}) {
  const identity = await readCanvasRepository(context)
  if (identity.local) return { state: "local" }
  if (!identity.githubRepository)
    return {
      state: "unreachable",
      message: "Hub discovery requires a GitHub origin repository.",
    }
  const repository = identity.githubRepository.toLowerCase()
  const store = createPrivateStore(
    options.directory || path.join(os.homedir(), ".config", "replica", "canvas"),
  )
  const key = `${createHash("sha256").update(repository).digest("hex")}.discovery.json`
  return store.lock(key, async () => {
    const previous = await store.read(key)
    if (
      !options.force &&
      previous?.cacheVersion === CACHE_VERSION &&
      previous?.repository === repository &&
      Date.now() - previous.checkedAt < TTL
    )
      return previous
    const command = options.runCommand || runDiscoveryCommand
    const [owner, name] = repository.split("/")
    async function query(text, fields = []) {
      const result = await command(
        "gh",
        [
          "api",
          "--hostname",
          "github.com",
          "graphql",
          "-f",
          `query=${text}`,
          "-f",
          `owner=${owner}`,
          "-f",
          `name=${name}`,
          ...fields,
        ],
        context.repositoryPath,
      )
      if (!result.ok) throw new Error(`Repository configuration unavailable: ${result.error}`)
      const payload = JSON.parse(result.stdout)
      const data = payload.data?.repository
      if (payload.errors || data?.nameWithOwner?.toLowerCase() !== repository)
        throw new Error("GitHub could not verify the origin repository configuration.")
      return data
    }
    let result
    let sourceRevision
    let defaultBranch
    try {
      const metadata = await query(
        "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){nameWithOwner defaultBranchRef{name target{oid}}}}",
      )
      defaultBranch = metadata.defaultBranchRef?.name
      sourceRevision = metadata.defaultBranchRef?.target?.oid
      if (!defaultBranch || !gitShaPattern.test(sourceRevision || ""))
        throw new Error("GitHub did not return a default-branch commit.")
      const data = await query(
        "query($owner:String!,$name:String!,$expression:String!){repository(owner:$owner,name:$name){nameWithOwner object(expression:$expression){__typename ... on Blob{text byteSize isTruncated}}}}",
        ["-f", `expression=${sourceRevision}:${FILE}`],
      )
      if (data.object === null) {
        result = { state: "absent", fingerprint: "absent" }
      } else {
        const blob = data.object
        try {
          if (blob?.__typename !== "Blob" || blob.isTruncated || typeof blob.text !== "string")
            throw new Error(`${FILE} must be a complete JSON file.`)
          const value = JSON.parse(blob.text)
          const origin = value?.hub?.origin
          const fingerprint = createHash("sha256").update(blob.text).digest("hex")
          if (origin == null || (typeof origin === "string" && !origin.trim())) {
            result = { state: "absent", fingerprint }
          } else {
            if (typeof origin !== "string")
              throw new Error(`${FILE} hub.origin must be a URL string.`)
            result = {
              state: "valid",
              origin: normalizeHubOrigin(origin, `${FILE} hub.origin`),
              fingerprint,
            }
          }
        } catch (error) {
          result = {
            state: "invalid",
            message: `Invalid ${FILE}: ${error.message}`,
          }
        }
      }
    } catch (error) {
      result = { state: "unreachable", message: error.message }
    }
    const fingerprint = result.fingerprint || previous?.fingerprint
    const discovery = {
      ...result,
      cacheVersion: CACHE_VERSION,
      repository,
      defaultBranch,
      sourceRevision,
      lastVerifiedRevision:
        result.state === "unreachable" ? previous?.lastVerifiedRevision : sourceRevision,
      fingerprint,
      changed: Boolean(
        previous?.fingerprint && result.fingerprint && previous.fingerprint !== result.fingerprint,
      ),
      checkedAt: Date.now(),
    }
    await store.write(key, discovery)
    return discovery
  })
}
