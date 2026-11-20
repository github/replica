import "dotenv/config"

import { runGitHubWebhookCheck } from "./run/index.ts"

await runGitHubWebhookCheck(process.argv.slice(2))
