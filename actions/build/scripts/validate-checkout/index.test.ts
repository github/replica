import { execFileSync, spawnSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { validateCheckout } from "./index.ts"

const actionRoot = fileURLToPath(new URL("../../", import.meta.url))
const script = fileURLToPath(new URL("./index.ts", import.meta.url))

describe("validateCheckout()", () => {
  it("accepts an ordinary checkout with a credential-free internal submodule", async () => {
    const root = await temporaryDirectory()
    execFileSync("git", ["init", "--quiet", root])
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

    await expect(validateCheckout(root)).resolves.toBeUndefined()
  })

  it("runs the action guard before npm lifecycle and build scripts without leaking authorization", async () => {
    const secret = "dummy-checkout-credential-do-not-log"
    const authorization = `[http]\nextraHeader = AUTHORIZATION: basic ${secret}\n`
    const action = await readFile(path.join(actionRoot, "action.yml"), "utf8")
    const guard = /run: (node [^\n]+validate-checkout[^\n]+)/.exec(action)
    if (!guard) throw new Error("The action must run checkout validation")
    const guardCommand = guard[1]
    const build = action.indexOf("npm ci && npm run build")
    expect(build, "The guard must precede repository execution").toBeGreaterThan(guard.index)

    const root = await temporaryDirectory()
    execFileSync("git", ["init", "--quiet", root])
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
      expect(result.error).toBeUndefined()
      return result
    }

    const clean = run()
    expect(clean.status, clean.stderr).toBe(0)
    for (const marker of ["installed", "built"]) {
      expect(await readFile(path.join(root, marker), "utf8")).toBe("executed")
      await rm(path.join(root, marker))
    }
    await writeFile(path.join(root, ".git", "config"), authorization)

    const unsafe = run()
    expect(unsafe.status).toBe(1)
    expect(`${unsafe.stdout}${unsafe.stderr}`).not.toContain(secret)
    for (const marker of ["installed", "built"]) {
      await expect(readFile(path.join(root, marker))).rejects.toMatchObject({ code: "ENOENT" })
    }
  })

  it("rejects authentication embedded in a remote URL", async () => {
    const secret = "dummy-checkout-credential-do-not-log"
    const root = await temporaryDirectory()
    execFileSync("git", ["init", "--quiet", root])
    await writeFile(
      path.join(root, ".git", "config"),
      `[remote "origin"]\nurl = https://user:${secret}@github.com/example/prototype.git\n`,
    )

    await expect(validateCheckout(root)).rejects.toThrow()
  })

  it("rejects authentication in recursive submodule metadata", async () => {
    const root = await temporaryDirectory()
    execFileSync("git", ["init", "--quiet", root])
    const metadata = path.join(root, ".git", "modules", "parent", "modules", "child")
    await mkdir(metadata, { recursive: true })
    await writeFile(
      path.join(metadata, "config"),
      "[http]\nextraHeader = AUTHORIZATION: basic dummy\n",
    )

    await expect(validateCheckout(root)).rejects.toThrow()
  })

  it("rejects authentication in worktree-specific config", async () => {
    const root = await temporaryDirectory()
    execFileSync("git", ["init", "--quiet", root])
    await writeFile(
      path.join(root, ".git", "config"),
      "[core]\nrepositoryformatversion = 1\n[extensions]\nworktreeConfig = true\n",
    )
    await writeFile(
      path.join(root, ".git", "config.worktree"),
      "[http]\nextraHeader = AUTHORIZATION: basic dummy\n",
    )

    await expect(validateCheckout(root)).rejects.toThrow()
  })

  it("fails closed when an include can hide additional configuration", async () => {
    const root = await temporaryDirectory()
    execFileSync("git", ["init", "--quiet", root])
    await writeFile(path.join(root, ".git", "config"), '[include]\npath = "../hidden-config"\n')
    await writeFile(path.join(root, "hidden-config"), "[core]\nbare = false\n")

    await expect(validateCheckout(root)).rejects.toThrow()
  })

  it("fails the CLI for malformed Git config without exposing its diagnostic input", async () => {
    const secret = "dummy-checkout-credential-do-not-log"
    const authorization = `[http]\nextraHeader = AUTHORIZATION: basic ${secret}\n`
    const root = await temporaryDirectory()
    execFileSync("git", ["init", "--quiet", root])
    await writeFile(path.join(root, ".git", "config"), `${authorization}[broken\n`)

    const result = spawnSync(process.execPath, [script, "--root", root], {
      encoding: "utf8",
      cwd: root,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`.trim()).not.toBe("")
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret)
  })
})
