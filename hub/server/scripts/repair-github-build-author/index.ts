import "dotenv/config"

import { runGitHubBuildAuthorRepair } from "./run/index.ts"

await runGitHubBuildAuthorRepair(process.argv.slice(2))
