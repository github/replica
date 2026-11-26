import { access } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root"
import { getLearningHistory } from "."

vi.mock("node:fs/promises", () => ({ access: vi.fn() }))
vi.mock("../../../integrations/learning/run-learning-command", () => ({
  runLearningCommand: vi.fn(),
}))
vi.mock("../../../utils/validate-private-storage-root", () => ({
  validatePrivateStorageRoot: vi.fn(),
}))

describe("getLearningHistory()", () => {
  beforeEach(() => {
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repositories/repo")
    vi.mocked(access).mockResolvedValue(undefined)
  })

  it("lists each decision people made, including edits and reinstatements", async () => {
    vi.mocked(runLearningCommand).mockResolvedValue({
      withheld: false,
      record: { evidence: [] },
      versions: [
        {
          version: 1,
          state: "proposed",
          proposal: { proposedAt: "2026-11-01T00:00:00.000Z", proposedBy: { id: "agent:x" } },
        },
        {
          version: 2,
          state: "accepted",
          accepted: { at: "2026-11-02T00:00:00.000Z", by: { id: "github:mona" } },
        },
        {
          version: 3,
          state: "accepted",
          accepted: {
            at: "2026-11-03T00:00:00.000Z",
            by: { id: "github:mona" },
            decision: "edit",
            note: "Clearer wording.",
          },
        },
        {
          version: 4,
          state: "retired",
          retired: { at: "2026-11-04T00:00:00.000Z", reason: "No longer true." },
        },
        { version: 5, state: "accepted", withheld: true },
      ],
    })

    const result = await getLearningHistory({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      learningId: "mem_1",
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    expect(result.decisions.map((decision) => [decision.change, decision.by])).toEqual([
      ["proposed", "agent:x"],
      ["accepted", "mona"],
      ["edited", "mona"],
      ["retired", null],
      ["accepted", null],
    ])
    expect(result.decisions[2]?.reason).toBe("Clearer wording.")
    expect(vi.mocked(runLearningCommand).mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["show", "mem_1", "--history"]),
    )
  })

  it("never passes a stored event ID that looks like a command option", async () => {
    vi.mocked(runLearningCommand)
      .mockResolvedValueOnce({
        withheld: false,
        record: {
          evidence: [{ episodeId: "ep_1", eventIds: ["evt_1", "--purpose", "evt 2"], source: {} }],
        },
        versions: [],
      })
      .mockResolvedValueOnce({ events: [] })

    await getLearningHistory({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      evidenceSource: { resolveEvidence: vi.fn().mockResolvedValue([]) },
      learningId: "mem_1",
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    const observationArguments = vi.mocked(runLearningCommand).mock.calls[1]?.[0] ?? []
    expect(observationArguments.filter((argument) => argument === "--event")).toHaveLength(1)
    expect(observationArguments).toContain("evt_1")
    expect(observationArguments).not.toContain("evt 2")
  })
})
