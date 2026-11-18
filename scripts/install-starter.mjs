import { execFileSync } from "node:child_process"
import { createWriteStream, lstatSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"

// Keep this downloader standalone: people download and review just this file.
async function install(destination, signal) {
  if (!statSync(dirname(resolve(destination)), { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("Destination must have an existing parent directory.")
  }
  if (lstatSync(resolve(destination), { throwIfNoEntry: false })) {
    throw new Error(`Destination already exists: ${destination}`)
  }
  const temporary = mkdtempSync(resolve(".replica-download."))
  try {
    const archive = "replica.tar.gz"
    try {
      const response = await fetch(
        "https://github.com/github/replica/archive/refs/heads/main.tar.gz",
        { signal },
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(join(temporary, archive), { flags: "wx" }),
        { signal },
      )
    } catch (error) {
      throw new Error(
        "Could not download the Replica source archive. Check your network connection and access to GitHub, then try again.",
        { cause: error },
      )
    }
    function tar(args) {
      return execFileSync("tar", args, {
        cwd: temporary,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      })
    }
    const members = tar(["-tzf", archive]).split(/\r?\n/).slice(0, -1)
    const types = tar(["-tvzf", archive]).split(/\r?\n/).slice(0, -1)
    if (members.length !== types.length)
      throw new Error("Replica source archive has an invalid listing.")
    const root = "replica-main"
    const script = "scripts/create-prototype-repo.mjs"
    const required = new Set([
      script,
      "starter/.agents/skills/setup-skills/SKILL.md",
      "starter/.agents/context-templates/SKILL.md",
    ])
    const seen = new Set()
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index]
      const path = member.slice(root.length + 1).replace(/\/$/, "")
      const parts = path.split("/")
      if (
        member !== `${root}/` &&
        (!member.startsWith(`${root}/`) ||
          parts.some(
            (part) =>
              !part ||
              part === "." ||
              part === ".." ||
              /[\\:\x00-\x1f<>\"|?*]/.test(part) ||
              /[. ]$/.test(part) ||
              /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
          ))
      )
        throw new Error(`Replica source archive contains an unsafe path: ${member}`)
      if (
        (path === "starter" || path.startsWith("starter/")) &&
        parts.some((part) => /^\.git$/i.test(part))
      ) {
        throw new Error("Replica source archive contains Git metadata.")
      }
      if (
        member === `${root}/` ||
        path === "starter" ||
        path.startsWith("starter/") ||
        path === "scripts" ||
        path === script
      ) {
        if ((member.endsWith("/") ? "d" : "-") !== types[index][0]) {
          throw new Error(`Replica source archive contains a linked or unsupported file: ${member}`)
        }
        if (seen.has(path.toLowerCase()))
          throw new Error(`Replica source archive contains a duplicate path: ${member}`)
        seen.add(path.toLowerCase())
      }
      required.delete(path)
    }
    if (required.size)
      throw new Error("Replica source archive is missing the starter or setup script.")
    tar(["-xzf", archive, "-C", ".", `${root}/starter`, `${root}/${script}`])
    const { createRepository } = await import(pathToFileURL(join(temporary, root, script)).href)
    await createRepository(destination, { signal })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv.length !== 3) {
  console.error("Usage: node install-starter.mjs <new-repository-directory>")
  process.exitCode = 2
} else {
  const controller = new AbortController()
  const interrupts = ["SIGINT", "SIGTERM"].map((signal) => {
    const interrupt = () => {
      process.exitCode = signal === "SIGINT" ? 130 : 143
      controller.abort(new Error("Starter installation interrupted."))
    }
    process.on(signal, interrupt)
    return [signal, interrupt]
  })
  try {
    await install(process.argv[2], controller.signal)
  } catch (error) {
    console.error(error.message)
    process.exitCode ||= 1
  } finally {
    for (const [signal, interrupt] of interrupts) process.off(signal, interrupt)
  }
}
