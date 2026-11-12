import "dotenv/config"

// Make local sign-in the default for the development API. Use dev:api:live when
// testing a real provider.
process.env.NODE_ENV ??= "development"
process.env.HUB_LOCAL_SIGN_IN = "true"

await import("../../index.ts")
