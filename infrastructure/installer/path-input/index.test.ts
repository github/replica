import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "vitest"

import { normalizeInstallerPath } from "./index.ts"

it("accepts pasted quoted paths without changing internal spaces or backslashes", () => {
  const path = "saved installations\\team hub\\installation.json"

  expect(normalizeInstallerPath(`  "${path}"  `)).toBe(resolve(path))
  expect(normalizeInstallerPath(` '${path}' `)).toBe(resolve(path))
  expect(normalizeInstallerPath(`  ${path}  `)).toBe(resolve(path))
})

it("expands a home-relative path instead of resolving a literal tilde directory", () => {
  expect(normalizeInstallerPath("~/team hub/installation.json")).toBe(
    join(homedir(), "team hub", "installation.json"),
  )
})

it.skipIf(process.platform !== "win32")("accepts native home and slash variants on Windows", () => {
  expect(normalizeInstallerPath("~\\team hub\\installation.json")).toBe(
    join(homedir(), "team hub", "installation.json"),
  )
  expect(normalizeInstallerPath("C:/team hub/installation.json")).toBe(
    normalizeInstallerPath("C:\\team hub\\installation.json"),
  )
})

it("rejects empty inputs and controls rather than trimming them into accepted paths", () => {
  for (const value of [
    undefined,
    42,
    "",
    "   ",
    '""',
    "''",
    "\tfile.json",
    "file.json\n",
    "a\u0000b",
    "a\u007fb",
  ])
    expect(() => normalizeInstallerPath(value)).toThrow()
})
