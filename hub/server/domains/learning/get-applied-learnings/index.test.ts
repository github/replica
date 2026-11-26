import { access } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root"
import { getAppliedLearnings } from "."

vi.mock("node:fs/promises", () => ({ access: vi.fn() }))
vi.mock("../../../integrations/learning/run-learning-command", () => ({
  runLearningCommand: vi.fn(),
}))
vi.mock("../../../utils/validate-private-storage-root", () => ({
  validatePrivateStorageRoot: vi.fn(),
}))

describe("getAppliedLearnings()", () => {
  it("lists learnings reported for this prototype's commit, skipping other prototypes", async () => {
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repositories/repo")
    vi.mocked(access).mockResolvedValue(undefined)
    const digest = "a".repeat(64)
    vi.mocked(runLearningCommand).mockResolvedValue({
      reports: [
        {
          used: [
            {
              memoryId: "mem_1",
              version: 2,
              title: "Label every field",
              after: { sha256: `sha256:${digest}`, route: "/checkout", consentGrantId: "grant-1" },
            },
          ],
        },
        {
          prototypeId: "another-prototype",
          used: [{ memoryId: "mem_2", version: 1, title: "Use one column" }],
        },
      ],
    })

    const result = await getAppliedLearnings({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      commitSha: "b".repeat(40),
      nodePath: "/node",
      prototypeId: "this-prototype",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    expect(result).toEqual([
      {
        id: "mem_1",
        title: "Label every field",
        version: 2,
        after: { sha256: digest, route: "/checkout", consentGrantId: "grant-1" },
      },
    ])
    expect(vi.mocked(runLearningCommand).mock.calls[0]?.[0].slice(0, 3)).toEqual([
      "usage",
      "--commit",
      "b".repeat(40),
    ])
  })
})
