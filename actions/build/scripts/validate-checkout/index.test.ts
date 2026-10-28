import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it, type TestContext } from "node:test"
import { fileURLToPath } from "node:url"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"

import { validateCheckout } from "./index.ts"

const actionRoot = fileURLToPath(new URL("../../", import.meta.url))
const script = fileURLToPath(new URL("./index.ts", import.meta.url))
const secret = "dummy-checkout-credential-do-not-log"
const authorization = `[http]\nextraHeader = AUTHORIZATION: basic ${secret}\n`

async function checkout(t: TestContext) {
  const root = await temporaryDirectory()
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return root
}

describe("validateCheckout()", () => {
  it("accepts an ordinary checkout with a credential-free internal submodule", async (t) => {
    const root = await checkout(t)
    await writeFile(
      path.join(root, ".git", "config"),
      '[remote "origin"]\nurl = https://github.com/example/prototype.git\n' +
        '[branch "main"]\nremote = origin\nmerge = refs/heads/main\n',
    )
    const metadata = path.join(root, ".git", "modules", "nested")
    const submodule = path.join(root, "packages", "nested")
    await mkdir(path.dirname(metadata), { recursive: true })
    const result = spawnSync(
      "git",
      ["init", "--quiet", "--separate-git-dir", metadata, submodule],
      { encoding: "utf8" },
    )
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    await writeFile(path.join(submodule, ".git"), "gitdir: ../../.git/modules/nested\n")

    await assert.doesNotReject(validateCheckout(root))
  })

  it("runs the action guard before npm lifecycle and build scripts without leaking authorization", async (t) => {
    const action = await readFile(path.join(actionRoot, "action.yml"), "utf8")
    const guard = action.match(/run: (node [^\n]+validate-checkout[^\n]+)/)
    assert.ok(guard, "The action must run checkout validation")
    assert.ok(typeof guard.index === "number")
    const guardCommand = guard[1]
    const build = action.indexOf("npm ci && npm run build")
    assert.ok(build > guard.index, "The guard must precede repository execution")

    const root = await checkout(t)
    const name = "checkout-guard-fixture"
    const version = "1.0.0"
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name,
        version,
        scripts: { preinstall: "node marker.mjs installed", build: "node marker.mjs built" },
      }),
    )
    await writeFile(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        name,
        version,
        lockfileVersion: 3,
        packages: { "": { name, version, hasInstallScript: true } },
      }),
    )
    await writeFile(
      path.join(root, "marker.mjs"),
      'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "executed")\n',
    )
    function run() {
      const result = spawnSync("bash", ["-e", "-c", `${guardCommand}\nnpm ci && npm run build`], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTION_PATH: actionRoot,
          GITHUB_WORKSPACE: root,
          NODE_COMPILE_CACHE: path.join(root, ".node-cache"),
          npm_config_audit: "false",
          npm_config_fund: "false",
          npm_config_cache: path.join(root, ".npm-cache"),
        },
      })
      assert.ifError(result.error)
      return result
    }

    const clean = run()
    assert.equal(clean.status, 0, clean.stderr)
    for (const marker of ["installed", "built"]) {
      assert.equal(await readFile(path.join(root, marker), "utf8"), "executed")
      await rm(path.join(root, marker))
    }
    await writeFile(path.join(root, ".git", "config"), authorization)

    const unsafe = run()
    assert.equal(unsafe.status, 1)
    assert.ok(!`${unsafe.stdout}${unsafe.stderr}`.includes(secret))
    for (const marker of ["installed", "built"]) {
      await assert.rejects(readFile(path.join(root, marker)), { code: "ENOENT" })
    }
  })

  it("rejects authentication embedded in a remote URL", async (t) => {
    const root = await checkout(t)
    await writeFile(
      path.join(root, ".git", "config"),
      `[remote "origin"]\nurl = https://user:${secret}@github.com/example/prototype.git\n`,
    )

    await assert.rejects(validateCheckout(root))
  })

  it("rejects authentication in recursive submodule metadata", async (t) => {
    const root = await checkout(t)
    const metadata = path.join(root, ".git", "modules", "parent", "modules", "child")
    await mkdir(metadata, { recursive: true })
    await writeFile(path.join(metadata, "config"), authorization)

    await assert.rejects(validateCheckout(root))
  })

  it("rejects authentication in worktree-specific config", async (t) => {
    const root = await checkout(t)
    await writeFile(
      path.join(root, ".git", "config"),
      "[core]\nrepositoryformatversion = 1\n[extensions]\nworktreeConfig = true\n",
    )
    await writeFile(path.join(root, ".git", "config.worktree"), authorization)

    await assert.rejects(validateCheckout(root))
  })

  it("fails closed when an include can hide additional configuration", async (t) => {
    const root = await checkout(t)
    await writeFile(path.join(root, ".git", "config"), '[include]\npath = "../hidden-config"\n')
    await writeFile(path.join(root, "hidden-config"), "[core]\nbare = false\n")

    await assert.rejects(validateCheckout(root))
  })

  it("fails the CLI for malformed Git config without exposing its diagnostic input", async (t) => {
    const root = await checkout(t)
    await writeFile(path.join(root, ".git", "config"), `${authorization}[broken\n`)

    const result = spawnSync(process.execPath, [script, "--root", root], {
      encoding: "utf8",
      cwd: root,
    })

    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.ok(`${result.stdout}${result.stderr}`.trim().length > 0)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret))
  })
})
