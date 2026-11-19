import { beforeEach, describe, expect, it, vi } from "vitest"

import { createConfiguredArtifactStorage } from "../../domains/artifacts/create-configured-artifact-storage"
import { synchronizeLocalBuilds } from "../../domains/local-builds/synchronize-local-builds"
import { prepareLocalDevelopment } from "../../domains/local-development/prepare-local-development"
import { readLocalDevelopmentConfiguration } from "../../domains/local-development/read-local-development-configuration"
import { logger } from "../../integrations/pino"
import { runLocalBuilds } from "."

vi.mock("../../domains/artifacts/create-configured-artifact-storage", () => ({
  createConfiguredArtifactStorage: vi.fn(),
}))
vi.mock("../../domains/local-builds/synchronize-local-builds", () => ({
  synchronizeLocalBuilds: vi.fn(),
}))
vi.mock("../../domains/local-development/prepare-local-development", () => ({
  prepareLocalDevelopment: vi.fn(),
}))
vi.mock("../../domains/local-development/read-local-development-configuration", () => ({
  readLocalDevelopmentConfiguration: vi.fn(),
}))
vi.mock("../../integrations/pino", () => ({
  logger: { info: vi.fn() },
}))
vi.mock("../../integrations/prisma/index.ts", () => ({
  prisma: { $disconnect: vi.fn() },
}))

describe("runLocalBuilds()", () => {
  beforeEach(() => {
    vi.mocked(createConfiguredArtifactStorage).mockResolvedValue({} as never)
  })

  it("prepares and synchronizes with the shared local configuration", async () => {
    const environment = {
      DATABASE_URL: "postgresql://replica@127.0.0.1:5432/replica",
      HUB_LOCAL_MODE: "true",
      NODE_ENV: "development",
    }
    const configuration = {
      actionRoot: "/configured/build-action",
      prototypeRoot: "/configured/prototypes",
      temporaryRoot: "/configured/temporary",
    }
    vi.mocked(readLocalDevelopmentConfiguration).mockReturnValue({
      buildActionDirectory: configuration.actionRoot,
      createPrototypeScript: "/repository/scripts/create-prototype-repo.mjs",
      enabled: true,
      root: configuration.prototypeRoot,
      sourceRoot: "/repository",
      temporaryRoot: configuration.temporaryRoot,
    })
    vi.mocked(synchronizeLocalBuilds).mockResolvedValue({} as never)

    await runLocalBuilds(environment)

    expect(readLocalDevelopmentConfiguration).toHaveBeenCalledExactlyOnceWith(environment)
    expect(prepareLocalDevelopment).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        buildActionDirectory: configuration.actionRoot,
        root: configuration.prototypeRoot,
        temporaryRoot: configuration.temporaryRoot,
      }),
    )
    expect(vi.mocked(prepareLocalDevelopment).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(synchronizeLocalBuilds).mock.invocationCallOrder[0]!,
    )
    expect(synchronizeLocalBuilds).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining(configuration),
    )
    expect(logger.info).toHaveBeenCalledOnce()
  })
})
