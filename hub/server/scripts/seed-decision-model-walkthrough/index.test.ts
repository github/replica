import { describe, expect, it } from "vitest"

import { validateResetState, validateSeedEnvironment } from "./validate-seed-environment"

const localEnvironment = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://replica:replica@127.0.0.1:5432/replica",
  ARTIFACT_STORAGE_PROVIDER: "filesystem",
}

describe("validateSeedEnvironment()", () => {
  it("rejects a non-local database before the walkthrough seed can reset data", () => {
    expect(() =>
      validateSeedEnvironment(
        {
          ...localEnvironment,
          DATABASE_URL: "postgresql://replica:replica@database.example.test:5432/replica",
        },
        "/workspace/learning/repositories/repository-1",
        "/workspace/learning",
      ),
    ).toThrow("requires a local development database")
  })

  it("rejects non-filesystem artifact storage before the walkthrough seed can reset data", () => {
    expect(() =>
      validateSeedEnvironment(
        { ...localEnvironment, ARTIFACT_STORAGE_PROVIDER: "azure-blob" },
        "/workspace/learning/repositories/repository-1",
        "/workspace/learning",
      ),
    ).toThrow("requires filesystem artifact storage")
  })

  it("allows reset only for a repository store inside the configured learning root", () => {
    expect(() =>
      validateSeedEnvironment(
        localEnvironment,
        "/workspace/learning/repositories/repository-1",
        "/workspace/learning",
      ),
    ).not.toThrow()
    expect(() =>
      validateSeedEnvironment(
        localEnvironment,
        "/workspace/learning-other/repository-1",
        "/workspace/learning",
      ),
    ).toThrow("must stay inside REPLICA_LEARNING_ROOT")
  })

  it("requires stopped jobs and a fresh dedicated runtime generation", () => {
    expect(() => validateResetState(1, 0)).toThrow("active walkthrough jobs")
    expect(() => validateResetState(0, 3)).toThrow("Reset the dedicated fixture runtime state")
    expect(() => validateResetState(0, 0)).not.toThrow()
  })
})
