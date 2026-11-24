import "dotenv/config"

import { runPrivatePreviewReplay } from "./run/index.ts"

await runPrivatePreviewReplay(process.argv.slice(2))
