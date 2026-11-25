import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

const temporaryDirectory = process.env.TMPDIR
const status = await stat(temporaryDirectory)
const arguments_ = process.argv.slice(2)
const directoryIndex = arguments_.indexOf("--dir")
const directoryArgument = arguments_.find((argument) => argument.startsWith("--dir="))
const directory =
  directoryIndex !== -1 ? arguments_[directoryIndex + 1] : directoryArgument?.slice("--dir=".length)
let config
if (directory !== undefined) {
  try {
    config = await readFile(join(directory, "config.json"), "utf8")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}

const report = JSON.stringify({
  arguments: arguments_,
  config,
  environment: process.env,
  temporaryDirectory,
  temporaryDirectoryMode: status.mode & 0o777,
})
const failureIndex = arguments_.indexOf("--fixture-fail-report")
if (failureIndex !== -1) {
  await writeFile(arguments_[failureIndex + 1], report)
  process.stderr.write("error (invalid_request): fixture failure\n")
  process.exitCode = 2
} else {
  process.stdout.write(report)
}
