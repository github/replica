import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { normalizeHubOrigin } from "../normalize-hub-origin/index.mjs"
import { createPrivateStore } from "../private-store/index.mjs"
import { readCanvasRepository } from "../read-canvas-repository/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"
import { readHubError } from "../read-hub-error/index.mjs"
import { readErrorCode } from "../read-error-code/index.mjs"
import { gitShaPattern } from "../identity-patterns/index.mjs"
import type { HubContext } from "../create-hub-client/index.mjs"
import type { CommandResult } from "../run-command/index.mjs"

export type HubDiscoveryOptions = {
  directory?: string
  force?: boolean
  runCommand?: (command: string, args: string[], cwd: string) => Promise<CommandResult>
}
type DiscoveryResult =
  | { state: "local" }
  | { state: "valid"; origin: string; fingerprint?: string }
  | { state: "absent"; fingerprint?: string }
  | { state: "invalid" | "unreachable"; message: string }
export type HubDiscovery = DiscoveryResult & {
  cacheVersion?: number
  repository?: string
  defaultBranch?: string
  sourceRevision?: string
  lastVerifiedRevision?: string
  fingerprint?: string
  changed?: boolean
  checkedAt?: number
}

const execFileAsync = promisify(execFile)
const TTL = 5 * 60_000
const CACHE_VERSION = 2
const FILE = ".github/replica.json"

async function runDiscoveryCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
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
    const stderr = error instanceof Error && "stderr" in error ? error.stderr : undefined
    return {
      ok: false,
      error:
        readErrorCode(error) === "ENOENT"
          ? `${command} is not installed.`
          : (typeof stderr === "string" && stderr.trim()) || readHubError(error).message,
    }
  }
}

export async function discoverHub(
  context: HubContext,
  options: HubDiscoveryOptions = {},
): Promise<HubDiscovery> {
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
    const previous = readHubObject(await store.read(key))
    if (
      !options.force &&
      previous?.cacheVersion === CACHE_VERSION &&
      previous?.repository === repository &&
      typeof previous.checkedAt === "number" &&
      Date.now() - previous.checkedAt < TTL
    )
      return readDiscovery(previous)
    const command = options.runCommand || runDiscoveryCommand
    const [owner, name] = repository.split("/")
    async function query(text: string, fields: string[] = []) {
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
      const payload = readHubObject(JSON.parse(result.stdout))
      const data = readHubObject(readHubObject(payload?.data)?.repository)
      if (
        payload?.errors ||
        typeof data?.nameWithOwner !== "string" ||
        data.nameWithOwner.toLowerCase() !== repository
      )
        throw new Error("GitHub could not verify the origin repository configuration.")
      return data
    }
    let result: Exclude<DiscoveryResult, { state: "local" }>
    let sourceRevision: string | undefined
    let defaultBranch: string | undefined
    try {
      const metadata = await query(
        "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){nameWithOwner defaultBranchRef{name target{oid}}}}",
      )
      const branch = readHubObject(metadata.defaultBranchRef)
      const oid = readHubObject(branch?.target)?.oid
      defaultBranch = typeof branch?.name === "string" ? branch.name : undefined
      sourceRevision = typeof oid === "string" ? oid : undefined
      if (!defaultBranch || !gitShaPattern.test(sourceRevision || ""))
        throw new Error("GitHub did not return a default-branch commit.")
      const data = await query(
        "query($owner:String!,$name:String!,$expression:String!){repository(owner:$owner,name:$name){nameWithOwner object(expression:$expression){__typename ... on Blob{text byteSize isTruncated}}}}",
        ["-f", `expression=${sourceRevision}:${FILE}`],
      )
      if (data.object === null) {
        result = { state: "absent", fingerprint: "absent" }
      } else {
        const blob = readHubObject(data.object)
        try {
          if (blob?.__typename !== "Blob" || blob.isTruncated || typeof blob.text !== "string")
            throw new Error(`${FILE} must be a complete JSON file.`)
          const value = readHubObject(JSON.parse(blob.text))
          const origin = readHubObject(value?.hub)?.origin
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
            message: `Invalid ${FILE}: ${readHubError(error).message}`,
          }
        }
      }
    } catch (error) {
      result = { state: "unreachable", message: readHubError(error).message }
    }
    const resultFingerprint = "fingerprint" in result ? result.fingerprint : undefined
    const previousFingerprint =
      typeof previous?.fingerprint === "string" ? previous.fingerprint : undefined
    const fingerprint = resultFingerprint || previousFingerprint
    const discovery = {
      ...result,
      cacheVersion: CACHE_VERSION,
      repository,
      defaultBranch,
      sourceRevision,
      lastVerifiedRevision:
        result.state === "unreachable"
          ? typeof previous?.lastVerifiedRevision === "string"
            ? previous.lastVerifiedRevision
            : undefined
          : sourceRevision,
      fingerprint,
      changed: Boolean(
        previousFingerprint && resultFingerprint && previousFingerprint !== resultFingerprint,
      ),
      checkedAt: Date.now(),
    }

    await store.write(key, discovery)
    return discovery
  })
}

function readDiscovery(value: unknown): HubDiscovery {
  const record = readHubObject(value)
  if (!record) throw new Error("Invalid stored canvas Hub discovery.")
  const metadata = {
    cacheVersion: typeof record.cacheVersion === "number" ? record.cacheVersion : undefined,
    repository: typeof record.repository === "string" ? record.repository : undefined,
    defaultBranch: typeof record.defaultBranch === "string" ? record.defaultBranch : undefined,
    sourceRevision: typeof record.sourceRevision === "string" ? record.sourceRevision : undefined,
    lastVerifiedRevision:
      typeof record.lastVerifiedRevision === "string" ? record.lastVerifiedRevision : undefined,
    fingerprint: typeof record.fingerprint === "string" ? record.fingerprint : undefined,
    checkedAt: typeof record.checkedAt === "number" ? record.checkedAt : undefined,
    changed: typeof record.changed === "boolean" ? record.changed : undefined,
  }
  switch (record.state) {
    case "valid":
      if (typeof record.origin === "string" && typeof record.fingerprint === "string")
        return {
          ...metadata,
          state: "valid",
          origin: record.origin,
          fingerprint: record.fingerprint,
        }
      break
    case "absent":
      if (typeof record.fingerprint === "string")
        return { ...metadata, state: "absent", fingerprint: record.fingerprint }
      break
    case "invalid":
    case "unreachable":
      if (typeof record.message === "string")
        return { ...metadata, state: record.state, message: record.message }
      break
    case "local":
      return { ...metadata, state: "local" }
  }
  throw new Error("Invalid stored canvas Hub discovery.")
}
