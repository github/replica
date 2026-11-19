import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"

import { validateCheckout } from "./index.mjs"

const actionRoot = fileURLToPath(new URL("../../", import.meta.url))
const script = fileURLToPath(new URL("./index.mjs", import.meta.url))
const secret = "dummy-checkout-credential-do-not-log"

async function gitRepository() {
  const root = await temporaryDirectory()
  execFileSync("git", ["init", "--quiet", root])
  return root
}

describe("validateCheckout()", () => {
  it("accepts an ordinary checkout with a credential-free internal submodule", async () => {
    const root = await gitRepository()
    await writeFile(
      path.join(root, ".git", "config"),
      '[remote "origin"]\nurl = https://github.com/example/prototype.git\n' +
        '[branch "main"]\nremote = origin\nmerge = refs/heads/main\n',
    )
    const metadata = path.join(root, ".git", "modules", "nested")
    const submodule = path.join(root, "packages", "nested")
    await mkdir(path.dirname(metadata), { recursive: true })
    execFileSync("git", ["init", "--quiet", "--separate-git-dir", metadata, submodule])
    await writeFile(path.join(submodule, ".git"), "gitdir: ../../.git/modules/nested\n")

    await validateCheckout(root)
  })

  it("accepts branch refs and reflogs with names resembling Git metadata", async () => {
    const root = await gitRepository()
    for (const prefix of ["refs/heads", "logs/refs/heads"]) {
      const refs = path.join(root, ".git", prefix, "proto")
      await mkdir(path.join(refs, "config"), { recursive: true })
      await writeFile(path.join(refs, "config", "mobile"), "branch data\n")
      await writeFile(path.join(refs, "commondir"), "branch data\n")
      await writeFile(path.join(refs, "config.worktree"), "branch data\n")
    }

    await validateCheckout(root)
  })

  it("runs the action guard before npm lifecycle and build scripts without leaking authorization", async () => {
    const action = await readFile(path.join(actionRoot, "action.yml"), "utf8")
    const guard = /run: (node [^\n]+validate-checkout[^\n]+)/.exec(action)
    assert.ok(guard, "The action must run checkout validation")
    assert.ok(
      action.indexOf("npm ci && npm run build") > guard.index,
      "The guard must precede repository execution",
    )

    const root = await gitRepository()
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
      const result = spawnSync("bash", ["-e", "-c", `${guard[1]}\nnpm ci && npm run build`], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTION_PATH: actionRoot,
          GITHUB_WORKSPACE: root,
          npm_config_audit: "false",
          npm_config_fund: "false",
          npm_config_cache: path.join(root, ".npm-cache"),
        },
      })
      assert.equal(result.error, undefined)
      return result
    }

    const clean = run()
    assert.equal(clean.status, 0, clean.stderr)
    for (const marker of ["installed", "built"]) {
      assert.equal(await readFile(path.join(root, marker), "utf8"), "executed")
      await rm(path.join(root, marker))
    }
    await writeFile(
      path.join(root, ".git", "config"),
      `[http]\nextraHeader = AUTHORIZATION: basic ${secret}\n`,
    )

    const unsafe = run()
    assert.equal(unsafe.status, 1)
    assert.ok(!`${unsafe.stdout}${unsafe.stderr}`.includes(secret))
    for (const marker of ["installed", "built"]) {
      await assert.rejects(access(path.join(root, marker)), { code: "ENOENT" })
    }
  })

  it("rejects authentication embedded in a remote URL", async () => {
    const root = await gitRepository()
    await writeFile(
      path.join(root, ".git", "config"),
      `[remote "origin"]\nurl = https://user:${secret}@github.com/example/prototype.git\n`,
    )

    await assert.rejects(validateCheckout(root), /persist-credentials: false/)
  })

  it("rejects authentication in recursive submodule metadata", async () => {
    const root = await gitRepository()
    const metadata = path.join(root, ".git", "modules", "parent", "modules", "child")
    await mkdir(metadata, { recursive: true })
    await writeFile(
      path.join(metadata, "config"),
      "[http]\nextraHeader = AUTHORIZATION: basic dummy\n",
    )

    await assert.rejects(validateCheckout(root), /persist-credentials: false/)
  })

  it("rejects authentication in worktree-specific config", async () => {
    const root = await gitRepository()
    await writeFile(
      path.join(root, ".git", "config"),
      "[core]\nrepositoryformatversion = 1\n[extensions]\nworktreeConfig = true\n",
    )
    await writeFile(
      path.join(root, ".git", "config.worktree"),
      "[http]\nextraHeader = AUTHORIZATION: basic dummy\n",
    )

    await assert.rejects(validateCheckout(root), /persist-credentials: false/)
  })

  it("fails closed when an include can hide additional configuration", async () => {
    const root = await gitRepository()
    await writeFile(path.join(root, ".git", "config"), '[include]\npath = "../hidden-config"\n')
    await writeFile(path.join(root, "hidden-config"), "[core]\nbare = false\n")

    await assert.rejects(validateCheckout(root), /persist-credentials: false/)
  })

  it("rejects Git metadata outside the workspace", async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    execFileSync("git", ["init", "--quiet", "--separate-git-dir", outside, root])

    await assert.rejects(validateCheckout(root), /outside the workspace/)
  })

  it("fails the CLI for malformed Git config without exposing its diagnostic input", async () => {
    const root = await gitRepository()
    await writeFile(
      path.join(root, ".git", "config"),
      `[http]\nextraHeader = AUTHORIZATION: basic ${secret}\n[broken\n`,
    )

    const result = spawnSync(process.execPath, [script, "--root", root], {
      encoding: "utf8",
      cwd: root,
    })

    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.notEqual(`${result.stdout}${result.stderr}`.trim(), "")
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret))
  })
})
