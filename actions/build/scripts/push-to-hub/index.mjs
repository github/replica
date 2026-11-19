import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

import { ARTIFACT_NAME, SCREENSHOTS_ARTIFACT_NAME } from "../constants.mjs"
import { createZipArchive } from "../create-zip-archive/index.mjs"
import { requestIdentityToken } from "../request-identity-token/index.mjs"

const MAX_RETRY_AFTER_SECONDS = 60

const KINDS = {
  build: { path: "/api/github/actions/builds", artifact: ARTIFACT_NAME, noun: "Build" },
  screenshots: {
    path: "/api/github/actions/screenshots",
    artifact: SCREENSHOTS_ARTIFACT_NAME,
    noun: "screenshots",
  },
}

/** Reads the Hub URL, allowing plain HTTP only for a Hub on this machine. */
export function parseHubUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`hub-url must be an absolute URL, such as https://hub.example.com.`)
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("hub-url must use https.")
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("hub-url must be an origin with no credentials, path, query, or fragment.")
  }
  return url
}

/** Returns the server's Retry-After, or bounded exponential backoff without a hint. */
export function retryDelaySeconds(response, retry, baseDelaySeconds, now = Date.now()) {
  const header = response?.headers.get("retry-after")
  if (header) {
    const seconds = /^\d+$/.test(header)
      ? Number(header)
      : Math.ceil((Date.parse(header) - now) / 1000)
    if (Number.isFinite(seconds)) return Math.max(seconds, 0)
  }
  return Math.min(baseDelaySeconds * 2 ** retry, MAX_RETRY_AFTER_SECONDS)
}

function isRetryable(status) {
  return status === 429 || status >= 500
}

function rejectionMessage(status, body, hub, kind) {
  const detail = typeof body?.message === "string" ? ` ${body.message}` : ""
  const at = `The Hub at ${hub}`
  if (status === 401) {
    return `${at} did not accept this workflow's identity.${detail} Check that hub-url is the Hub's public address and the job has "permissions: id-token: write".`
  }
  if (status === 403) return `${at} does not accept ${kind.noun} from this workflow.${detail}`
  if (status === 404) {
    return body?.error === "unknown_repository"
      ? `${at} is not connected to this repository. Connect it in the Hub, then re-run this job.`
      : `${at} does not accept pushed ${kind.noun}. Check hub-url and that the Hub is up to date.`
  }
  if (status === 409 && body?.error === "build_not_ready") {
    return `${at} has no successful Build for this commit, so it cannot attach screenshots.${detail}`
  }
  if (status === 409 && body?.error === "digest_mismatch") {
    return `${at} rejected these screenshots because they were captured from a different dist than its Build.`
  }
  if (status === 409) return `${at} did not accept this ${kind.noun}.${detail}`
  if (status === 413) return `The ${kind.noun} package is larger than the Hub at ${hub} accepts.`
  if (status === 415 || status === 422) {
    return `${at} rejected the ${kind.noun} package as invalid.${detail}`
  }
  return `${at} rejected the ${kind.noun} upload with HTTP ${status}.${detail}`
}

/**
 * Sends a package to the Hub. Network errors, timeouts, 429, and 5xx responses are
 * retried with backoff; the Hub imports each upload at most once, so retries are safe.
 */
export async function pushToHub({
  kind: kindName,
  directory,
  hubUrl,
  retries = 2,
  retryDelay = 15,
  timeout = 180,
  environment = process.env,
  wait = (seconds) => sleep(seconds * 1000),
  log = console.log,
}) {
  const kind = KINDS[kindName]
  if (!kind) throw new Error("kind must be build or screenshots.")
  for (const [name, value, minimum, maximum] of [
    ["hub-retries", retries, 0, 5],
    ["hub-retry-delay", retryDelay, 0, 60],
    ["hub-timeout", timeout, 1, 300],
  ]) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be a whole number from ${minimum} to ${maximum}.`)
    }
  }
  const hub = parseHubUrl(hubUrl)
  const origin = hub.origin
  const body = await createZipArchive(directory)
  const endpoint = new URL(kind.path, origin)
  let lastProblem
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const token = await requestIdentityToken(origin, environment)
    let response
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/zip" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeout * 1000),
      })
    } catch (error) {
      lastProblem = error.name === "TimeoutError" ? `no response within ${timeout}s` : error.message
    }
    if (response?.ok) {
      const result = await response.json().catch(() => null)
      const accepted = kindName === "build" ? ["imported", "unchanged"] : ["attached"]
      if (!accepted.includes(result?.status)) {
        throw new Error(
          `The Hub at ${origin} returned an invalid upload response. Check hub-url. The ${kind.artifact} artifact is retained; re-running the job is safe.`,
        )
      }
      return result
    }
    const responseBody = response ? await response.json().catch(() => null) : null
    if (response && !isRetryable(response.status)) {
      throw new Error(rejectionMessage(response.status, responseBody, origin, kind))
    }
    if (response) lastProblem = `HTTP ${response.status}`
    if (attempt < retries) {
      const delay = retryDelaySeconds(response, attempt, retryDelay)
      if (delay > MAX_RETRY_AFTER_SECONDS) {
        lastProblem += `; Retry-After requests ${delay}s, beyond the 60s retry wait limit`
        break
      }
      log(`The Hub at ${origin} is unavailable (${lastProblem}). Retrying in ${delay}s.`)
      await wait(delay)
    }
  }
  throw new Error(
    `The Hub at ${origin} is offline or cannot be contacted (${lastProblem}). Re-run this job when the Hub is available again; re-running is safe because the Hub imports each upload at most once. The ${kind.artifact} artifact from this run is kept for 3 days.`,
  )
}

function integerInput(name, value) {
  if (!/^\d+$/.test(value ?? "")) throw new Error(`${name} must be a whole number.`)
  return Number(value)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [kind, directory] = process.argv.slice(2)
    const result = await pushToHub({
      kind,
      directory,
      hubUrl: process.env.REPLICA_HUB_URL,
      retries: integerInput("hub-retries", process.env.REPLICA_HUB_RETRIES),
      retryDelay: integerInput("hub-retry-delay", process.env.REPLICA_HUB_RETRY_DELAY),
      timeout: integerInput("hub-timeout", process.env.REPLICA_HUB_TIMEOUT),
    })
    console.log(`Published ${KINDS[kind].noun} to the Hub (${result.status ?? "accepted"}).`)
  } catch (error) {
    console.log(`::error::${error.message}`)
    process.exitCode = 1
  }
}
