import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupShowPage } from "."
import type { GithubAppSetupShowPageProps, GithubAppSetupStatusData } from "./types"

const urls = {
  homepage: "https://hub.example.com",
  callback: "https://hub.example.com/api/auth/github/callback",
  setup: "https://hub.example.com/settings/github/setup?step=install",
  webhook: "https://hub.example.com/api/github/webhooks",
}

const keys = [
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PROVIDER_REVISION",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_WEBHOOK_SECRET",
]

function status(
  state: GithubAppSetupStatusData["status"],
  settingState: (key: string) => "present" | "missing" | "invalid",
): GithubAppSetupStatusData {
  return {
    status: state,
    signInEnabled: state === "configured",
    settings: keys.map((key) => ({ key, state: settingState(key) })),
    urls,
    connectedRepositories:
      state === "configured" ? ["octo/checkout-flow", "octo/design-review"] : [],
  }
}

const args: GithubAppSetupShowPageProps = {
  status: status("not_configured", () => "missing"),
  bootstrap: { error: null, pending: false, onSubmit: () => {} },
  organization: "",
  onOrganizationChange: () => {},
  creationUrl: "https://github.com/settings/apps/new",
  connection: { checks: null, testing: false, error: null, onTest: () => {} },
  signInPath: "/sign-in",
}

const meta = {
  title: "Hub/Pages/GitHub Setup/Setup",
  component: GithubAppSetupShowPage,
  args,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupShowPage>

export default meta
type Story = StoryObj<typeof meta>

export const Bootstrap: Story = { args: { status: null } }

export const BootstrapRejected: Story = {
  args: {
    status: null,
    bootstrap: { error: "The bootstrap secret is incorrect.", pending: false, onSubmit: () => {} },
  },
}

export const NotConfigured: Story = {}

export const Incomplete: Story = {
  args: {
    status: status("incomplete", (key) =>
      key === "GITHUB_APP_PRIVATE_KEY_BASE64"
        ? "invalid"
        : key === "GITHUB_WEBHOOK_SECRET"
          ? "missing"
          : "present",
    ),
  },
}

export const Configured: Story = { args: { status: status("configured", () => "present") } }

export const ConnectionVerified: Story = {
  args: {
    status: status("configured", () => "present"),
    connection: {
      checks: [
        { name: "private_key", result: "pass", detail: "The private key is valid." },
        { name: "app_identity", result: "pass", detail: "Signed in to GitHub as replica-hub." },
        {
          name: "installation",
          result: "pass",
          detail: "The installation is active.",
          settingsUrl: "https://github.com/organizations/octo/settings/installations/123",
        },
        {
          name: "callback_url",
          result: "unknown",
          detail: "GitHub does not expose callback URLs. Confirm it in the App settings.",
        },
        {
          name: "repositories",
          result: "pass",
          detail:
            "Hub can read 12 repositories: octo/checkout-flow, octo/design-review, and 10 more.",
        },
      ],
      testing: false,
      error: null,
      onTest: () => {},
    },
  },
}

export const ConnectionFailed: Story = {
  args: {
    status: status("configured", () => "present"),
    connection: {
      checks: [
        { name: "private_key", result: "pass", detail: "The private key is valid." },
        {
          name: "app_identity",
          result: "fail",
          detail: "GitHub rejected the App ID and private key.",
        },
        { name: "installation", result: "unknown", detail: "Not checked." },
        { name: "callback_url", result: "unknown", detail: "Not checked." },
      ],
      testing: false,
      error: null,
      onTest: () => {},
    },
  },
}
