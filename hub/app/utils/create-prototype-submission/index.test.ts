import { describe, expect, it } from "vitest"

import { createPrototypeSubmission } from "."

describe("createPrototypeSubmission()", () => {
  it("encodes the repository, base branch and complete prompt in the app launcher", () => {
    const prompt = "Change the header & footer.\n\nCreate a new prototype."
    const submission = createPrototypeSubmission({
      repositoryName: "github/prototype",
      branchName: "release/base",
      prompt,
    })
    const launcher = new URL(submission.url)
    const appUrl = new URL(launcher.searchParams.get("open")!)
    expect(launcher.origin).toBe("https://github.com")
    expect(launcher.pathname).toBe("/copilot/app/launch")
    expect(appUrl.protocol).toBe("ghapp:")
    expect(appUrl.searchParams.get("repo")).toBe("github/prototype")
    expect(appUrl.searchParams.get("base_branch")).toBe("release/base")
    expect(appUrl.searchParams.get("prompt")).toBe(prompt)
    expect(appUrl.searchParams.get("mode")).toBe("autopilot")
    expect(submission.prompt).toBe(prompt)
  })

  it("keeps the existing new-prototype handoff without an explicit base branch", () => {
    const submission = createPrototypeSubmission({
      repositoryName: "github/prototype",
      prompt: "Build a welcome page.",
    })
    const appUrl = new URL(new URL(submission.url).searchParams.get("open")!)
    expect(appUrl.searchParams.has("base_branch")).toBe(false)
  })
})
