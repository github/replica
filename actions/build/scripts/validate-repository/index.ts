import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { requireFile } from "../require-file/index.ts"
import { requiredPathArgument } from "../required-path-argument/index.ts"

/** Checks package.json, package-lock.json, and the required npm build command. */
export async function validateRepository(root: string) {
  await requireFile(root, "package.json")
  await requireFile(root, "package-lock.json")

  let packageData: unknown

  try {
    packageData = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Repository package.json must contain correctly formatted JSON.", {
        cause: error,
      })
    }

    throw error
  }

  if (
    !packageData ||
    typeof packageData !== "object" ||
    !("scripts" in packageData) ||
    !packageData.scripts ||
    typeof packageData.scripts !== "object" ||
    !("build" in packageData.scripts) ||
    typeof packageData.scripts.build !== "string" ||
    packageData.scripts.build.trim() === ""
  ) {
    throw new Error("Repository package.json must contain a non-empty scripts.build command.")
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await validateRepository(requiredPathArgument("root"))
  console.log(
    "Repository contains package.json, package-lock.json, and a non-empty scripts.build command.",
  )
}
