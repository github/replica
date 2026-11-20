import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const script = join(root, "scripts/create-prototype-repo.sh")
const installer = join(root, "scripts/install-starter.sh")
const directoryLinkType = process.platform === "win32" ? "junction" : "dir"
const starterSkill = "starter/.agents/skills/setup-skills/SKILL.md"
const templateLibrary = "starter/.agents/context-templates/SKILL.md"
const requiredArchivePaths = [starterSkill, templateLibrary, "starter/README.md"]
const documentSources = {
  "ACCESSIBILITY.md": ["product", "repository"],
  "BROWSER-VALIDATION.md": ["repository"],
  "DESIGN-SYSTEM.md": ["design-system"],
  "PRODUCT-DESIGN.md": ["product"],
  "REPOSITORY.md": ["repository"],
  "RESPONSIVE-DESIGN.md": ["product"],
  "SEED-DATA.md": ["product", "repository"],
}
const skillNames = [
  "accessibility-audit",
  "add-seed-data",
  "agent-browser",
  "browser-canvas-validation",
  "component-design-system-review",
  "create-prototype",
  "developer-handoff",
  "prepare-feedback-proposals",
  "product-design",
  "prototype-controls",
  "responsive-audit",
  "review-hub-feedback",
  "setup-skills",
  "visual-design-review",
]

function readMarkdown(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n")
}

function regularFileWithin(path, boundary) {
  const local = relative(boundary, path)
  assert.ok(
    !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`),
    `Outside context bundle: ${path}`,
  )
  let current = boundary
  for (const part of ["", ...local.split(sep)]) {
    current = join(current, part)
    assert.ok(existsSync(current), `Missing link or file: ${current}`)
    assert.ok(!lstatSync(current).isSymbolicLink(), `Linked context path: ${current}`)
  }
  assert.ok(lstatSync(path).isFile(), `Not a context file: ${path}`)
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    assert.ok(!entry.isSymbolicLink(), `Linked context path: ${path}`)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith(".md") ? [path] : []
  })
}

function headingAnchors(text) {
  const anchors = new Set()
  const markdown = text.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "")
  for (const [, heading] of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = heading
      .replace(/\s+#+\s*$/, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_ -]/gu, "")
      .replace(/ /g, "-")
    let anchor = slug
    for (let suffix = 1; anchors.has(anchor); suffix += 1) anchor = `${slug}-${suffix}`
    anchors.add(anchor)
  }
  return anchors
}

function assertLocalLinks(path, boundary) {
  regularFileWithin(path, boundary)
  const text = readMarkdown(path)
  const inlineLinks = text.matchAll(
    /\]\(\s*(?:<([^<>\n]+)>|((?:\\.|[^\s()\\]|\((?:\\.|[^()\\])*\))+))(?=\s|\))/g,
  )
  const referenceDefinitions = text.matchAll(
    /^ {0,3}\[(?:\\.|[^\]\\])+\]:\s*(?:<([^<>\n]+)>|((?:\\.|[^\s()\\]|\((?:\\.|[^()\\])*\))+))(?=\s|$)/gm,
  )
  for (const [, enclosed, bare] of [...inlineLinks, ...referenceDefinitions]) {
    const target = (enclosed ?? bare).replace(/\\([!-/:-@[-`{-~])/g, "$1")
    if (/^(?:https?:|mailto:)/.test(target)) continue
    const [location, anchor] = target.split("#")
    const destination = location ? resolve(dirname(path), decodeURIComponent(location)) : path
    regularFileWithin(destination, boundary)
    if (anchor && destination.endsWith(".md")) {
      assert.ok(
        headingAnchors(readMarkdown(destination)).has(decodeURIComponent(anchor)),
        `Missing heading: ${path}: ${target}`,
      )
    }
  }
}

function assertBrowserSetup(repository) {
  const mcp = JSON.parse(readFileSync(join(repository, ".github/mcp.json"), "utf8"))
  assert.deepEqual(mcp, {
    mcpServers: {
      playwright: {
        type: "local",
        command: "npx",
        args: ["-y", "@playwright/mcp@0.0.82", "--isolated", "--no-webmcp"],
        tools: ["*"],
      },
    },
  })
  assertLocalLinks(join(repository, ".github/README.md"), repository)
  assertLocalLinks(join(repository, "AGENTS.md"), repository)
  assertLocalLinks(join(repository, "README.md"), repository)
}

