import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"

import { validateCheckout } from "./index.mjs"

const script = fileURLToPath(new URL("./index.mjs", import.meta.url))
const secret = "dummy-checkout-credential-do-not-log"

async function checkout(t) {
  const root = await temporaryDirectory()
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return root
}

describe("validateCheckout()", () => {
  it("accepts a normal checkout with credential-free remote and repository settings", async (t) => {
    const root = await checkout(t)
    await writeFile(
      path.join(root, ".git", "config"),
      "[core]\nrepositoryformatversion = 0\nbare = false\n" +
        '[remote "origin"]\nurl = https://github.com/example/prototype.git\n' +
        "fetch = +refs/heads/*:refs/remotes/origin/*\n" +
        '[branch "main"]\nremote = origin\nmerge = refs/heads/main\n',
    )

    await assert.doesNotReject(validateCheckout(root))
  })

  for (const [name, config] of [
    [
      "an HTTP authorization header",
      `[http "https://github.com/"]\nextraHeader = AUTHORIZATION: basic ${secret}\n`,
    ],
    ["an HTTP cookie file", `[http]\ncookieFile = ${secret}\n`],
    ["a credential helper", `[credential]\nhelper = !echo ${secret}\n`],
    ["a scoped credential setting", `[credential "https://github.com"]\nusername = ${secret}\n`],
    ["a custom SSH command", `[core]\nsshCommand = echo ${secret}\n`],
    ["a custom askpass command", `[core]\naskPass = ${secret}\n`],
    ["an included config", `[include]\npath = ${secret}\n`],
    ["a conditional include", `[includeIf "gitdir:./"]\npath = ${secret}\n`],
    [
      "URL userinfo in a remote value",
      `[remote "origin"]\nurl = https://user:${secret}@github.com/example/prototype.git\n`,
    ],
    [
      "URL userinfo in a rewrite section key",
      `[url "https://user:${secret}@github.com/"]\ninsteadOf = https://github.com/\n`,
    ],
  ]) {
    it(`rejects ${name} without exposing its value`, async (t) => {
      const root = await checkout(t)
      await writeFile(path.join(root, ".git", "config"), config)

      await assert.rejects(validateCheckout(root), (error) => {
        assert.ok(error instanceof Error)
        assert.ok(!String(error).includes(secret))
        return true
      })
    })
  }

  it("rejects authentication persisted in a nested repository", async (t) => {
    const root = await checkout(t)
    const metadata = path.join(root, "packages", "nested", ".git")
    await mkdir(metadata, { recursive: true })
    await writeFile(
      path.join(metadata, "config"),
      `[http "https://github.com/"]\nextraHeader = AUTHORIZATION: basic ${secret}\n`,
    )

    await assert.rejects(validateCheckout(root))
  })

  it("rejects authentication persisted in worktree-specific config", async (t) => {
    const root = await checkout(t)
    await writeFile(
      path.join(root, ".git", "config"),
      "[core]\nrepositoryformatversion = 1\n[extensions]\nworktreeConfig = true\n",
    )
    await writeFile(
      path.join(root, ".git", "config.worktree"),
      `[http "https://github.com/"]\nextraHeader = AUTHORIZATION: basic ${secret}\n`,
    )

    await assert.rejects(validateCheckout(root), (error) => {
      assert.ok(error instanceof Error)
      assert.ok(!String(error).includes(secret))
      return true
    })
  })

  it("rejects authentication persisted in submodule metadata", async (t) => {
    const root = await checkout(t)
    const metadata = path.join(root, ".git", "modules", "packages", "nested")
    const submodule = path.join(root, "packages", "nested")
    await mkdir(metadata, { recursive: true })
    await mkdir(submodule, { recursive: true })
    await writeFile(path.join(submodule, ".git"), "gitdir: ../../.git/modules/packages/nested\n")
    await writeFile(
      path.join(metadata, "config"),
      `[remote "origin"]\nurl = https://user:${secret}@github.com/example/submodule.git\n`,
    )

    await assert.rejects(validateCheckout(root))
  })

  for (const [name, newline] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ]) {
    it(`accepts ${name} submodule gitfiles pointing to credential-free metadata inside the workspace`, async (t) => {
      const root = await checkout(t)
      const metadata = path.join(root, ".git", "modules", "packages", "nested")
      const submodule = path.join(root, "packages", "nested")
      await mkdir(path.dirname(metadata), { recursive: true })
      const initialized = spawnSync(
        "git",
        ["init", "--quiet", "--separate-git-dir", metadata, submodule],
        { encoding: "utf8" },
      )
      assert.equal(initialized.status, 0, initialized.stderr)
      await writeFile(
        path.join(submodule, ".git"),
        `gitdir: ../../.git/modules/packages/nested${newline}`,
      )
      const resolved = spawnSync("git", ["-C", submodule, "rev-parse", "--absolute-git-dir"], {
        encoding: "utf8",
      })
      assert.equal(resolved.status, 0, resolved.stderr)
      assert.equal(resolved.stdout.trimEnd(), metadata)

      await assert.doesNotReject(validateCheckout(root))
    })
  }

  it("accepts a commondir reference to credential-free metadata inside the workspace", async (t) => {
    const root = await checkout(t)
    const common = path.join(root, "common")
    await mkdir(common)
    await writeFile(path.join(root, ".git", "commondir"), "../common\n")
    await writeFile(
      path.join(common, "config"),
      '[remote "origin"]\nurl = https://github.com/example/prototype.git\n',
    )

    await assert.doesNotReject(validateCheckout(root))
  })

  it("rejects authentication in metadata reached through an internal commondir reference", async (t) => {
    const root = await checkout(t)
    const common = path.join(root, "common")
    await mkdir(common)
    await writeFile(path.join(root, ".git", "commondir"), "../common\n")
    await writeFile(path.join(common, "config"), `[credential]\nhelper = !echo ${secret}\n`)

    await assert.rejects(validateCheckout(root))
  })

  it("rejects a commondir reference outside the workspace even without authentication", async (t) => {
    const root = await checkout(t)
    const external = await checkout(t)
    await writeFile(path.join(root, ".git", "commondir"), `${path.join(external, ".git")}\n`)

    await assert.rejects(validateCheckout(root))
  })

  it("rejects malformed config without exposing Git's diagnostic input", async (t) => {
    const root = await checkout(t)
    await writeFile(
      path.join(root, ".git", "config"),
      `[http]\nextraHeader = AUTHORIZATION: basic ${secret}\n[broken\n`,
    )

    await assert.rejects(validateCheckout(root), (error) => {
      assert.ok(error instanceof Error)
      assert.ok(!String(error).includes(secret))
      return true
    })
  })

  it("rejects a gitfile pointing outside the workspace", async (t) => {
    const root = await checkout(t)
    const external = await checkout(t)
    await rm(path.join(root, ".git"), { recursive: true })
    await writeFile(path.join(root, ".git"), `gitdir: ${path.join(external, ".git")}\n`)

    await assert.rejects(validateCheckout(root))
  })

  it("rejects a symbolic link to Git metadata", async (t) => {
    const root = await checkout(t)
    const metadata = path.join(root, "external-metadata")
    await mkdir(metadata)
    await writeFile(path.join(metadata, "config"), "[core]\nbare = false\n")
    await rm(path.join(root, ".git"), { recursive: true })
    await symlink(metadata, path.join(root, ".git"), "dir")

    await assert.rejects(validateCheckout(root))
  })

  for (const [name, config] of [
    ["persisted authentication", `[http]\nextraHeader = AUTHORIZATION: basic ${secret}\n`],
    ["malformed config", `[http]\nextraHeader = AUTHORIZATION: basic ${secret}\n[broken\n`],
  ]) {
    it(`fails the CLI for ${name} without printing credentials`, async (t) => {
      const root = await checkout(t)
      await writeFile(path.join(root, ".git", "config"), config)

      const result = spawnSync(process.execPath, [script, "--root", root], {
        encoding: "utf8",
      })

      assert.equal(result.status, 1)
      assert.ok(`${result.stdout}${result.stderr}`.trim().length > 0)
      assert.ok(!`${result.stdout}${result.stderr}`.includes(secret))
    })
  }

  it("wires checkout validation before repository npm lifecycle and build execution", async (t) => {
    const action = await readFile(new URL("../../action.yml", import.meta.url), "utf8")
    const guard = action.match(
      /run: (node "\$GITHUB_ACTION_PATH\/scripts\/validate-checkout\/index\.mjs" --root "\$GITHUB_WORKSPACE")/,
    )
    const build = action.indexOf("npm ci && npm run build")

    assert.ok(guard, "The action must validate the workspace checkout")
    assert.ok(build >= 0, "The action must retain its repository build step")
    assert.ok(guard.index < build, "Checkout validation must precede repository execution")

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
      return spawnSync("bash", ["-e", "-c", `${guard[1]}\nnpm ci && npm run build`], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTION_PATH: fileURLToPath(new URL("../../", import.meta.url)),
          GITHUB_WORKSPACE: root,
          NODE_COMPILE_CACHE: path.join(root, ".node-cache"),
          npm_config_audit: "false",
          npm_config_fund: "false",
          npm_config_cache: path.join(root, ".npm-cache"),
        },
      })
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
      await assert.rejects(readFile(path.join(root, marker)), { code: "ENOENT" })
    }
  })
})
