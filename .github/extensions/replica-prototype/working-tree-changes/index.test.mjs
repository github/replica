import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { it } from "node:test"
import { promisify } from "node:util"

import { classifyWorkingTreeChanges, MAX_LISTED_CHANGES } from "./index.mjs"

async function readFakeGit(script, options = {}) {
  const directory = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ type: "commonjs" }))
    if (script !== null)
      await writeFile(path.join(directory, "git"), `#!${process.execPath}\n${script}`, {
        mode: 0o755,
      })
    const source = `
      import { readWorkingTreeChanges } from ${JSON.stringify(new URL("./index.mjs", import.meta.url).href)}
      const result = await readWorkingTreeChanges(${JSON.stringify(directory)}, ${JSON.stringify(options)})
      console.log(JSON.stringify(result))
    `
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", source],
      { env: { ...process.env, PATH: directory }, timeout: 5_000 },
    )
    return JSON.parse(stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it("treats only local agent skills as tooling and counts every other change", () => {
  const status = [
    "?? .github/skills/replica-publish-prototype/SKILL.md",
    " M .agents/skills/setup/SKILL.md",
    "A  .claude/skills/review/SKILL.md",
    " M src/App.tsx",
    "?? .github/workflows/replica.yml",
    "R  src/New.tsx",
    "src/Old.tsx",
    "R  .github/skills/moved/SKILL.md",
    "src/skill.md",
    "",
  ].join("\0")
  assert.deepEqual(classifyWorkingTreeChanges(status), {
    state: "changed",
    files: {
      paths: [
        "src/App.tsx",
        ".github/workflows/replica.yml",
        "src/New.tsx",
        ".github/skills/moved/SKILL.md",
      ],
      total: 4,
    },
    localSkills: {
      paths: [
        ".github/skills/replica-publish-prototype/SKILL.md",
        ".agents/skills/setup/SKILL.md",
        ".claude/skills/review/SKILL.md",
      ],
      total: 3,
    },
  })
})

it("reports a checkout with only local skill changes as clean", () => {
  assert.equal(classifyWorkingTreeChanges("?? .github/skills/a/SKILL.md\0").state, "clean")
  assert.equal(classifyWorkingTreeChanges("").state, "clean")
})

it("caps listed paths while keeping the full count", () => {
  const entries = Array.from({ length: MAX_LISTED_CHANGES + 5 }, (_, index) => ` M file-${index}`)
  const result = classifyWorkingTreeChanges(entries.join("\0"))
  assert.equal(result.files.paths.length, MAX_LISTED_CHANGES)
  assert.equal(result.files.total, MAX_LISTED_CHANGES + 5)
})

it("reads more than one MiB of real process output without truncating counts or retaining every path", async () => {
  const count = 20_000
  function file(index) {
    return `src/${"a".repeat(48)}-${index}.tsx`
  }
  function skill(index) {
    return `.github/skills/${"b".repeat(32)}-${index}/SKILL.md`
  }
  assert.ok(Buffer.byteLength(` M ${file(0)}\0?? ${skill(0)}\0`) * count > 1024 * 1024)
  const result = await readFakeGit(`
    const { once } = require("node:events")
    async function main() {
      for (let index = 0; index < ${count}; index++) {
        const entry = " M src/" + "a".repeat(48) + "-" + index + ".tsx\\0" +
          "?? .github/skills/" + "b".repeat(32) + "-" + index + "/SKILL.md\\0"
        if (!process.stdout.write(entry)) await once(process.stdout, "drain")
      }
    }
    main().catch(() => process.exit(1))
  `)
  assert.deepEqual(result, {
    state: "changed",
    files: {
      paths: Array.from({ length: MAX_LISTED_CHANGES }, (_, index) => file(index)),
      total: count,
    },
    localSkills: {
      paths: Array.from({ length: MAX_LISTED_CHANGES }, (_, index) => skill(index)),
      total: count,
    },
  })
})

it("preserves split UTF-8 paths and counts renames by both sides across output chunks", async () => {
  const chunks = [
    Buffer.from(" M src/caf"),
    Buffer.from([0xc3]),
    Buffer.concat([Buffer.from([0xa9]), Buffer.from(".tsx\0R  .github/skills/new/SKILL.md\0")]),
    Buffer.from("src/"),
    Buffer.from("old.tsx\0R  .agents/skills/new/SKILL.md\0"),
    Buffer.from(".claude/skills/old/SKILL.md\0?? src/final"),
    Buffer.from(".tsx\0"),
  ]
  const result = await readFakeGit(`
    const { setTimeout } = require("node:timers/promises")
    async function main() {
      for (const bytes of ${JSON.stringify(chunks.map((chunk) => Array.from(chunk)))}) {
        await new Promise((resolve) => process.stdout.write(Buffer.from(bytes), resolve))
        await setTimeout(20)
      }
    }
    main().catch(() => process.exit(1))
  `)
  assert.deepEqual(result, {
    state: "changed",
    files: {
      paths: ["src/café.tsx", ".github/skills/new/SKILL.md", "src/final.tsx"],
      total: 3,
    },
    localSkills: { paths: [".agents/skills/new/SKILL.md"], total: 1 },
  })
})

it("discards partial changes when Git exits unsuccessfully", async () => {
  const result = await readFakeGit(`
    process.stdout.write(" M partial.tsx\\0", () => {
      process.stderr.write("fixture status failure\\n", () => process.exit(7))
    })
  `)
  assert.deepEqual(result, {
    state: "unavailable",
    error: "fixture status failure",
  })
})

it("stops a stalled Git process and never treats its partial output as a successful check", async () => {
  const result = await readFakeGit(
    'process.stdout.write(" M partial.tsx\\0"); setTimeout(() => {}, 1000)',
    { timeoutMs: 100 },
  )
  assert.equal(result.state, "unavailable")
  assert.match(result.error, /too long|timed? ?out/i)
  assert.equal("files" in result, false)
  assert.equal("localSkills" in result, false)
})

it("reports a missing Git executable instead of assuming the checkout is clean", async () => {
  const result = await readFakeGit(null)
  assert.equal(result.state, "unavailable")
  assert.match(result.error, /git|ENOENT/i)
  assert.equal("files" in result, false)
})