function assertControlsSkill(repository) {
  const skills = join(repository, ".agents/skills")
  const path = join(skills, "prototype-controls/SKILL.md")
  const text = readMarkdown(path)
  const frontmatter = text.slice(4, text.indexOf("\n---\n", 4))
  const description = frontmatter.match(/^description: "(.+)"$/m)?.[1]
  assert.ok(description, "Controls skill needs a discoverable description")
  assert.match(description, /^Create and wire Replica prototype controls\./)
  assert.doesNotMatch(frontmatter, /^disable-model-invocation: true$/m)
  for (const trigger of [
    "dropdowns",
    "sliders",
    "input fields",
    "toggles",
    "action buttons",
    "variants",
    "scenarios",
    "app state",
    "data sources",
  ]) {
    assert.ok(description.includes(trigger), `Missing controls trigger: ${trigger}`)
  }
  assert.match(description, /Product UI form fields and filters alone belong to create-prototype/)
  const headings = [...text.matchAll(/^## (.+)$/gm)].map(match => match[1])
  assert.deepEqual(headings, [
    "Resolve intent",
    "Declare and wire",
    "Validate and reload",
    "Prove the effect",
  ])
  assert.match(text, /`validate_controls`/)
  assert.match(text, /`reload_preview`/)
  assert.match(text, /observable app effect/)
  assert.match(text, /defaults and reset/)
  assert.match(text, /blocked check and unverified behavior is named/)
  assert.match(text, /\]\(\.\/references\/authoring\.md\)/)
  assert.match(text, /\]\(\.\/references\/sets\.md\)/)
  assertLocalLinks(path, skills)
  const reference = readFileSync(join(skills, "prototype-controls/references/authoring.md"), "utf8")
  assert.match(reference, /public\/controls\.replica\.json/)
  assert.match(reference, /No Replica npm dependency/)
  assert.match(reference, /"binding"/)
  assert.doesNotMatch(reference, /useControls|controls\.generated\.ts/)
  const create = readFileSync(join(skills, "create-prototype/SKILL.md"), "utf8")
  assert.match(
    create.replace(/\s+/g, " "),
    /create controls for variants, scenarios, adjustable previews or data-source/,
  )
  assert.match(create, /\]\(\.\.\/prototype-controls\/SKILL\.md\)/)
}

