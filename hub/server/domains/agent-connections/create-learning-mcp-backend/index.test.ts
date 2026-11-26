import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, onTestFinished, vi } from "vitest"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { createLearningMcpBackend } from "."

const runLearningCommand = vi.hoisted(() => vi.fn())
vi.mock("../../../integrations/learning/run-learning-command/index.ts", () => ({
  runLearningCommand,
}))

it("keeps server details out of what agents see when the store fails", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  runLearningCommand.mockRejectedValueOnce(
    new LearningCommandError("storage_corrupt", `The store at ${root} is damaged.`),
  )
  const backend = createLearningMcpBackend({
    confirmAccess: () => Promise.resolve(true),
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      learningDatabaseUrl: "postgresql://learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    serialize: (operation) => operation(new AbortController().signal),
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  const failure = backend.listLearnings({})

  await expect(failure).rejects.toBeInstanceOf(LearningCommandError)
})

it("passes the task through a private file and session values as data", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  let task = ""
  runLearningCommand.mockImplementationOnce(async (arguments_: string[]) => {
    task = await readFile(arguments_[arguments_.indexOf("--task-file") + 1]!, "utf8")
    return { guidanceId: "guidance", text: "Use tokens.", memories: [] }
  })
  const backend = createLearningMcpBackend({
    confirmAccess: () => Promise.resolve(true),
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      learningDatabaseUrl: "postgresql://learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    serialize: (operation) => operation(new AbortController().signal),
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  await backend.getGuidance({ task: "-private task", session: { id: "-s", label: "-l" } })

  const arguments_ = runLearningCommand.mock.calls.at(-1)![0] as string[]
  expect(task).toBe("-private task")
  expect(arguments_).not.toContain("-private task")
  expect(arguments_).toEqual(expect.arrayContaining(["--session-id=-s", "--session-label=-l"]))
})

it("withholds guidance when the connection loses access while the command runs", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  runLearningCommand.mockResolvedValueOnce({ guidanceId: "g", text: "Secret.", memories: [] })
  const backend = createLearningMcpBackend({
    confirmAccess: () => Promise.resolve(false),
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      learningDatabaseUrl: "postgresql://learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    serialize: (operation) => operation(new AbortController().signal),
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  const guidance = backend.getGuidance({})

  await expect(guidance).rejects.toThrow("access_denied")
})

it("withholds the text of a learning no one has accepted", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  runLearningCommand.mockResolvedValueOnce({
    record: { id: "memory-1", state: "proposed", text: "Unreviewed idea." },
    status: { recallEligible: false },
    withheld: false,
  })
  const backend = createLearningMcpBackend({
    confirmAccess: () => Promise.resolve(true),
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      learningDatabaseUrl: "postgresql://learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    serialize: (operation) => operation(new AbortController().signal),
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  const learning = await backend.getLearning({ id: "memory-1" })

  expect(JSON.stringify(learning)).not.toContain("Unreviewed idea.")
  expect(learning).toMatchObject({ id: "memory-1", state: "proposed", withheld: true })
})

it("gives no guidance for a repository without a learning store", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  runLearningCommand.mockClear()
  const backend = createLearningMcpBackend({
    confirmAccess: () => Promise.resolve(true),
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    serialize: (operation) => operation(new AbortController().signal),
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  const guidance = await backend.getGuidance({ task: "Build a form" })

  expect(guidance).toEqual({ guidanceId: null, text: "", learnings: [], screenshotsAllowed: false })
  expect(runLearningCommand).not.toHaveBeenCalled()
})

it("refuses screenshots for a repository that has not allowed them", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  runLearningCommand.mockClear()
  const backend = createLearningMcpBackend({
    confirmAccess: () => Promise.resolve(true),
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      learningDatabaseUrl: "postgresql://learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    screenshots: { grantId: () => Promise.resolve(null), save: vi.fn() },
    serialize: (operation) => operation(new AbortController().signal),
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  const report = backend.reportUsage({ used: [{ after: { data: "aW1hZ2U=" } }] })

  await expect(report).rejects.toThrow("unsupported")
  expect(runLearningCommand).not.toHaveBeenCalled()
})

it("keeps screenshot bytes only while the repository still allows screenshots", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  runLearningCommand.mockClear()
  runLearningCommand.mockResolvedValueOnce({ recorded: 1 }).mockResolvedValueOnce({ recorded: 1 })
  const grantId = vi
    .fn()
    .mockResolvedValueOnce("grant-1")
    .mockResolvedValueOnce("grant-1")
    .mockResolvedValueOnce("grant-1")
    .mockResolvedValueOnce(null)
  const save = vi.fn()
  const backend = createLearningMcpBackend({
    confirmAccess: () => Promise.resolve(true),
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      learningDatabaseUrl: "postgresql://learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    screenshots: { grantId, save },
    serialize: (operation) => operation(new AbortController().signal),
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  await backend.reportUsage({ used: [{ after: { data: "aW1hZ2U=" } }] })
  await backend.reportUsage({ used: [{ after: { data: "aW1hZ2U=" } }] })

  expect(runLearningCommand.mock.calls[0]![0]).toEqual(
    expect.arrayContaining(["--grant", "grant-1"]),
  )
  expect(save).toHaveBeenCalledOnce()
  expect(save).toHaveBeenCalledWith({ grantId: "grant-1", bytes: Buffer.from("image") })
})

it("asks Hub to score the commit an agent reports usage for", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "replica-agent-backend-")))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  runLearningCommand.mockResolvedValueOnce({ recorded: 1 })
  const requestScore = vi.fn()
  const backend = createLearningMcpBackend({
    confirmAccess: () => Promise.resolve(true),
    connectionId: "connection",
    learning: {
      applicationRoot: join(root, "app"),
      cliPath: "replica-learning",
      learningDatabaseUrl: "postgresql://learning",
      nodePath: process.execPath,
      root: join(root, "learning"),
      staticDirectories: [],
    },
    learningsUrl: "https://hub.example/learnings",
    repository: { id: "9f8f1d8e-4c1a-4a4b-8d43-6a9f6a6e7f10", githubRepositoryId: 1n },
    requestScore,
    serialize: (operation) => operation(new AbortController().signal),
    toAgentError: (code, message) => new Error(`${code}: ${message}`),
  })

  await backend.reportUsage({ commitSha: "a".repeat(40), used: [] })

  expect(requestScore).toHaveBeenCalledWith("a".repeat(40))
})
