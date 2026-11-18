import { z } from "zod"

export const githubSettingKeySchema = z.enum([
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PROVIDER_REVISION",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_WEBHOOK_SECRET",
])

const configurationStatusSchema = z.enum(["not_configured", "incomplete", "configured"])

export const githubSetupStatusSchema = z.object({
  status: configurationStatusSchema,
  signInEnabled: z.boolean(),
  settings: z.array(
    z.object({ key: githubSettingKeySchema, state: z.enum(["present", "missing", "invalid"]) }),
  ),
  urls: z.object({
    homepage: z.url(),
    callback: z.url(),
    setup: z.url(),
    webhook: z.url(),
  }),
  connectedRepositories: z.array(z.string().min(1)),
})

export const githubConnectionTestSchema = z.object({
  checks: z.array(
    z.object({
      name: z.enum(["private_key", "app_identity", "installation", "callback_url", "repositories"]),
      result: z.enum(["pass", "fail", "unknown"]),
      detail: z.string(),
      settingsUrl: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }).optional(),
    }),
  ),
})
