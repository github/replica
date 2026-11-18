import "dotenv/config"

process.env.NODE_ENV ??= "development"
process.env.HUB_LOCAL_MODE = "true"
process.env.RUNTIME_MODE = "on-demand"

await import("../../index.ts")