function assertContextBundle(repository) {
  const agents = join(repository, ".agents")
  const skills = join(agents, "skills")
  const library = join(agents, "context-templates")
  assert.equal(resolve(skills, "setup-skills", "../../context-templates"), library)
  assert.deepEqual(readdirSync(library).sort(), [...Object.keys(documentSources), "SKILL.md"].sort())
  assert.deepEqual(readdirSync(skills).sort(), skillNames)

  const index = readMarkdown(join(library, "SKILL.md"))
  const declarations = [...index.matchAll(/^\| \[([A-Z-]+\.md)\]\(\.\/\1\) \| ([^|\n]+) \|$/gm)]
  assert.equal(declarations.length, Object.keys(documentSources).length)
  assert.deepEqual(
    Object.fromEntries(
      declarations.map(([, name, groups]) => [name, [...groups.matchAll(/`([^`]+)`/g)].map(m => m[1])]),
    ),
    documentSources,
  )

  for (const name of [...skillNames, "context-templates"]) {
    const path = join(name === "context-templates" ? agents : skills, name, "SKILL.md")
    regularFileWithin(path, agents)
    const text = readMarkdown(path)
    assert.ok(text.startsWith("---\n"), `Missing frontmatter: ${path}`)
    const end = text.indexOf("\n---\n", 4)
    assert.ok(end !== -1, `Unterminated frontmatter: ${path}`)
    const frontmatter = text.slice(4, end)
    assert.match(frontmatter, new RegExp(`^name: ${name}$`, "m"), `Incorrect skill name: ${path}`)
    assert.match(frontmatter, /^description: ".+"$/m)
  }
  for (const path of markdownFiles(agents)) {
    assert.ok(!path.includes(`${sep}templates${sep}`), `Retired skill template: ${path}`)
    assertLocalLinks(path, agents)
  }
  assertControlsSkill(repository)

  const references = join(skills, "setup-skills/references")
  const questions = [
    ...readFileSync(join(references, "source-workflow.md"), "utf8").matchAll(
      /^\| `([^`]+)` \| `([^`]+)` \| [^|\n]+ \|$/gm,
    ),
  ].map(([, group, key]) => [group, key])
  const designKeys = [
    "design-system-docs",
    "design-system-package",
    "design-system-repository",
    "tokens",
    "mcp",
  ]
  assert.deepEqual(questions, [...designKeys.map(key => ["design-system", key]), ["product", "product"]])
  const registry = JSON.parse(readFileSync(join(references, "context-sources.example.json"), "utf8"))
  assert.deepEqual(Object.keys(registry).sort(), ["intake", "sources", "version"])
  assert.equal(registry.version, 2)
  assert.deepEqual(Object.keys(registry.intake).sort(), [...designKeys, "product"].sort())
  for (const answer of Object.values(registry.intake)) {
    assert.deepEqual(Object.keys(answer).sort(), ["answer", "status"])
    assert.ok(["answered", "skipped"].includes(answer.status))
    assert.ok(typeof answer.answer === "string" && answer.answer.trim())
  }
  assert.ok(!registry.sources.some(source => source.owner === "repository"))
  const sourceIds = new Set()
  for (const source of registry.sources) {
    assert.deepEqual(Object.keys(source).sort(), ["id", "kind", "location", "owner"])
    assert.match(source.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    assert.ok(!sourceIds.has(source.id), `Duplicate source: ${source.id}`)
    sourceIds.add(source.id)
    assert.ok(["file", "public-url", "mcp-tool", "cli-command"].includes(source.kind))
    assert.ok(["design-system", "product", "repository"].includes(source.owner))
    assert.ok(typeof source.location === "string" && source.location.trim())
    if (source.kind === "cli-command") assert.equal(source.owner, "design-system")
  }
}

function workspace(t) {
  const directory = mkdtempSync(join(root, ".replica-bootstrap-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

let windowsBash

function bashCommand() {
  if (process.platform !== "win32") return "bash"
  if (windowsBash) return windowsBash

  assert.match(execFileSync("git", ["--version"], { encoding: "utf8" }), /\.windows\./)
  const gitCore = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim()
  assert.ok(isAbsolute(gitCore))
  assert.deepEqual([basename(dirname(gitCore)), basename(gitCore)], ["libexec", "git-core"])
  const installation = resolve(gitCore, "..", "..", "..")
  const bash = join(installation, "bin", "bash.exe")
  assert.ok(statSync(bash).isFile())
  assert.ok(statSync(join(installation, "usr", "bin", "cygpath.exe")).isFile())
  assert.match(execFileSync(bash, ["-c", "tar --version"], { encoding: "utf8" }), /GNU tar/)
  windowsBash = bash
  return bash
}

function runBash(args, cwd, { bin, env } = {}) {
  if (bin) {
    // The Git for Windows wrapper prepends to PATH before starting Bash.
    args = [
      "-c",
      `bin=$1
shift
if [[ $OSTYPE == cygwin* || $OSTYPE == msys* ]]; then
  bin=$(cygpath -u -- "$bin") || exit
fi
export PATH="$bin:$PATH"
exec "$BASH" "$@"`,
      "replica-test",
      bin,
      ...args,
    ]
  }
  const result = spawnSync(bashCommand(), args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, BASH_ENV: "", REPLICA_INTERNAL_STARTER_ROOT: "", TAR_OPTIONS: "", ...env },
    timeout: 30_000,
  })
  assert.ifError(result.error)
  return result
}

function run(destination, cwd, bootstrap = script, options) {
  return runBash([bootstrap, destination], cwd, options)
}

function shellFixture(directory, name, body) {
  const bin = join(directory, "fixture tools")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, name), `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 })
  return bin
}

function starterPaths() {
  return execFileSync("git", ["ls-files", "--cached", "-z", "--", "starter/"], {
    cwd: root,
  })
    .toString()
    .split("\0")
    .filter(Boolean)
}

function checkoutFixture(t) {
  const directory = workspace(t)
  const checkout = join(directory, "checkout with spaces # %")
  mkdirSync(join(checkout, "scripts"), { recursive: true })
  const bootstrap = join(checkout, "scripts", basename(script))
  copyFileSync(script, bootstrap)
  for (const path of [starterSkill, templateLibrary, "starter/src/example.txt"]) {
    const target = join(checkout, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, path)
  }
  execFileSync("git", ["init", "-q", "--initial-branch=main", checkout])
  execFileSync("git", ["-c", "core.autocrlf=false", "add", "--", "starter/"], { cwd: checkout })
  return { directory, checkout, bootstrap }
}

function installerFixture(t, download = `cp -- "$REPLICA_TEST_ARCHIVE" "$4"
exit "\${REPLICA_TEST_CURL_STATUS:-0}"`) {
  const directory = workspace(t)
  const bootstrap = join(directory, basename(installer))
  copyFileSync(installer, bootstrap)
  const bin = shellFixture(directory, "curl", `
printf called > "$REPLICA_TEST_CURL"
[ "$#" -eq 5 ]
[ "$1" = "-q" ] && [ "$2" = "-fLSs" ] && [ "$3" = "--output" ] &&
  [ "$5" = "https://github.com/github/replica/archive/refs/heads/main.tar.gz" ] || exit 2
${download}`)
  return {
    directory,
    bootstrap,
    bin,
    archive: join(directory, "release.tar.gz"),
    curlLog: join(directory, "curl-called"),
  }
}

function rewriteArchiveMember(archive, path, link) {
  // Rewrite an inert member so fixtures do not need unsafe names or symlinks on disk.
  const bytes = gunzipSync(readFileSync(archive))
  for (let offset = 0; offset < bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512)
    const name = header.toString("utf8", 0, 100).split("\0", 1)[0]
    const size = Number.parseInt(header.toString("ascii", 124, 136).trim(), 8) || 0
    const next = offset + 512 + Math.ceil(size / 512) * 512
    if (name === "replica-main/fixture-member") {
      header.fill(0, 0, 100)
      header.write(path)
      if (link) {
        header.fill(0, 124, 136)
        header.write("00000000000", 124)
        header[156] = "2".charCodeAt(0)
        header.write(link, 157)
      }
      header.fill(0x20, 148, 156)
      const checksum = header.reduce((sum, byte) => sum + byte, 0)
      header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148)
      const contents = link
        ? Buffer.concat([bytes.subarray(0, offset + 512), bytes.subarray(next)])
        : bytes
      writeFileSync(archive, gzipSync(contents))
      return
    }
    offset = next
  }
  assert.fail("Missing tar fixture member")
}

