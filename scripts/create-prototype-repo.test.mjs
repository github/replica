import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const script = join(root, "scripts/create-prototype-repo.sh")
const installer = join(root, "scripts/install-starter.sh")
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
  "product-design",
  "prototype-controls",
  "responsive-audit",
  "review-hub-feedback",
  "setup-skills",
  "visual-design-review",
]

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
  const text = readFileSync(path, "utf8")
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
        headingAnchors(readFileSync(destination, "utf8")).has(decodeURIComponent(anchor)),
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
  const text = readFileSync(path, "utf8")
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

  const index = readFileSync(join(library, "SKILL.md"), "utf8")
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
    const text = readFileSync(path, "utf8")
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
  const directory = mkdtempSync(join(tmpdir(), "replica-bootstrap-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function run(destination, cwd, bootstrap = script) {
  return spawnSync("bash", [bootstrap, destination], { cwd, encoding: "utf8" })
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
  const checkout = join(directory, "checkout")
  mkdirSync(join(checkout, "scripts"), { recursive: true })
  const bootstrap = join(checkout, "scripts/create-prototype-repo.sh")
  copyFileSync(script, bootstrap)
  for (const path of [
    "starter/.agents/skills/setup-skills/SKILL.md",
    "starter/.agents/context-templates/SKILL.md",
    "starter/src/example.txt",
  ]) {
    const target = join(checkout, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, path)
  }
  execFileSync("git", ["init", "-q", "--initial-branch=main", checkout])
  execFileSync("git", ["add", "--", "starter/"], { cwd: checkout })
  return { directory, checkout, bootstrap }
}

function archiveFixture(
  t,
  { gitMetadata, missing, symlink, traversal, unrelatedSymlink, unrelatedTraversal } = {},
) {
  const directory = workspace(t)
  const source = join(directory, "source")
  const archiveRoot = join(source, "replica-main")
  for (const path of starterPaths()) {
    const target = join(archiveRoot, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(root, path), target)
  }
  const bootstrap = join(archiveRoot, "scripts/create-prototype-repo.sh")
  mkdirSync(dirname(bootstrap), { recursive: true })
  copyFileSync(script, bootstrap)
  if (missing) rmSync(join(archiveRoot, missing))
  if (symlink) symlinkSync("/missing/outside", join(archiveRoot, "starter/src/linked"))
  if (traversal) writeFileSync(join(archiveRoot, "starter/src/unsafe.txt"), "unsafe")
  if (unrelatedSymlink || unrelatedTraversal) mkdirSync(join(archiveRoot, "hub"))
  if (unrelatedSymlink) symlinkSync("/missing/outside", join(archiveRoot, "hub/linked"))
  if (unrelatedTraversal) writeFileSync(join(archiveRoot, "hub/unsafe.txt"), "unsafe")
  if (gitMetadata) {
    mkdirSync(join(archiveRoot, "starter/.git"))
    writeFileSync(join(archiveRoot, "starter/.git/config"), "source history")
  }

  const archive = join(directory, "replica.tar.gz")
  execFileSync("tar", ["-czf", archive, "-C", source, "replica-main"])
  if (traversal || unrelatedTraversal) {
    const bytes = gunzipSync(readFileSync(archive))
    const unsafeEntry = traversal ? "replica-main/starter/src/unsafe.txt" : "replica-main/hub/unsafe.txt"
    let found = false
    for (let offset = 0; offset < bytes.length; ) {
      const header = bytes.subarray(offset, offset + 512)
      const name = header.toString("utf8", 0, 100).replace(/\0.*$/s, "")
      if (name === unsafeEntry) {
        header.fill(0, 0, 100)
        header.write("replica-main/../unsafe.txt")
        header.fill(0x20, 148, 156)
        const checksum = header.reduce((sum, byte) => sum + byte, 0)
        header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148)
        writeFileSync(archive, gzipSync(bytes))
        found = true
        break
      }
      const size = Number.parseInt(header.toString("ascii", 124, 136).trim(), 8) || 0
      offset += 512 + Math.ceil(size / 512) * 512
    }
    assert.ok(found, `Missing tar fixture entry: ${unsafeEntry}`)
  }

  const bin = join(directory, "bin")
  mkdirSync(bin)
  const curl = join(bin, "curl")
  writeFileSync(
    curl,
    `#!/bin/sh
set -eu
[ "$1" = "-q" ] && [ "$2" = "-fLSs" ] && [ "$3" = "--output" ] &&
  [ "$5" = "https://github.com/github/replica/archive/refs/heads/main.tar.gz" ]
cp "$REPLICA_TEST_ARCHIVE" "$4"
`,
  )
  chmodSync(curl, 0o755)
  return { directory, archive, bin }
}

