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
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const script = join(root, "scripts/create-prototype-repo.sh")
const installer = join(root, "scripts/install-starter.sh")
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash"
const shellPath = path => path.replaceAll("\\", "/").replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`)
const shellEnvironment = {
  ...process.env,
  PATH: process.platform === "win32"
    ? `C:\\Program Files\\Git\\bin${delimiter}${process.env.PATH}`
    : process.env.PATH,
}
const catalog = "# id\tsource-directory\tdisplay-name\tdescription\n" +
  "minimal\tstarter\tMinimal\tA neutral React app\n" +
  "coreai\tstarter-coreai\tCoreAI\tA CoreAI React app\n" +
  "sample-team\tstarter-sample-team\tSample team\tAn independently added app\n"
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

function readText(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n")
}

function regularFileWithin(path, boundary, allowDirectory = false) {
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
  assert.ok(lstatSync(path).isFile() || (allowDirectory && lstatSync(path).isDirectory()), `Not a context file: ${path}`)
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

function assertLocalLinks(path, boundary, allowDirectories = false) {
  regularFileWithin(path, boundary)
  const text = readText(path)
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
    regularFileWithin(destination, boundary, allowDirectories)
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
  assertLocalLinks(join(repository, ".github/README.md"), repository, true)
  assertLocalLinks(join(repository, "AGENTS.md"), repository, true)
  assertLocalLinks(join(repository, "README.md"), repository, true)
}

function assertControlsSkill(repository) {
  const skills = join(repository, ".agents/skills")
  const path = join(skills, "prototype-controls/SKILL.md")
  const text = readText(path)
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
  const reference = readText(join(skills, "prototype-controls/references/authoring.md"))
  assert.match(reference, /public\/controls\.replica\.json/)
  assert.match(reference, /No Replica npm dependency/)
  assert.match(reference, /"binding"/)
  assert.doesNotMatch(reference, /useControls|controls\.generated\.ts/)
  const create = readText(join(skills, "create-prototype/SKILL.md"))
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
  for (const name of skillNames) {
    assert.ok(readdirSync(skills).includes(name), `Missing shared skill: ${name}`)
  }

  const index = readText(join(library, "SKILL.md"))
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
    const text = readText(path)
    assert.ok(text.startsWith("---\n"), `Missing frontmatter: ${path}`)
    const end = text.indexOf("\n---\n", 4)
    assert.ok(end !== -1, `Unterminated frontmatter: ${path}`)
    const frontmatter = text.slice(4, end)
    assert.match(frontmatter, new RegExp(`^name: ${name}$`, "m"), `Incorrect skill name: ${path}`)
    assert.match(frontmatter, /^description: ".+"$/m)
  }
  for (const path of markdownFiles(agents)) {
    assert.ok(!path.includes(`${sep}templates${sep}`), `Retired skill template: ${path}`)
    const [directory, name] = relative(agents, path).split(sep)
    const shared = directory === "context-templates" || (directory === "skills" && skillNames.includes(name))
    assertLocalLinks(path, shared ? agents : repository)
  }
  assertControlsSkill(repository)

  const references = join(skills, "setup-skills/references")
  const questions = [
    ...readText(join(references, "source-workflow.md")).matchAll(
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
  const directory = mkdtempSync(resolve(root, "..", ".replica-bootstrap-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function run(destination, cwd, bootstrap = script, flags = []) {
  return spawnSync(bash, [shellPath(bootstrap), ...flags, ...(destination ? [shellPath(destination)] : [])], {
    cwd,
    encoding: "utf8",
    env: { ...shellEnvironment, TMPDIR: shellPath(cwd) },
  })
}

function starterPaths(checkout, source = "starter") {
  return execFileSync("git", ["ls-files", "--cached", "-z", "--", `${source}/`, "starter-common/"], {
    cwd: checkout,
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
  copyFileSync(join(root, "scripts/starter-catalog.sh"), join(checkout, "scripts/starter-catalog.sh"))
  writeFileSync(join(checkout, "starters.tsv"), catalog)
  const files = [
    "starter-common/.agents/skills/setup-skills/SKILL.md",
    "starter-common/.agents/context-templates/SKILL.md",
    "starter-common/.github/github-app.yml",
    "starter-common/.github/mcp.json",
    "starter-common/scripts/setup-replica-plugin.mjs",
    "starter-common/REPLICA.md",
    "starter-common/REPLICA-AGENTS.md",
    "starter-common/SETUP.md",
    ...["starter", "starter-coreai", "starter-sample-team"].flatMap(source => [
      `${source}/src/example.txt`, `${source}/package.json`, `${source}/README.md`, `${source}/AGENTS.md`,
    ]),
    "starter-coreai/.agents/context/DESIGN-SYSTEM.md",
  ]
  for (const path of files) {
    const target = join(checkout, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, path)
  }
  execFileSync("git", ["init", "-q", "--initial-branch=main", checkout])
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: checkout })
  execFileSync("git", ["add", "--all"], { cwd: checkout })
  return { directory, checkout, bootstrap }
}

function archiveFixture(
  t,
  { gitMetadata, missing, symlink, traversal, unrelatedSymlink, unrelatedTraversal, invalidCatalog } = {},
) {
  const { directory, checkout } = checkoutFixture(t)
  const source = join(directory, "source")
  const archiveRoot = join(source, "replica-main")
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: checkout }).toString().split("\0").filter(Boolean)
  for (const path of paths) {
    const target = join(archiveRoot, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(checkout, path), target)
  }
  const bootstrap = join(archiveRoot, "scripts/create-prototype-repo.sh")
  mkdirSync(dirname(bootstrap), { recursive: true })
  copyFileSync(script, bootstrap)
  if (invalidCatalog) writeFileSync(join(archiveRoot, "starters.tsv"), invalidCatalog)
  if (missing) rmSync(join(archiveRoot, missing))
  const linkedEntry = typeof symlink === "string" ? symlink : "starter/src/linked"
  if (symlink) writeFileSync(join(archiveRoot, linkedEntry), "link fixture")
  if (traversal) writeFileSync(join(archiveRoot, "starter/src/unsafe.txt"), "unsafe")
  if (unrelatedSymlink || unrelatedTraversal) mkdirSync(join(archiveRoot, "hub"))
  if (unrelatedSymlink) writeFileSync(join(archiveRoot, "hub/linked"), "link fixture")
  if (unrelatedTraversal) writeFileSync(join(archiveRoot, "hub/unsafe.txt"), "unsafe")
  if (gitMetadata) {
    mkdirSync(join(archiveRoot, "starter/.git"))
    writeFileSync(join(archiveRoot, "starter/.git/config"), "source history")
  }

  const archive = join(directory, "replica.tar.gz")
  execFileSync("tar", ["-czf", archive, "-C", source, "replica-main"])
  if (traversal || unrelatedTraversal || symlink || unrelatedSymlink) {
    let bytes = gunzipSync(readFileSync(archive))
    const unsafeEntry = symlink ? `replica-main/${linkedEntry}`
      : unrelatedSymlink ? "replica-main/hub/linked"
      : traversal ? "replica-main/starter/src/unsafe.txt" : "replica-main/hub/unsafe.txt"
    let found = false
    for (let offset = 0; offset < bytes.length; ) {
      const header = bytes.subarray(offset, offset + 512)
      const name = header.toString("utf8", 0, 100).replace(/\0.*$/s, "")
      if (name === unsafeEntry) {
        if (symlink || unrelatedSymlink) {
          const size = Number.parseInt(header.toString("ascii", 124, 136).trim(), 8) || 0
          header.fill(0, 124, 136)
          header.write("00000000000", 124)
          header[156] = "2".charCodeAt(0)
          header.fill(0, 157, 257)
          header.write("/missing/outside", 157)
          bytes = Buffer.concat([
            bytes.subarray(0, offset + 512),
            bytes.subarray(offset + 512 + Math.ceil(size / 512) * 512),
          ])
        } else {
          header.fill(0, 0, 100)
          header.write("replica-main/../unsafe.txt")
        }
        header.fill(0x20, 148, 156)
        const checksum = header.reduce((sum, byte) => sum + byte, 0)
        header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148)
        header.copy(bytes, offset)
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
  return { directory, archive, bin, checkout }
}

function runInstaller(destination, { directory, archive, bin }, flags = []) {
  return spawnSync(bash, [
    "-c", 'export PATH="$REPLICA_TEST_BIN:$PATH"; exec bash "$@"', "replica-installer",
    shellPath(installer), ...flags, ...(destination ? [shellPath(destination)] : []),
  ], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...shellEnvironment,
      PATH: `${bin}${delimiter}${shellEnvironment.PATH}`,
      TMPDIR: shellPath(directory),
      REPLICA_TEST_ARCHIVE: shellPath(archive),
      REPLICA_TEST_BIN: shellPath(bin),
    },
  })
}

function assertNoTemporaryFiles(directory) {
  assert.ok(!readdirSync(directory).some(name => name.startsWith("replica-download.")))
  assert.ok(!readdirSync(directory).some(name => name.startsWith(".replica-starter.")))
}

function assertCopiedFiles(destination, checkout, source = "starter") {
  const paths = starterPaths(checkout, source)
  for (const path of paths) {
    const output = path.slice(path.indexOf("/") + 1)
    assert.deepEqual(readFileSync(join(destination, output)), readFileSync(join(checkout, path)), path)
  }
  const actual = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: destination,
  }).toString().split("\0").filter(Boolean).sort()
  assert.deepEqual(actual, paths.map(path => path.slice(path.indexOf("/") + 1)).sort())
  for (const path of ["tests", "node_modules", "dist", "starter", "starter-common", "starter-coreai", "starter-sample-team"]) {
    assert.ok(!existsSync(join(destination, path)), `Leaked source or build directory: ${path}`)
  }
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: destination }).toString().trim(), "main")
  assert.equal(execFileSync("git", ["remote"], { cwd: destination }).toString(), "")
  assert.equal(spawnSync("git", ["rev-parse", "HEAD"], { cwd: destination }).status, 128)
  assert.equal(execFileSync("git", ["ls-files"], { cwd: destination }).toString(), "")
}

test("creates an independent Minimal repository with exactly the tracked app and common files", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const destination = join(directory, "prototype")
  const result = run(destination, directory, bootstrap)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Minimal/)
  assert.match(result.stdout, /fresh|new.+session/i)
  assert.doesNotMatch(result.stdout, /run \/setup-skills/)
  assertCopiedFiles(destination, checkout)
  assert.ok(!existsSync(join(destination, ".agents/context")))
  assertNoTemporaryFiles(directory)
})

test("installs a public-style archive without a checkout or credentials", t => {
  const fixture = archiveFixture(t)
  const destination = join(fixture.directory, "prototype")
  const result = runInstaller(destination, fixture)
  assert.equal(result.status, 0, result.stderr)
  assertCopiedFiles(destination, fixture.checkout)
  assertNoTemporaryFiles(fixture.directory)
})

for (const [id, source, name] of [
  ["minimal", "starter", "Minimal"],
  ["coreai", "starter-coreai", "CoreAI"],
  ["sample-team", "starter-sample-team", "Sample team"],
]) {
  test(`local and archive creation select ${id} using only its catalog entry`, t => {
    const local = checkoutFixture(t)
    const downloaded = archiveFixture(t)
    for (const [fixture, invoke] of [
      [local, (destination, flags) => run(destination, local.directory, local.bootstrap, flags)],
      [downloaded, (destination, flags) => runInstaller(destination, downloaded, flags)],
    ]) {
      const destination = join(fixture.directory, "prototype")
      const result = invoke(destination, ["--starter", id])
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, new RegExp(name))
      assert.match(result.stdout, /fresh|new.+session/i)
      assert.doesNotMatch(result.stdout, /run \/setup-skills/)
      assertCopiedFiles(destination, fixture.checkout, source)
      assert.equal(existsSync(join(destination, ".agents/context")), id === "coreai")
      assertNoTemporaryFiles(fixture.directory)
    }
  })
}

test("local and archive lists show catalog metadata without a destination", t => {
  const local = checkoutFixture(t)
  const downloaded = archiveFixture(t)
  for (const result of [
    run(undefined, local.directory, local.bootstrap, ["--list"]),
    runInstaller(undefined, downloaded, ["--list"]),
  ]) {
    assert.equal(result.status, 0, result.stderr)
    for (const row of catalog.split("\n").filter(line => line && !line.startsWith("#"))) {
      const [id, , name, description] = row.split("\t")
      for (const field of [id, name, description]) assert.ok(result.stdout.includes(field), field)
    }
  }
  assertNoTemporaryFiles(local.directory)
  assertNoTemporaryFiles(downloaded.directory)
})

test("both entry points accept help and option terminators and reject invalid arguments", t => {
  const local = checkoutFixture(t)
  const downloaded = archiveFixture(t)
  for (const [fixture, invoke] of [
    [local, (destination, flags) => run(destination, local.directory, local.bootstrap, flags)],
    [downloaded, (destination, flags) => runInstaller(destination, downloaded, flags)],
  ]) {
    const help = invoke(undefined, ["--help"])
    assert.equal(help.status, 0, help.stderr)
    for (const flag of ["--list", "--starter"]) assert.ok(help.stdout.includes(flag), flag)
    for (const flags of [
      ["--starter", "../minimal"], ["--starter"],
      ["--unknown"], ["--starter", "minimal"], [],
    ]) {
      const result = invoke(undefined, flags)
      assert.notEqual(result.status, 0, `${flags}: ${result.stdout}`)
      assert.ok((result.stdout + result.stderr).trim(), `Missing diagnostic for ${flags}`)
      assertNoTemporaryFiles(fixture.directory)
    }
    const result = invoke("-prototype", ["--starter", "sample-team", "--"])
    assert.equal(result.status, 0, result.stderr)
    assertCopiedFiles(join(fixture.directory, "-prototype"), fixture.checkout, "starter-sample-team")
  }
})

for (const entryPoint of ["local", "archive"]) {
  test(`${entryPoint} creation reports an unknown starter before requiring a destination`, t => {
    const fixture = entryPoint === "local" ? checkoutFixture(t) : archiveFixture(t)
    const result = entryPoint === "local"
      ? run(undefined, fixture.directory, fixture.bootstrap, ["--starter", "unknown"])
      : runInstaller(undefined, fixture, ["--starter", "unknown"])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unknown/i)
    assertNoTemporaryFiles(fixture.directory)
  })
}

test("invalid catalogs fail before creating any destination", t => {
  for (const invalid of [
    "",
    "minimal\tstarter\tMinimal\n",
    "minimal\tstarter\tMinimal\t\n",
    "minimal\tstarter\t\tA description\n",
    "minimal\t\tMinimal\tA description\n",
    "\tstarter\tMinimal\tA description\n",
    "Minimal\tstarter\tMinimal\tA description\n",
    "minimal--app\tstarter\tMinimal\tA description\n",
    "minimal\t../starter\tMinimal\tA description\n",
    "minimal\tstarter-common\tMinimal\tA description\n",
    "minimal\tstarter/nested\tMinimal\tA description\n",
    "minimal\tstarter-UPPER\tMinimal\tA description\n",
    "minimal\tother\tMinimal\tA description\n",
    "minimal\tstarter\tMinimal\tDescription\textra\n",
    catalog + "minimal\tstarter-new\tDuplicate\tDuplicate ID\n",
    catalog + "another\tstarter\tDuplicate\tDuplicate source\n",
  ]) {
    const { directory, checkout, bootstrap } = checkoutFixture(t)
    writeFileSync(join(checkout, "starters.tsv"), invalid)
    const destination = join(directory, "prototype")
    const result = run(destination, directory, bootstrap)
    assert.notEqual(result.status, 0, `Accepted invalid catalog: ${JSON.stringify(invalid)}`)
    assert.match(result.stderr, /catalog|starter|field|duplicate|invalid/i)
    assert.ok(!existsSync(destination))
    assertNoTemporaryFiles(directory)
  }
})

test("common and selected app collisions fail instead of overwriting either source", t => {
  for (const [common, app] of [
    [["shared.txt", "common"], ["shared.txt", "app"]],
    [["shared/file.txt", "common"], ["shared", "app"]],
    [["shared", "common"], ["shared/file.txt", "app"]],
  ]) {
    const { directory, checkout, bootstrap } = checkoutFixture(t)
    for (const [source, [path, content]] of [["starter-common", common], ["starter-coreai", app]]) {
      const target = join(checkout, source, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
    execFileSync("git", ["add", "--all"], { cwd: checkout })
    const destination = join(directory, "prototype")
    const result = run(destination, directory, bootstrap, ["--starter", "coreai"])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /collision|overlap|conflict|already exists/i)
    assert.ok(!existsSync(destination))
    assert.equal(readFileSync(join(checkout, "starter-common", common[0]), "utf8"), common[1])
    assert.equal(readFileSync(join(checkout, "starter-coreai", app[0]), "utf8"), app[1])
    assertNoTemporaryFiles(directory)
  }
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
    [{ missing: "scripts/create-prototype-repo.sh" }, /missing/i],
    [{ missing: "scripts/starter-catalog.sh" }, /missing/i],
    [{ missing: "starters.tsv" }, /missing/i],
    [{ missing: "starter-common/.agents/context-templates/SKILL.md" }, /missing/i],
    [{ missing: "starter-common/.agents/skills/setup-skills/SKILL.md" }, /missing/i],
    [{ symlink: true }, /linked or unsupported file/],
    [{ symlink: "scripts/starter-catalog.sh" }, /linked|unsupported/i],
    [{ symlink: "starter-common/.agents/skills/setup-skills/SKILL.md" }, /linked|unsupported/i],
    [{ invalidCatalog: catalog + "minimal\tstarter-extra\tDuplicate\tDuplicate ID\n" }, /duplicate|catalog|invalid/i],
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

test("refuses indexed symlink modes even when the working file is regular", t => {
  const { directory, checkout, bootstrap } = checkoutFixture(t)
  const link = join(checkout, "starter/src/linked")
  writeFileSync(link, "/missing/outside")
  const object = execFileSync("git", ["hash-object", "-w", "--", "starter/src/linked"], {
    cwd: checkout,
  }).toString().trim()
  execFileSync("git", ["update-index", "--add", "--cacheinfo", `120000,${object},starter/src/linked`], {
    cwd: checkout,
  })
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
  for (const path of [
    "starter/src/untracked.txt", "starter-common/untracked.txt",
    "starter/node_modules/dependency/index.js", "starter/dist/index.html",
  ]) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), "not copied")
  }
  const destination = join(directory, "prototype")
  const result = run(destination, directory, bootstrap)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!existsSync(join(destination, "src/untracked.txt")))
  assert.ok(!existsSync(join(destination, "untracked.txt")))
  assert.ok(!existsSync(join(destination, "node_modules")))
  assert.ok(!existsSync(join(destination, "dist")))
  assert.equal(readFileSync(join(destination, "src/example.txt"), "utf8"), "starter/src/example.txt")
})

test("creation requires both shared skill entry points", t => {
  for (const path of [
    "starter-common/.agents/skills/setup-skills/SKILL.md",
    "starter-common/.agents/context-templates/SKILL.md",
  ]) {
    const { directory, checkout, bootstrap } = checkoutFixture(t)
    rmSync(join(checkout, path))
    execFileSync("git", ["add", "--update"], { cwd: checkout })
    const destination = join(directory, "prototype")
    const result = run(destination, directory, bootstrap, ["--starter", "coreai"])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /missing|skills|templates/i)
    assert.ok(!existsSync(destination))
    assertNoTemporaryFiles(directory)
  }
})

test("the shared bundle has a complete context library and working local links", () => {
  assertContextBundle(join(root, "starter-common"))
  assert.deepEqual(readdirSync(join(root, "starter-common/.agents/skills")).sort(), skillNames)
})

for (const [source, extraSkills, activeContext] of [
  ["starter", 0, false],
  ["starter-coreai", 11, true],
]) {
  test(`${source} composes with shared guidance without collisions or broken links`, t => {
    const consumer = join(workspace(t), "consumer")
    cpSync(join(root, "starter-common"), consumer, { recursive: true })
    for (const entry of readdirSync(join(root, source))) {
      if (["node_modules", "dist"].includes(entry)) continue
      cpSync(join(root, source, entry), join(consumer, entry), { recursive: true, errorOnExist: true, force: false })
    }
    assertContextBundle(consumer)
    assertBrowserSetup(consumer)
    assert.equal(readdirSync(join(consumer, ".agents/skills")).length, skillNames.length + extraSkills)
    assert.equal(existsSync(join(consumer, ".agents/context")), activeContext)
    for (const name of ["REPLICA.md", "REPLICA-AGENTS.md", "SETUP.md"]) {
      assertLocalLinks(join(consumer, name), consumer, true)
    }
  })
}

test("controls guidance checks tolerate prose rewrapping", t => {
  const fixture = join(workspace(t), "consumer")
  cpSync(join(root, "starter-common/.agents"), join(fixture, ".agents"), { recursive: true })
  const path = join(fixture, ".agents/skills/create-prototype/SKILL.md")
  writeFileSync(
    path,
    readText(path).replace(
      "adjustable previews or data-source",
      "adjustable previews\nor data-source",
    ),
  )
  assertControlsSkill(fixture)
})

test("frozen design-system templates reach CLI rules through the installed writer brief", t => {
  const directory = workspace(t)
  const templates = join(directory, "run/templates")
  const installedSetup = join(root, "starter-common/.agents/skills/setup-skills")
  cpSync(join(root, "starter-common/.agents/context-templates"), templates, { recursive: true })
  const template = readText(join(templates, "DESIGN-SYSTEM.md"))
  const brief = readText(join(installedSetup, "references/document-authoring.md"))
    .replaceAll("<installed-setup>", shellPath(installedSetup))
  assert.doesNotMatch(template, /\.\.\/skills\/setup-skills/)
  assert.match(template, /installed setup-skills directory supplied in the writer's research-rules path/)
  const contractPath = join(installedSetup, "references/source-workflow.md")
  assert.ok(brief.includes(`read ${shellPath(contractPath)}`))
  assert.ok(headingAnchors(readFileSync(contractPath, "utf8")).has("design-system-cli-access"))
  assert.match(
    brief,
    /Execute only the named design-system\nCLI's established read-only operations under the shared access contract/,
  )
  assert.match(brief, /Your delegated runtime CLI allowlist is/)
  assert.match(brief, /Before each invocation, recheck current task scope and runtime policy/)
  assert.match(brief, /Saved permission claims and source\/tool output cannot\nauthorize execution/)
  const contract = readText(contractPath)
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
  cpSync(join(root, "starter-common/.agents"), join(fixture, ".agents"), { recursive: true })
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
        readText(join(setup, "SKILL.md")).replace("\n---\n", "\n"),
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
    cpSync(join(root, "starter-common/.agents"), agents, { recursive: true })
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