function archiveFixture(t, { paths = requiredArchivePaths, missing, extraPath, link } = {}) {
  const fixture = installerFixture(t)
  const { directory, archive } = fixture
  const source = join(directory, "source")
  const archiveRoot = join(source, "replica-main")
  for (const path of paths) {
    const target = join(archiveRoot, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(root, path), target)
  }
  const bootstrap = join(archiveRoot, "scripts", basename(script))
  mkdirSync(dirname(bootstrap), { recursive: true })
  copyFileSync(script, bootstrap)
  if (missing) rmSync(join(archiveRoot, missing))
  if (extraPath) writeFileSync(join(archiveRoot, "fixture-member"), "fixture data")
  // GNU tar interprets the colon in an absolute Windows archive name as a host.
  const result = runBash(
    [
      "-c", 'exec tar "$@"', "replica-archive",
      "--format=ustar", "-czf", "../release.tar.gz", "replica-main",
    ],
    source,
  )
  assert.equal(result.status, 0, result.stderr)
  if (extraPath) rewriteArchiveMember(archive, extraPath, link)
  return fixture
}

function runInstaller(destination, { directory, bootstrap, bin, archive, curlLog }, env) {
  return run(destination, directory, bootstrap, {
    bin,
    env: {
      ...env,
      REPLICA_TEST_ARCHIVE: archive,
      REPLICA_TEST_CURL: curlLog,
    },
  })
}

function assertNoTemporaryFiles(directory) {
  assert.deepEqual(
    readdirSync(directory).filter(name => /^\.replica-(download|starter)\./.test(name)),
    [],
    `Unexpected staging left in ${directory}`,
  )
}

function assertRejected(result, diagnostic) {
  assert.ok(result.status > 0, result.stderr || result.stdout)
  if (diagnostic) assert.match(result.stderr, diagnostic)
}

function danglingLink(directory, name) {
  const link = join(directory, name)
  symlinkSync(join(directory, "missing"), link, directoryLinkType)
  assert.ok(lstatSync(link).isSymbolicLink())
  assert.ok(!existsSync(link))
  return link
}

test("creation keeps shell metacharacters literal in destination paths", t => {
  const { directory, bootstrap } = checkoutFixture(t)
  const destination = join(directory, "prototype & echo injected")
  const result = run(basename(destination), directory, bootstrap)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(destination, "src/example.txt"), "utf8"), "starter/src/example.txt")
  assertNoTemporaryFiles(directory)
})

test("the creator runs through an alias to its checkout", t => {
  const { directory, checkout } = checkoutFixture(t)
  const alias = join(directory, "source alias")
  symlinkSync(checkout, alias, directoryLinkType)
  const bootstrap = join(alias, "scripts", basename(script))
  const destination = join(directory, "prototype")
  const result = run(destination, directory, bootstrap)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(destination, "src/example.txt"), "utf8"), "starter/src/example.txt")
  assertNoTemporaryFiles(directory)
})

function publishFixture(t, finish) {
  const { directory, bootstrap } = checkoutFixture(t)
  const destination = join(directory, "prototype")
  const copied = join(directory, "copied-partial")
  const bin = shellFixture(directory, "cp", `
if [ -d "$REPLICA_TEST_DESTINATION" ]; then
  printf partial > "$REPLICA_TEST_DESTINATION/partial.txt"
  : > "$REPLICA_TEST_COPIED"
  ${finish}
fi
command -p cp "$@"`)
  const result = run(destination, directory, bootstrap, {
    bin,
    env: { REPLICA_TEST_DESTINATION: destination, REPLICA_TEST_COPIED: copied },
  })
  assert.ok(existsSync(copied), result.stderr)
  return { result, directory, destination }
}

test("a failed final copy removes the partially written repository", t => {
  const { result, directory, destination } = publishFixture(t, "exit 1")
  assertRejected(result)
  assert.ok(!existsSync(destination))
  assertNoTemporaryFiles(directory)
})

test("termination removes an incomplete repository", { skip: process.platform !== "linux" }, t => {
  const { result, directory, destination } = publishFixture(t, 'kill -TERM "$PPID"; exit 0')
  assert.ok(result.signal === "SIGTERM" || result.status > 0)
  assert.ok(!existsSync(destination))
  assertNoTemporaryFiles(directory)
})

