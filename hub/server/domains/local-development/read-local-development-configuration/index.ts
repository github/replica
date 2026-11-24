import { isAbsolute, relative, resolve } from "node:path"
import { tmpdir } from "node:os"

import { LocalDevelopmentConfigurationError } from "../errors.ts"
import type { LocalDevelopmentConfiguration } from "../types.ts"

function readBoolean(value: string | undefined) {
  if (value === undefined || value === "0" || value === "false") return false
  if (value === "1" || value === "true") return true
  throw new LocalDevelopmentConfigurationError("HUB_LOCAL_MODE must be true, false, 1, or 0.")
}

function isWithin(parent: string, child: string) {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

export function readLocalDevelopmentConfiguration(
  environment: NodeJS.ProcessEnv,
  applicationRoot = process.cwd(),
): LocalDevelopmentConfiguration {
  if (!readBoolean(environment.HUB_LOCAL_MODE)) return { enabled: false }
  if (environment.NODE_ENV !== "development") {
    throw new LocalDevelopmentConfigurationError(
      "HUB_LOCAL_MODE is available only when NODE_ENV=development.",
    )
  }
  const runtimeMode = environment.RUNTIME_MODE ?? "api"
  if (runtimeMode !== "api" && runtimeMode !== "on-demand") {
    throw new LocalDevelopmentConfigurationError(
      "HUB_LOCAL_MODE is available only for the development API or on-demand worker runtime.",
    )
  }

  const hubRoot = resolve(applicationRoot)
  const sourceRoot = resolve(hubRoot, "..")
  const configuredRoot = environment.LOCAL_PROTOTYPE_ROOT
  if (configuredRoot && !isAbsolute(configuredRoot)) {
    throw new LocalDevelopmentConfigurationError(
      "LOCAL_PROTOTYPE_ROOT must be an absolute directory.",
    )
  }
  const configuredBuildAction = environment.LOCAL_REPLICA_BUILD_ACTION_ROOT
  if (configuredBuildAction && !isAbsolute(configuredBuildAction)) {
    throw new LocalDevelopmentConfigurationError(
      "LOCAL_REPLICA_BUILD_ACTION_ROOT must be an absolute directory.",
    )
  }
  const configuredTemporaryRoot = environment.LOCAL_BUILD_TEMPORARY_ROOT
  if (configuredTemporaryRoot && !isAbsolute(configuredTemporaryRoot)) {
    throw new LocalDevelopmentConfigurationError(
      "LOCAL_BUILD_TEMPORARY_ROOT must be an absolute directory.",
    )
  }
  const root = configuredRoot ?? resolve(hubRoot, ".local/prototypes")
  if (root === hubRoot || isWithin(resolve(hubRoot, "storage"), root)) {
    throw new LocalDevelopmentConfigurationError(
      "LOCAL_PROTOTYPE_ROOT must be a dedicated directory separate from Hub production data.",
    )
  }

  return {
    enabled: true,
    root,
    sourceRoot,
    buildActionDirectory: configuredBuildAction ?? resolve(sourceRoot, "actions/build"),
    createPrototypeScript: resolve(sourceRoot, "scripts/create-prototype-repo.sh"),
    temporaryRoot: configuredTemporaryRoot ?? tmpdir(),
  }
}
