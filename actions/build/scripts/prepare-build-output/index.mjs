import { cp, lstat, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { requiredPathArgument } from "../required-path-argument/index.mjs"
import { normalizeBasePath } from "../normalize-base-path/index.mjs"
import { validateBuildOutput } from "../validate-build-output/index.mjs"

/** Copies a safe workspace-relative website into the package's fixed dist layout. */
export async function prepareBuildOutput(root, outputDirectory, destination, basePath = "/") {
  const base = normalizeBasePath(basePath)
  const workspace = path.resolve(root)
  const segments = outputDirectory.replace(/^\.\//, "").replace(/\/$/, "").split("/")
  if (
    !outputDirectory ||
    path.isAbsolute(outputDirectory) ||
    outputDirectory.includes("\\") ||
    outputDirectory.includes(":") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("output-directory must be a workspace-relative folder without traversal.")
  }

  const source = path.resolve(workspace, ...segments)
  const output = path.resolve(destination)
  if (
    output === workspace ||
    workspace.startsWith(`${output}${path.sep}`) ||
    output === source ||
    output.startsWith(`${source}${path.sep}`) ||
    source.startsWith(`${output}${path.sep}`)
  ) {
    throw new Error("Build output and temporary package directories must not overlap.")
  }

  let directory = workspace
  for (const segment of segments) {
    directory = path.join(directory, segment)
    let details
    try {
      details = await lstat(directory)
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        throw new Error(
          `Build output folder "${outputDirectory}" is missing. Build it first or correct output-directory.`,
          { cause: error },
        )
      }

      throw error
    }

    if (!details.isDirectory()) {
      throw new Error(
        `Build output folder "${outputDirectory}" and its parents must be directories, not symbolic links or files.`,
      )
    }
  }

  await validateBuildOutput(workspace, {}, outputDirectory)
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  await cp(source, path.join(output, "dist"), { recursive: true, verbatimSymlinks: true })
  if (base !== "/") {
    await writeFile(
      path.join(output, "dist", "replica-preview-base.json"),
      JSON.stringify({ basePath: base }),
      {
        flag: "wx",
      },
    )
  }
  return validateBuildOutput(output)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await prepareBuildOutput(
    requiredPathArgument("root"),
    requiredPathArgument("output-directory", { resolve: false }),
    requiredPathArgument("output"),
    process.argv.includes("--base-path")
      ? requiredPathArgument("base-path", { resolve: false })
      : undefined,
  )
  console.log(`Prepared dist/: ${result.files.length} files, ${result.bytes} bytes.`)
}