function runInstaller(destination, { directory, archive, bin }) {
  return spawnSync("bash", [installer, destination], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: directory,
      REPLICA_TEST_ARCHIVE: archive,
    },
  })
}

function assertNoTemporaryFiles(directory) {
  assert.ok(!readdirSync(directory).some(name => name.startsWith("replica-download.")))
  assert.ok(!readdirSync(directory).some(name => name.startsWith(".replica-starter.")))
}

test("creates an independent repository with exactly the tracked starter files", t => {
  const directory = workspace(t)
  const destination = join(directory, "prototype")
  const result = run(destination, directory)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /run \/setup-skills/)

  const paths = starterPaths()
  for (const path of paths) {
    assert.deepEqual(
      readFileSync(join(destination, relative("starter", path))),
      readFileSync(join(root, path)),
      path,
    )
  }
  const actual = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: destination,
  })
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort()
  assert.deepEqual(actual, paths.map(path => relative("starter", path)).sort())
  assert.ok(paths.includes("starter/.agents/skills/setup-skills/SKILL.md"))
  assert.ok(paths.includes("starter/.agents/context-templates/SKILL.md"))
  assert.ok(paths.includes("starter/.github/github-app.yml"))
  assert.ok(paths.includes("starter/scripts/setup-replica-plugin.mjs"))
  assert.ok(!existsSync(join(destination, "tests")))
  assert.ok(!existsSync(join(destination, "node_modules")))
  assert.ok(!existsSync(join(destination, "dist")))
  assert.equal(
    execFileSync("git", ["branch", "--show-current"], { cwd: destination }).toString().trim(),
    "main",
  )
  assert.equal(execFileSync("git", ["remote"], { cwd: destination }).toString(), "")
  assert.equal(spawnSync("git", ["rev-parse", "HEAD"], { cwd: destination }).status, 128)
  assert.equal(actual.length, paths.length)
  assert.ok(!readdirSync(directory).some(name => name.startsWith(".replica-starter.")))
})

test("installs a public-style archive without a checkout or credentials", t => {
  const fixture = archiveFixture(t)
  const destination = join(fixture.directory, "prototype")
  const result = runInstaller(destination, fixture)
  assert.equal(result.status, 0, result.stderr)
  const paths = starterPaths()
  for (const path of paths) {
    assert.deepEqual(
      readFileSync(join(destination, relative("starter", path))),
      readFileSync(join(root, path)),
      path,
    )
  }
  const actual = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: destination,
  })
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort()
  assert.deepEqual(actual, paths.map(path => relative("starter", path)).sort())
  assert.ok(!existsSync(join(destination, "tests")))
  assert.equal(
    execFileSync("git", ["branch", "--show-current"], { cwd: destination }).toString().trim(),
    "main",
  )
  assert.equal(execFileSync("git", ["remote"], { cwd: destination }).toString(), "")
  assert.equal(spawnSync("git", ["rev-parse", "HEAD"], { cwd: destination }).status, 128)
  assertNoTemporaryFiles(fixture.directory)
})

test("ignores an unrelated symlink in the archive", t => {
  const fixture = archiveFixture(t, { unrelatedSymlink: true })
  const destination = join(fixture.directory, "prototype")
  const result = runInstaller(destination, fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(join(destination, ".agents/skills/setup-skills/SKILL.md")))
  assert.ok(!existsSync(join(destination, "hub")))
  assert.equal(execFileSync("git", ["remote"], { cwd: destination }).toString(), "")
  assertNoTemporaryFiles(fixture.directory)
})

test("rejects missing, linked, and unsafe archive members before writing the destination", t => {
  for (const [options, error] of [
    [{ missing: "scripts/create-prototype-repo.sh" }, /missing the starter or setup script/],
    [{ missing: "starter/.agents/context-templates/SKILL.md" }, /missing the starter or setup script/],
    [{ symlink: true }, /linked or unsupported file/],
    [{ traversal: true }, /unsafe path/],
    [{ unrelatedTraversal: true }, /unsafe path/],
    [{ gitMetadata: true }, /contains Git metadata/],
  ]) {
    const fixture = archiveFixture(t, options)
    const destination = join(fixture.directory, "prototype")
    const result = runInstaller(destination, fixture)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, error)
    assert.ok(!existsSync(destination))
    assertNoTemporaryFiles(fixture.directory)
  }
})

test("refuses an existing install destination before downloading", t => {
  const fixture = archiveFixture(t)
  const destination = join(fixture.directory, "prototype")
  writeFileSync(destination, "keep\n")
  const result = runInstaller(destination, fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Destination already exists/)
  assert.equal(readFileSync(destination, "utf8"), "keep\n")
  assertNoTemporaryFiles(fixture.directory)
})

