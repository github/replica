import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readErrorCode } from "../read-error-code/index.mjs"
const execFileAsync = promisify(execFile)
export async function runCommand(command, args, cwd, options = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
      env: options.env,
    })
    return { ok: true, stdout }
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") {
      return { ok: false, error: `${command} is not installed.` }
    }
    const stdout =
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof error.stdout === "string"
        ? error.stdout
        : ""
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr
        : ""
    const detail = stderr.trim()
      ? stderr.trim()
      : error instanceof Error
        ? error.message
        : String(error)
    return {
      ok: false,
      error: detail,
      exitCode: readErrorCode(error),
      stdout,
      stderr,
    }
  }
}