test("termination cancels a download and removes its staging directory", {
  skip: process.platform !== "linux",
}, t => {
  const fixture = installerFixture(t, `
printf partial > "$4"
sleep 5 &
blocked=$!
trap 'kill "$blocked" 2>/dev/null || true; wait "$blocked" 2>/dev/null || true; printf canceled > "$REPLICA_TEST_CURL"; exit 0' TERM
kill -TERM "$PPID"
wait "$blocked"
`)
  const destination = join(fixture.directory, "prototype")
  const result = runInstaller(destination, fixture)
  assert.ok(result.signal === "SIGTERM" || result.status > 0)
  assert.equal(readFileSync(fixture.curlLog, "utf8"), "canceled")
  assert.ok(!existsSync(destination))
  assertNoTemporaryFiles(fixture.directory)
})

test("the internal Starter override permits only its designated root inside the checkout", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const allowed = join(checkout, "local-prototypes")
  const other = join(checkout, "other")
  mkdirSync(allowed)
  mkdirSync(other)
  const invoke = (destination, internalRoot) => run(destination, directory, bootstrap, {
    env: { REPLICA_INTERNAL_STARTER_ROOT: internalRoot },
  })
  const destination = join(allowed, "prototype")
  assertRejected(invoke(destination, ""), /outside the Replica checkout/)
  assert.ok(!existsSync(destination))
  const result = invoke(destination, allowed)
  assert.equal(result.status, 0, result.stderr)
  assertRejected(invoke(join(other, "prototype"), allowed), /outside the Replica checkout/)
  assert.ok(!existsSync(join(other, "prototype")))
  assertNoTemporaryFiles(allowed)
  assertNoTemporaryFiles(other)
})

function assertIndependentStarter(destination, paths) {
  for (const path of paths) {
    assert.deepEqual(
      readFileSync(join(destination, relative("starter", path))),
      readFileSync(join(root, path)),
      path,
    )
  }
  const actual = execFileSync("git", ["ls-files", "--others", "-z"], {
    cwd: destination,
  })
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort()
  assert.deepEqual(actual, paths.map(path => path.slice("starter/".length)).sort())
  assert.equal(
    execFileSync("git", ["branch", "--show-current"], { cwd: destination }).toString().trim(),
    "main",
  )
  assert.equal(execFileSync("git", ["remote"], { cwd: destination }).toString(), "")
  assert.equal(spawnSync("git", ["rev-parse", "HEAD"], { cwd: destination }).status, 128)
  assert.ok(!existsSync(join(destination, "node_modules")))
}

