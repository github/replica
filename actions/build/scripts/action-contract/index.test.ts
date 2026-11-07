import { execFile } from "node:child_process"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

describe("Replica composite action", () => {
  it.each([
    { skipBuild: undefined, outputDirectory: undefined, builds: true },
    { skipBuild: "true", outputDirectory: "website/public", builds: false },
  ])(
    "runs the expected build and retained-package steps for skip-build=$skipBuild",
    async ({ skipBuild, outputDirectory, builds }) => {
      const action = await readFile(path.resolve("action.yml"), "utf8")
      const skipDefault = action.match(/ {2}skip-build:[\s\S]*? {4}default: "?([^"\n]+)"?/)?.[1]
      const outputDefault = action.match(/ {2}output-directory:[\s\S]*? {4}default: ([^\n]+)/)?.[1]
      expect(skipDefault).toBe("false")
      expect(outputDefault).toBe("dist")
      const input = skipBuild ?? skipDefault!
      const directory = outputDirectory ?? outputDefault!
      const root = await temporaryDirectory()
      const bin = path.join(root, "bin")
      const actionPath = path.join(root, "action")
      const workspace = path.join(root, "workspace")
      const runner = path.join(root, "runner")
      const trace = path.join(root, "trace.jsonl")
      await mkdir(bin)
      await mkdir(workspace)
      await mkdir(runner)
      await mkdir(path.join(actionPath, "node_modules", ".bin"), { recursive: true })
      const executable = `#!${process.execPath}
import { appendFileSync } from "node:fs"
appendFileSync(process.env.TRACE, JSON.stringify({ command: process.argv[1].split("/").at(-1), args: process.argv.slice(2), cwd: process.cwd() }) + "\\n")
`
      for (const command of ["node", "npm", "docker"]) {
        await writeFile(path.join(bin, command), executable, { mode: 0o755 })
      }
      await writeFile(path.join(actionPath, "node_modules", ".bin", "playwright"), executable, {
        mode: 0o755,
      })

      for (const step of action.split(/^ {4}- name: /m).slice(1)) {
        const run = step.match(/^ {6}run: (.+)$/m)?.[1]
        if (!run) continue
        const condition = step.match(/^ {6}if: (.+)$/m)?.[1]
        if (condition) {
          expect(condition).toBe("inputs.skip-build != 'true'")
          if (input === "true") continue
        }
        const script =
          run === "|"
            ? step
                .slice(step.indexOf("      run: |") + "      run: |".length)
                .split("\n")
                .filter((line) => line.startsWith("        "))
                .map((line) => line.slice(8))
                .join("\n")
            : run.replace(/^'(.*)'$/, "$1")
        await promisify(execFile)("bash", ["-e", "-c", script], {
          cwd: step.includes("working-directory:") ? actionPath : workspace,
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            TRACE: trace,
            GITHUB_ACTION_PATH: actionPath,
            GITHUB_WORKSPACE: workspace,
            RUNNER_TEMP: runner,
            REPLICA_SKIP_BUILD: input,
            REPLICA_OUTPUT_DIRECTORY: directory,
          },
        })
      }

      const calls = (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { command: string; args: string[]; cwd: string })
      const scripts = calls.filter((call) => call.command === "node")
      expect(scripts.some((call) => call.args[0].includes("validate-checkout"))).toBe(true)
      expect(scripts.some((call) => call.args[0].includes("validate-repository"))).toBe(builds)
      expect(calls.some((call) => call.command === "docker")).toBe(builds)
      expect(calls.filter((call) => call.command === "npm")).toStrictEqual([
        {
          command: "npm",
          args: ["ci", "--ignore-scripts", "--omit=dev"],
          cwd: await realpath(actionPath),
        },
      ])
      const prepare = scripts.find((call) => call.args[0].includes("prepare-build-output"))!
      expect(prepare.args.slice(1)).toStrictEqual([
        "--root",
        workspace,
        "--output-directory",
        directory,
        "--output",
        path.join(runner, "replica-build-root"),
      ])
      const capture = scripts.find((call) => call.args[0].includes("capture-screenshots"))!
      expect(capture.args).toContain(workspace)
      expect(capture.args).toContain(path.join(runner, "replica-build-root"))
      const pack = scripts.find((call) => call.args[0].includes("create-package"))!
      expect(pack.args).toContain(path.join(runner, "replica-build-root"))
      expect(pack.args).toContain(path.join(runner, "replica-build-v1"))
      expect(calls.some((call) => call.command === "playwright")).toBe(true)
      const upload = action.split("uses: actions/upload-artifact@")[1]
      expect(upload).toMatch(/name: replica-build-v1/)
      expect(upload).toMatch(/path: \$\{\{ runner\.temp \}\}\/replica-build-v1\//)
    },
  )
})
