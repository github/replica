import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"

import type { PrototypeState } from "@utils/prototype-canvas/types"
import { publicationHub } from "@utils/resolve-prototype-publication/fixtures"
import { sharingFixture } from "./sharing-fixture"
import { App } from ".."

describe("App()", () => {
  it("keeps older-Hub sharing progress after the real state refresh observes a pushed branch", async () => {
    const states = JSON.parse(
      execFileSync(
        "node",
        [
          "--input-type=module",
          "-e",
          `
  import { execFileSync } from "node:child_process"
  import { mkdir, writeFile } from "node:fs/promises"
  import path from "node:path"
  import { withContext } from "./.github/extensions/replica-prototype/test-support/with-context/index.mjs"
  import { getPrototypeState } from "./.github/extensions/replica-prototype/get-prototype-state/index.mjs"
  import { readState } from "./.github/extensions/replica-prototype/read-state/index.mjs"
  import { writeState } from "./.github/extensions/replica-prototype/write-state/index.mjs"
  import { capturePublishTarget } from "./.github/extensions/replica-prototype/publish-target/index.mjs"
  await withContext(async (context) => {
    const cwd = context.repositoryPath
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim()
    execFileSync("git", ["remote", "add", "origin", "https://github.com/github/replica.git"], { cwd })
    await mkdir(path.join(cwd, ".github/workflows"), { recursive: true })
    await writeFile(path.join(cwd, ".github/workflows/replica.yml"), "name: Replica\\n")
    const refs = path.join(cwd, "refs.json")
    await writeFile(refs, "[]")
    await writeFile(path.join(cwd, "gh"), '#!/bin/sh\\nif [ "$1:$2" = "run:list" ]; then\\n  printf "[]"\\nelse\\n  cat "' + refs + '"\\nfi\\n', { mode: 0o755 })
    process.env.PATH = cwd + ":" + process.env.PATH
    const state = await readState(context)
    state.publishRequest = {
      state: "requested",
      requestedAt: new Date().toISOString(),
      commitSha: sha,
      target: await capturePublishTarget(context),
      remoteState: "absent",
      remoteSha: null,
      workflowRunId: null,
    }
    await writeState(context, state)
    const before = await getPrototypeState(context, { refresh: true })
    await writeFile(refs, JSON.stringify([{ ref: "refs/heads/prototype", object: { type: "commit", sha } }]))
    const after = await getPrototypeState(context, { refresh: true })
    process.stdout.write(JSON.stringify({ before, after }))
  })
  `,
        ],
        { cwd: "..", encoding: "utf8" },
      ),
    ) as { before: PrototypeState; after: PrototypeState }
    expect(states.before.stats.remoteBranch?.state).toBe("absent")
    expect(states.before.publishRequest?.state).toBe("requested")
    expect(states.after.stats.remoteBranch?.state).toBe("present")
    expect(states.after.publishRequest?.state).toBe("idle")
    expect(states.after.publishRequest?.remoteState).toBe("absent")
    const { fixture } = sharingFixture(states.before, {
      ...publicationHub,
      repository: states.before.stats.repository,
      branch: states.before.stats.branch,
      commitSha: states.before.stats.commitSha,
      canPublish: undefined,
      repositoryAuthorized: true,
    })
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Waiting for Copilot" })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    await screen.findByRole("dialog", { name: "Preparing your prototype" })
    fixture.state = states.after
    fireEvent.focus(window)
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getByText(
          "The exact branch and commit are on GitHub, but no matching Replica workflow run has appeared yet.",
        ),
      ).toBeInTheDocument(),
    )
    expect(screen.getByRole("dialog", { name: "Preparing your prototype" })).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: "Sharing status unavailable" }),
    ).not.toBeInTheDocument()
    view.unmount()
  })
})