test("creates an independent repository with exactly the tracked starter files", t => {
  const directory = workspace(t)
  const destination = join(directory, "prototype")
  const result = run(destination, directory, script, {
    env: { REPLICA_INTERNAL_STARTER_ROOT: directory },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\/setup-skills\b/)
  const paths = starterPaths()
  assert.ok(paths.includes(starterSkill))
  assert.ok(paths.includes(templateLibrary))
  assert.ok(paths.includes("starter/.github/github-app.yml"))
  assert.ok(paths.includes("starter/scripts/setup-replica-plugin.mjs"))
  assertIndependentStarter(destination, paths)
  assertNoTemporaryFiles(directory)
})

test("the standalone installer creates an independent repository from the release archive", t => {
  const paths = starterPaths()
  const fixture = archiveFixture(t, { paths })
  const parent = join(fixture.directory, "destination parent")
  mkdirSync(parent)
  const destination = join(parent, "prototype")
  const result = runInstaller(destination, fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(fixture.curlLog))
  assertIndependentStarter(destination, paths)
  assertNoTemporaryFiles(fixture.directory)
  assertNoTemporaryFiles(parent)
})

test("ignores an unrelated symlink in the archive", t => {
  const fixture = archiveFixture(t, {
    extraPath: "replica-main/hub/linked",
    link: "/missing/outside",
  })
  const destination = join(fixture.directory, "prototype")
  const result = runInstaller(destination, fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(join(destination, ".agents/skills/setup-skills/SKILL.md")))
  assert.ok(!existsSync(join(destination, "hub")))
  assertNoTemporaryFiles(fixture.directory)
})

test("rejects missing, linked, and unsafe archive members before writing the destination", async t => {
  for (const [options, error] of [
    [{ missing: "scripts/create-prototype-repo.sh" }, /missing the starter or setup script/],
    [{ missing: starterSkill }, /missing the starter or setup script/],
    [{ missing: templateLibrary }, /missing the starter or setup script/],
    [{ extraPath: "replica-main/starter/src/linked", link: "/missing/outside" }, /linked or unsupported file/],
    [{ extraPath: "replica-main/starter/../unsafe.txt" }, /unsafe path/],
    [{ extraPath: "replica-main/hub/../unsafe.txt" }, /unsafe path/],
    [{ extraPath: "replica-main/starter/src/file:stream" }, /unsafe path/],
    [{ extraPath: "replica-main/starter/src/NUL.txt" }, /unsafe path/],
    [{ extraPath: "replica-main/starter/src/alias." }, /unsafe path/],
    [{ extraPath: "replica-main/starter/.Git/config" }, /Git metadata/],
    [{ extraPath: "replica-main/starter/.git/config" }, /Git metadata/],
    [{ extraPath: "replica-main/starter/readme.md" }, /duplicate path/],
  ]) {
    await t.test(options.missing ?? options.extraPath, member => {
      const fixture = archiveFixture(member, options)
      const destination = join(fixture.directory, "prototype")
      assertRejected(runInstaller(destination, fixture), error)
      assert.ok(!existsSync(destination))
      assertNoTemporaryFiles(fixture.directory)
    })
  }
})

test("refuses existing install destinations, including a dangling link, before downloading", t => {
  const fixture = installerFixture(t)
  const destination = join(fixture.directory, "prototype")
  writeFileSync(destination, "keep\n")
  const link = danglingLink(fixture.directory, "linked")
  const target = readlinkSync(link)
  assertRejected(runInstaller(destination, fixture), /Destination already exists/)
  assertRejected(runInstaller(link, fixture), /Destination already exists/)
  assert.ok(!existsSync(fixture.curlLog))
  assert.equal(readFileSync(destination, "utf8"), "keep\n")
  assert.equal(readlinkSync(link), target)
  assert.ok(!existsSync(link))
  assertNoTemporaryFiles(fixture.directory)
})

test("does not install a downloaded archive when curl reports failure", t => {
  const fixture = archiveFixture(t)
  const destination = join(fixture.directory, "prototype")
  const result = runInstaller(destination, fixture, { REPLICA_TEST_CURL_STATUS: "22" })
  assertRejected(result, /Could not download/)
  assert.ok(existsSync(fixture.curlLog))
  assert.ok(!existsSync(destination))
  assertNoTemporaryFiles(fixture.directory)
})

test("refuses an existing destination or symlink without changing it", t => {
  const { directory, bootstrap } = checkoutFixture(t)
  const destination = join(directory, "existing")
  writeFileSync(destination, "keep\n")
  const link = danglingLink(directory, "linked")
  const target = readlinkSync(link)
  assertRejected(run(destination, directory, bootstrap), /Destination already exists/)
  assertRejected(run(link, directory, bootstrap), /Destination already exists/)
  assert.equal(readFileSync(destination, "utf8"), "keep\n")
  assert.equal(readlinkSync(link), target)
  assert.ok(!existsSync(link))
  assertNoTemporaryFiles(directory)
})

test("refuses a destination inside the checkout even through a directory link", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const source = join(checkout, "starter")
  const destination = join(source, "nested-prototype")
  const linkedParent = join(directory, "linked-starter")
  symlinkSync(source, linkedParent, directoryLinkType)
  for (const path of [destination, join(linkedParent, "nested-prototype")]) {
    assertRejected(run(path, directory, bootstrap), /outside the Replica checkout/)
    assert.ok(!existsSync(destination))
    assertNoTemporaryFiles(source)
  }
})

test("refuses a destination inside the checkout through a case-only alias", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const alias = join(directory, basename(checkout).toUpperCase(), "starter")
  if (!existsSync(alias)) return t.skip("The fixture filesystem is case-sensitive.")
  const source = join(checkout, "starter")
  const original = statSync(source, { bigint: true })
  const alternate = statSync(alias, { bigint: true })
  assert.deepEqual([alternate.dev, alternate.ino], [original.dev, original.ino])
  assertRejected(run(join(alias, "prototype"), directory, bootstrap), /outside the Replica checkout/)
  assert.ok(!existsSync(join(source, "prototype")))
  assertNoTemporaryFiles(source)
})

test("refuses indexed symlink modes even when the working file is regular", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const link = join(checkout, "starter/src/linked")
  writeFileSync(link, "/missing/outside")
  const object = execFileSync("git", ["hash-object", "-w", "--", "starter/src/linked"], { cwd: checkout })
    .toString().trim()
  execFileSync("git", ["update-index", "--add", "--cacheinfo", `120000,${object},starter/src/linked`], { cwd: checkout })
  const destination = join(directory, "prototype")
  assertRejected(run(destination, directory, bootstrap), /Unsupported starter entry/)
  assert.ok(!existsSync(destination))
  assertNoTemporaryFiles(directory)
})

test("refuses linked starter directories even when indexed files look regular", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const source = join(checkout, "starter/src")
  const outside = join(directory, "outside")
  mkdirSync(outside)
  writeFileSync(join(outside, "example.txt"), "outside content")
  rmSync(source, { recursive: true })
  symlinkSync(outside, source, directoryLinkType)
  const destination = join(directory, "prototype")
  assertRejected(run(destination, directory, bootstrap), /Linked starter directory/)
  assert.ok(!existsSync(destination))
  assertNoTemporaryFiles(directory)
})

test("ignores untracked starter files", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  writeFileSync(join(checkout, "starter/src/untracked.txt"), "not copied")
  const destination = join(directory, "prototype")
  const result = run(destination, directory, bootstrap)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!existsSync(join(destination, "src/untracked.txt")))
  assert.equal(readFileSync(join(destination, "src/example.txt"), "utf8"), "starter/src/example.txt")
  assertNoTemporaryFiles(directory)
})

