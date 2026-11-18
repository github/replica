import { describe, expect, it, vi } from "vitest"

import { prepareLocalDevelopment } from "../../domains/local-development/prepare-local-development"
import { readLocalDevelopmentConfiguration } from "../../domains/local-development/read-local-development-configuration"
import { createJobQueue } from "../../integrations/bullmq/create-job-queue"
import { enqueueJob } from "../../integrations/bullmq/enqueue-job"
import { enqueueLocalBuilds } from "."

const mocks = vi.hoisted(() => ({ close: vi.fn() }))

vi.mock("../../domains/local-builds/get-local-build-job-definition", () => ({
  getLocalBuildJobDefinition: vi.fn(() => ({ name: "local-builds" })),
}))
vi.mock("../../domains/local-development/prepare-local-development", () => ({
  prepareLocalDevelopment: vi.fn(),
}))
vi.mock("../../domains/local-development/read-local-development-configuration", () => ({
  readLocalDevelopmentConfiguration: vi.fn(),
}))
vi.mock("../../integrations/bullmq/create-job-queue", () => ({
  createJobQueue: vi.fn(() => ({ close: mocks.close })),
}))
vi.mock("../../integrations/bullmq/enqueue-job", () => ({
  enqueueJob: vi.fn(() => Promise.resolve({ id: "job-1" })),
}))
vi.mock("../../integrations/pino", () => ({
  logger: {},
}))

describe("enqueueLocalBuilds()", () => {
  it("prepares the shared local configuration before enqueueing", async () => {
    const environment = {
      DATABASE_URL: "postgresql://replica@127.0.0.1:5432/replica",
      HUB_LOCAL_MODE: "true",
      NODE_ENV: "development",
    }
    const configuration = {
      buildActionDirectory: "/configured/build-action",
      createPrototypeScript: "/repository/scripts/create-prototype-repo.sh",
      enabled: true as const,
      root: "/configured/prototypes",
      sourceRoot: "/repository",
      temporaryRoot: "/configured/temporary",
    }
    vi.mocked(readLocalDevelopmentConfiguration).mockReturnValue(configuration)
    vi.spyOn(console, "log").mockImplementation(() => undefined)

    await enqueueLocalBuilds(environment)

    expect(readLocalDevelopmentConfiguration).toHaveBeenCalledExactlyOnceWith(environment)
    expect(prepareLocalDevelopment).toHaveBeenCalledExactlyOnceWith(configuration)
    expect(vi.mocked(prepareLocalDevelopment).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createJobQueue).mock.invocationCallOrder[0]!,
    )
    expect(createJobQueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        databaseUrl: environment.DATABASE_URL,
        name: "on-demand",
      }),
    )
    expect(enqueueJob).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
