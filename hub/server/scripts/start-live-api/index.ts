import "dotenv/config"

import { readAuthenticationConfigurationState } from "../../domains/authentication/read-authentication-configuration-state/index.ts"

process.env.NODE_ENV ??= "development"
process.env.HUB_LOCAL_SIGN_IN = "false"

const { applicationOrigin, entraConfigured, githubSettingsPresent } =
  readAuthenticationConfigurationState(process.env)
if (!applicationOrigin && !githubSettingsPresent && !entraConfigured) {
  throw new Error(
    "Set HUB_APPLICATION_ORIGIN to use GitHub setup, or configure GitHub or Entra sign-in, before running npm run dev:api:live.",
  )
}

await import("../../index.ts")