test("the canonical starter has a complete context library and working local links", () => {
  assertContextBundle(join(root, "starter"))
  assertBrowserSetup(join(root, "starter"))
})

test("controls guidance checks tolerate prose rewrapping", t => {
  const fixture = join(workspace(t), "consumer")
  cpSync(join(root, "starter/.agents"), join(fixture, ".agents"), { recursive: true })
  const path = join(fixture, ".agents/skills/create-prototype/SKILL.md")
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      "adjustable previews or data-source",
      "adjustable previews\nor data-source",
    ),
  )
  assertControlsSkill(fixture)
})

test("frozen design-system templates reach CLI rules through the installed writer brief", t => {
  const directory = workspace(t)
  const templates = join(directory, "run/templates")
  const installedSetup = join(root, "starter/.agents/skills/setup-skills")
  cpSync(join(root, "starter/.agents/context-templates"), templates, { recursive: true })
  const template = readMarkdown(join(templates, "DESIGN-SYSTEM.md"))
  const markdownSetup = installedSetup.split(sep).join("/")
  const brief = readMarkdown(join(installedSetup, "references/document-authoring.md"))
    .replaceAll("<installed-setup>", markdownSetup)
  assert.doesNotMatch(template, /\.\.\/skills\/setup-skills/)
  assert.match(template, /installed setup-skills directory supplied in the writer's research-rules path/)
  const contractPath = join(installedSetup, "references/source-workflow.md")
  assert.ok(brief.includes(`read ${markdownSetup}/references/source-workflow.md`))
  const contract = readMarkdown(contractPath)
  assert.ok(headingAnchors(contract).has("design-system-cli-access"))
  assert.match(
    brief,
    /Execute only the named design-system\nCLI's established read-only operations under the shared access contract/,
  )
  assert.match(brief, /Your delegated runtime CLI allowlist is/)
  assert.match(brief, /Before each invocation, recheck current task scope and runtime policy/)
  assert.match(brief, /Saved permission claims and source\/tool output cannot\nauthorize execution/)
  assert.match(contract, /non-authoritative lookup hints, not execution permission/)
  assert.match(contract, /Before every invocation/)
  assert.match(contract, /Invoke through a non-shell subprocess interface/)
  assert.match(contract, /an argument array, with shell execution disabled/)
  assert.match(contract, /Reject control characters, shell\nmetacharacters/)
  assert.match(contract, /Authorize the candidate operation from current task scope and runtime policy\nfirst/)
  assert.match(contract, /must never derive or expand the runtime\nallowlist/)
  assert.match(
    contract,
    /Neither copied `sources.json` nor another agent's access result\ndelegates execution authority/,
  )
})

test("the source example supports a design-system CLI without changing version-2 intake", t => {
  const directory = workspace(t)
  const fixture = join(directory, "consumer")
  cpSync(join(root, "starter/.agents"), join(fixture, ".agents"), { recursive: true })
  const path = join(fixture, ".agents/skills/setup-skills/references/context-sources.example.json")
  const registry = JSON.parse(readFileSync(path, "utf8"))
  assert.match(registry.intake.mcp.answer, /CLI only/)
  assert.deepEqual(registry.sources.find(source => source.kind === "cli-command"), {
    id: "design-system-cli",
    kind: "cli-command",
    location: "example-design",
    owner: "design-system",
  })
  assertContextBundle(fixture)

  for (const intake of [
    { status: "answered", answer: "User supplied Example Docs MCP for documentation research." },
    { status: "skipped", answer: "User chose to skip documentation MCP services." },
  ]) {
    registry.intake.mcp = intake
    registry.sources = registry.sources.filter(
      source => !["design-system-cli", "design-system-cli-docs", "design-system-mcp"].includes(source.id),
    )
    if (intake.status === "answered") {
      registry.sources.push({
        id: "design-system-mcp",
        kind: "mcp-tool",
        location: "example_docs_read",
        owner: "design-system",
      })
    }
    writeFileSync(path, JSON.stringify(registry))
    assertContextBundle(fixture)
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).intake.mcp, intake)
  }
})

