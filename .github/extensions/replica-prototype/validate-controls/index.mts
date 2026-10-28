import { ControlsValidationError, validateControlsDocument } from "../assets/controls-validator.mjs"
import type { ControlsValidationIssue } from "../assets/controls-validator.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"

const MAX_BYTES = 256_000
const MAX_ISSUES = 50

export type ControlsValidationResult = {
  status: "valid" | "invalid" | "missing"
  url: string
  issues: ControlsValidationIssue[]
  truncated?: boolean
}

/** Validates the definitions the running prototype actually serves, as the Controls panel loads them. */
export async function validateControls(
  prototypeUrl: string,
  request = globalThis.fetch,
): Promise<ControlsValidationResult> {
  const url = new URL("/controls.replica.json", prototypeUrl).href
  let response
  try {
    response = await request(url, {
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
  } catch (error) {
    throw new Error(
      `Could not reach the prototype server. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  // Dev servers commonly answer unknown paths with their HTML app shell.
  if (
    response.status === 404 ||
    response.status === 410 ||
    (response.ok && /text\/html/i.test(response.headers.get("content-type") ?? ""))
  ) {
    await response.body?.cancel()
    return { status: "missing", url, issues: [] }
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`The prototype server returned HTTP ${response.status} for ${url}.`)
  }

  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        const value: unknown = chunk.value
        if (!(value instanceof Uint8Array))
          throw new Error("The prototype server returned an invalid response stream.")
        byteLength += value.byteLength
        if (byteLength > MAX_BYTES) {
          await reader.cancel()
          return invalid(url, [{ path: "/", message: "exceeds the 256,000-byte limit" }])
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let document: unknown
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    return invalid(url, [
      {
        path: "/",
        message: `is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    ])
  }

  try {
    validateControlsDocument(document)
  } catch (error) {
    if (!(error instanceof ControlsValidationError)) throw error
    return invalid(url, error.issues)
  }
  return { status: "valid", url, issues: [] }
}

function invalid(url: string, issues: ControlsValidationIssue[]): ControlsValidationResult {
  return {
    status: "invalid",
    url,
    issues: issues.slice(0, MAX_ISSUES).map(({ path, message }) => ({
      path: plainText(path, 256) || "/",
      message: plainText(message, 500),
    })),
    ...(issues.length > MAX_ISSUES && { truncated: true }),
  }
}

/** Issue text can echo the served document, so keep it to bounded single-line plain text. */
export function plainText(value: unknown, limit: number) {
  const text = String(value ?? "")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/** Returns only the expected validation fields, so the canvas action never relays anything else. */
export function projectValidation(input: unknown) {
  const result = readHubObject(input)
  if (
    !result ||
    typeof result !== "object" ||
    (result.status !== "valid" && result.status !== "invalid" && result.status !== "missing") ||
    typeof result.url !== "string" ||
    !Array.isArray(result.issues)
  )
    throw new Error("The controls validator returned an unexpected result.")
  return {
    status: result.status,
    url: result.url,
    origin: new URL(result.url).origin,
    issues: result.issues.slice(0, MAX_ISSUES).map((input: unknown) => ({
      path: plainText(readHubObject(input)?.path, 256) || "/",
      message: plainText(readHubObject(input)?.message, 500),
    })),
    ...(result.truncated === true && { truncated: true }),
  }
}
