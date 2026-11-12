import "dotenv/config"

import { readAuthenticationConfigurationState } from "../../domains/authentication/read-authentication-configuration-state/index.ts"

process.env.NODE_ENV ??= "development"
process.env.HUB_LOCAL_SIGN_IN = "false"

const { githubConfigured, entraConfigured } = readAuthenticationConfigurationState(process.env)
if (!githubConfigured && !entraConfigured) {
  throw new Error("Configure GitHub or Entra sign-in before running npm run dev:api:live.")
}

await import("../../index.ts")