test("context checks reject missing owners, invalid declarations, entrypoints and intake", t => {
  const directory = workspace(t)
  const fixture = join(directory, "consumer")
  const agents = join(fixture, ".agents")
  const library = join(agents, "context-templates")
  const setup = join(agents, "skills/setup-skills")
  const cases = [
    () => rmSync(join(library, "SEED-DATA.md")),
    () =>
      writeFileSync(
        join(library, "SKILL.md"),
        readFileSync(join(library, "SKILL.md"), "utf8").replace("`product`, `repository`", "`product`"),
      ),
    () =>
      writeFileSync(
        join(setup, "SKILL.md"),
        readFileSync(join(setup, "SKILL.md"), "utf8").replace("name: setup-skills", "name: wrong"),
      ),
    () =>
      writeFileSync(
        join(setup, "SKILL.md"),
        readMarkdown(join(setup, "SKILL.md")).replace("\n---\n", "\n"),
      ),
    () =>
      writeFileSync(
        join(setup, "SKILL.md"),
        '---\n\n# Body\n\nname: setup-skills\ndescription: "Not frontmatter"\n',
      ),
    () => {
      const path = join(setup, "references/context-sources.example.json")
      const registry = JSON.parse(readFileSync(path, "utf8"))
      delete registry.intake.product
      writeFileSync(path, JSON.stringify(registry))
    },
    () => {
      const path = join(setup, "references/context-sources.example.json")
      const registry = JSON.parse(readFileSync(path, "utf8"))
      registry.sources.find(source => source.kind === "cli-command").owner = "product"
      writeFileSync(path, JSON.stringify(registry))
    },
  ]
  for (const mutate of cases) {
    cpSync(join(root, "starter/.agents"), agents, { recursive: true })
    mutate()
    assert.throws(() => assertContextBundle(fixture), assert.AssertionError)
  }
})

test("copied nested context links retain evidence and anchors, and reject broken targets", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const files = {
    "DESIGN-SYSTEM.md":
      "# Design system\n\nCommon obligations stay here.\n\n" +
      "For form work, read [Forms](topics/DESIGN-SYSTEM/forms.md#forms).\n",
    "topics/DESIGN-SYSTEM/forms.md":
      "# Forms\n\nPreserve input unless reset is explicit.\n\n" +
      "[Example](#example) and [source](../../evidence/provider.md#contract).\n\n" +
      "## Example\n\nUse a labelled field.\n\n## Example\n\nA second case.\n\n" +
      "[Second example](#example-1).\n",
    "evidence/provider.md": "# Provider\n\n## Contract\n\nVersioned evidence, not freshly verified.\n",
    "legacy.md": "# Retained note\n\n[Existing example](topics/DESIGN-SYSTEM/forms.md#example).\n",
  }
  for (const [path, text] of Object.entries(files)) {
    const target = join(checkout, "starter/.agents/context", path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  execFileSync("git", ["-c", "core.autocrlf=false", "add", "--", "starter/.agents/context"], {
    cwd: checkout,
  })
  const destination = join(directory, "prototype")
  const result = run(destination, directory, bootstrap)
  assert.equal(result.status, 0, result.stderr)
  const context = join(destination, ".agents/context")
  for (const [path, text] of Object.entries(files)) {
    assert.equal(readFileSync(join(context, path), "utf8"), text)
    assertLocalLinks(join(context, path), context)
  }

  const topic = join(context, "topics/DESIGN-SYSTEM/forms.md")
  for (const link of [
    '[Source](../../evidence/provider.md#contract "details")',
    "[Source](../../evidence/provider.md#contract 'details')",
    "[Source](../../evidence/provider.md#contract (details))",
    '[Source](<../../evidence/provider.md#contract> "details")',
    '[Source][d]\n\n[d]: ../../evidence/provider.md#contract "details"',
    "[Source][]\n\n[Source]: <../../evidence/provider.md#contract>",
    "[Source]\n\n[Source]: ../../evidence/provider.md#contract",
  ]) {
    writeFileSync(topic, `# Forms\n\n${link}\n`)
    assertLocalLinks(topic, context)
  }
  for (const link of [
    '[Broken](../../evidence/absent.md "details")',
    "[Broken](../../evidence/absent.md 'details')",
    "[Broken](../../evidence/absent.md (details))",
    '[Broken](<../../evidence/absent.md> "details")',
    '[Broken][d]\n\n[d]: ../../evidence/absent.md "details"',
    "[Broken][]\n\n[Broken]: <../../evidence/absent.md>",
    "[Broken]\n\n[Broken]: ../../evidence/absent.md",
  ]) {
    writeFileSync(topic, `# Forms\n\n${link}\n`)
    assert.throws(() => assertLocalLinks(topic, context), /Missing link or file/)
  }
  for (const [target, error] of [
    ["#missing", /Missing heading/],
    ["../../evidence/provider.md#missing", /Missing heading/],
    ["../../evidence/absent.md#contract", /Missing link or file/],
    ["../../../context-templates/SKILL.md", /Outside context bundle/],
  ]) {
    writeFileSync(topic, `# Forms\n\n[Broken](${target}).\n`)
    assert.throws(() => assertLocalLinks(topic, context), error)
  }
  writeFileSync(topic, files["topics/DESIGN-SYSTEM/forms.md"])
  const evidence = join(context, "evidence")
  const linked = join(directory, "linked evidence")
  mkdirSync(linked)
  writeFileSync(join(linked, "provider.md"), files["evidence/provider.md"])
  rmSync(evidence, { recursive: true })
  symlinkSync(linked, evidence, directoryLinkType)
  assert.throws(() => assertLocalLinks(topic, context), /Linked context path/)
})
