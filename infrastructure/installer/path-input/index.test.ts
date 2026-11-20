import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "vitest"

import { normalizeInstallerPath } from "./index.ts"

it("accepts pasted quoted paths without changing internal spaces or backslashes", () => {
  const path = "saved installations\\team hub\\installation.json"

  expect(normalizeInstallerPath(`  "${path}"  `)).toBe(resolve(path))
  expect(normalizeInstallerPath(` '${path}' `)).toBe(resolve(path))
  expect(normalizeInstallerPath(`  ${path}  `)).toBe(resolve(path))
  expect(normalizeInstallerPath(`\t "${path}" \r\n`)).toBe(resolve(path))
})

it.skipIf(process.platform === "win32")(
  "preserves literal Unix backslashes before spaces and punctuation in config paths",
  () => {
    const path = "saved\\ installations/team\\(hub\\)\\#one\\&two\\;three.json"

    expect(normalizeInstallerPath(path)).toBe(resolve(path))
    expect(normalizeInstallerPath(`\t'${path}'\n`)).toBe(resolve(path))
  },
)

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

it("rejects empty inputs and remaining internal controls after trimming surrounding whitespace", () => {
  for (const value of [
    undefined,
    42,
    "",
    "   ",
    '""',
    "''",
    "file\tname.json",
    "file\nname.json",
    "a\u0000b",
    "a\u007fb",
  ])
    expect(() => normalizeInstallerPath(value)).toThrow()
})