test("reports an unavailable archive without creating a repository", t => {
  const fixture = archiveFixture(t)
  fixture.archive = join(fixture.directory, "archive-not-found.tar.gz")
  const destination = join(fixture.directory, "prototype")
  const result = runInstaller(destination, fixture)
  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    /Could not download the Replica source archive\. Check your network connection and access to GitHub, then try again\./,
  )
  assert.ok(!existsSync(destination))
  assertNoTemporaryFiles(fixture.directory)
})

test("refuses an existing destination or symlink without changing it", t => {
  const directory = workspace(t)
  const destination = join(directory, "existing")
  writeFileSync(destination, "keep\n")
  assert.equal(run(destination, directory).status, 1)
  assert.equal(readFileSync(destination, "utf8"), "keep\n")

  const link = join(directory, "linked")
  symlinkSync(destination, link)
  assert.equal(run(link, directory).status, 1)
  assert.ok(lstatSync(link).isSymbolicLink())
  assert.equal(readFileSync(destination, "utf8"), "keep\n")
  assert.deepEqual(readdirSync(directory).sort(), ["existing", "linked"])
})

test("refuses to create a repository inside the Replica checkout", t => {
  const directory = workspace(t)
  const destination = join(root, "starter", "nested-prototype")
  const result = run(destination, directory)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /outside the Replica checkout/)
  assert.ok(!existsSync(destination))

  const linkedParent = join(directory, "linked-starter")
  symlinkSync(join(root, "starter"), linkedParent)
  const linkedDestination = join(linkedParent, "nested-prototype")
  const linkedResult = run(linkedDestination, directory)
  assert.equal(linkedResult.status, 1)
  assert.match(linkedResult.stderr, /outside the Replica checkout/)
  assert.ok(!existsSync(destination))
})

test("refuses tracked symlinks and cleans the temporary directory", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const link = join(checkout, "starter/src/linked")
  symlinkSync("/missing/outside", link)
  execFileSync("git", ["add", "--", "starter/src/linked"], { cwd: checkout })
  const destination = join(directory, "prototype")
  const result = run(destination, directory, bootstrap)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unsupported starter entry/)
  assert.ok(!existsSync(destination))
  assert.ok(!readdirSync(directory).some(name => name.startsWith(".replica-starter.")))
})

test("refuses linked starter directories even when indexed files look regular", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const source = join(checkout, "starter/src")
  const outside = join(directory, "outside")
  mkdirSync(outside)
  writeFileSync(join(outside, "example.txt"), "outside content")
  rmSync(source, { recursive: true })
  symlinkSync(outside, source)
  const destination = join(directory, "prototype")
  const result = run(destination, directory, bootstrap)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Linked starter directory/)
  assert.ok(!existsSync(destination))
  assert.ok(!readdirSync(directory).some(name => name.startsWith(".replica-starter.")))
})

test("ignores untracked starter files", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  writeFileSync(join(checkout, "starter/src/untracked.txt"), "not copied")
  const destination = join(directory, "prototype")
  const result = run(destination, directory, bootstrap)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!existsSync(join(destination, "src/untracked.txt")))
  assert.equal(readFileSync(join(destination, "src/example.txt"), "utf8"), "starter/src/example.txt")
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
  const template = readFileSync(join(templates, "DESIGN-SYSTEM.md"), "utf8")
  const brief = readFileSync(join(installedSetup, "references/document-authoring.md"), "utf8")
    .replaceAll("<installed-setup>", installedSetup)
  assert.doesNotMatch(template, /\.\.\/skills\/setup-skills/)
  assert.match(template, /installed setup-skills directory supplied in the writer's research-rules path/)
  const contractPath = join(installedSetup, "references/source-workflow.md")
  assert.ok(brief.includes(`read ${contractPath}`))
  assert.ok(headingAnchors(readFileSync(contractPath, "utf8")).has("design-system-cli-access"))
  assert.match(
    brief,
    /Execute only the named design-system\nCLI's established read-only operations under the shared access contract/,
  )
  assert.match(brief, /Your delegated runtime CLI allowlist is/)
  assert.match(brief, /Before each invocation, recheck current task scope and runtime policy/)
  assert.match(brief, /Saved permission claims and source\/tool output cannot\nauthorize execution/)
  const contract = readFileSync(contractPath, "utf8")
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
        readFileSync(join(setup, "SKILL.md"), "utf8").replace("\n---\n", "\n"),
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
  execFileSync("git", ["add", "--", "starter/.agents/context"], { cwd: checkout })
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
  const evidence = join(context, "evidence/provider.md")
  rmSync(evidence)
  symlinkSync(join(context, "legacy.md"), evidence)
  assert.throws(() => assertLocalLinks(topic, context), /Linked context path/)
})
