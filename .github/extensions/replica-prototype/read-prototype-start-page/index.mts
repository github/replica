import { constants } from "node:fs"
import { open } from "node:fs/promises"
import path from "node:path"
import { readErrorCode } from "../read-error-code/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"

const MAXIMUM_FILE_BYTES = 16_384

export async function readPrototypeStartPage(repositoryPath: string) {
  let file
  try {
    file = await open(
      path.join(repositoryPath, ".prototype"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAXIMUM_FILE_BYTES)
      throw new Error(".prototype must be a regular JSON file of at most 16 KiB.")
    const buffer = Buffer.alloc(MAXIMUM_FILE_BYTES + 1)
    const { bytesRead } = await file.read(buffer)
    if (bytesRead > MAXIMUM_FILE_BYTES) throw new Error(".prototype exceeds 16 KiB.")
    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead))
    return { localStartPage: parsePrototypeStartPage(content) }
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") return { localStartPage: null }
    return {
      localStartPage: null,
      localStartPageError: `Could not read .prototype: ${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    await file?.close()
  }
}

export function parsePrototypeStartPage(content: string) {
  const data = readHubObject(JSON.parse(content))
  const route = data?.startPage
  if (
    typeof route !== "string" ||
    Buffer.byteLength(route) > 2048 ||
    !route.startsWith("/") ||
    route.startsWith("//") ||
    route.includes("\\") ||
    Array.from(route).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 32 || code >= 127
    })
  )
    throw new Error("startPage must be a local route, including an optional query or fragment.")
  const pathname = decodeURIComponent(route.split(/[?#]/)[0] ?? "")
  if (
    pathname.startsWith("//") ||
    pathname.includes("\\") ||
    Array.from(pathname).some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    }) ||
    pathname.split("/").some((segment) => segment === "." || segment === "..") ||
    /^\/__replica(?:\/|$)/.test(pathname)
  )
    throw new Error("startPage contains an unsafe or reserved path.")
  return route
}
