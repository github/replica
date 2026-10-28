import type { Meta, StoryObj } from "@storybook/react-vite"

import { GithubAppSetupManualPage } from "."

const meta = {
  title: "Hub/Pages/GitHub Setup/Manual",
  component: GithubAppSetupManualPage,
  args: {
    data: {
      pageTitle: "Connect an existing GitHub App",
      productName: "Replica Hub",
      heading: "Connect your GitHub App.",
      description:
        "Configure the App on your GitHub host, install it on the intended account, then enter its credentials here. Hub will not change the App's GitHub settings.",
      authenticityToken: "storybook-token",
      submitPath: "/setup/manual",
      submitLabel: "Verify and connect this installation",
      confirmLabel:
        "I approve this App and installation for this Hub. I have checked the installation's account and selected repositories, configured the webhook, and understand that App credentials and webhook settings affect every installation of this App.",
      keyLabel: "Private keys - PEM file",
      keyHint:
        "In the App's settings, open Credentials (or General in older layouts), then Private keys and Generate a private key. Upload the downloaded PEM file (at most 16 KiB). Credentials are never shown again; re-enter them after an error.",
      instructions: [
        {
          title: "1. General",
          body: "On your GitHub host, open your account or organization's Settings, Developer settings, GitHub Apps, then New GitHub App. For an existing App, open its settings instead. Use the values below. Leave Setup URL blank, and leave Request user authorization (OAuth) during installation and Redirect on update unchecked. Leave user authorization token expiration enabled. Return here after installing.",
        },
        {
          title: "2. Permissions & events",
          body: "Set the repository permissions below. Under Subscribe to events, select Push and Workflow run. GitHub also delivers installation and installation-repository changes. Save the settings. For an existing installation, its account administrator must approve any increased permissions; Hub access cannot grant that authority.",
        },
        {
          title: "3. Webhook and visibility",
          body: "Enable Active under Webhook, use the Webhook URL above, generate a long random Webhook secret, and keep SSL verification enabled. Enter the same secret below. GitHub must be able to reach Hub over HTTPS. A private App restricts who can authorize it; cross-account installation and team sign-in may require a public App, subject to GitHub policy. Public visibility does not make repositories public. Do not reuse an App whose webhook serves another integration; its URL and secret are shared across all installations.",
        },
        {
          title: "4. Install App",
          body: "Choose Install App, select the intended account, and choose Only select repositories. Select the prototype repositories for this Hub. If approval is required, an authorized administrator must complete it. Copy the numeric installation ID from the resulting installation settings URL (the number after /installations/). Hub connects only this installation and will not automatically select a replacement.",
        },
        {
          title: "5. Credentials and confirmation",
          body: "In the App's settings, copy App ID and Client ID. Open Credentials (or General in older layouts) to generate a client secret and private key. Enter those values below, together with the webhook secret and installation ID. Hub verifies App and installation identity and reads the installation's repositories before saving. This verifies the private key, not the OAuth client secret, webhook delivery, or end-user sign-in; verify those separately after connection. Setup expires after 15 minutes.",
        },
      ],
      settings: [
        { label: "GitHub App name (choose a unique name)", value: "Replica Hub" },
        { label: "Homepage URL", value: "https://replica.example.com" },
        { label: "Callback URL", value: "https://replica.example.com/auth/github/callback" },
        { label: "Webhook URL", value: "https://replica.example.com/github/webhooks" },
      ],
      permissions: [
        { label: "Repository permissions - Administration", value: "Read-only" },
        { label: "Repository permissions - Actions", value: "Read-only" },
        { label: "Repository permissions - Contents", value: "Read and write" },
        { label: "Repository permissions - Pull requests", value: "Read and write" },
        { label: "Repository permissions - Workflows", value: "Read and write" },
      ],
      fields: [
        {
          name: "app_id",
          label: "App ID",
          hint: "Copy App ID from the App's settings, not its installation ID.",
          secret: false,
        },
        {
          name: "client_id",
          label: "Client ID",
          hint: "Copy Client ID from the same App's settings.",
          secret: false,
        },
        {
          name: "client_secret",
          label: "Client secrets - generated secret",
          hint: "In Credentials (or General in older layouts), generate a client secret and copy it here (at most 4 KiB).",
          secret: true,
        },
        {
          name: "webhook_secret",
          label: "Webhook secret",
          hint: "Enter the same random secret saved in the App's Webhook settings (at most 4 KiB).",
          secret: true,
        },
        {
          name: "installation_id",
          label: "Installation ID",
          hint: "Copy the numeric ID from the intended account's installation settings URL.",
          secret: false,
        },
      ],
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GithubAppSetupManualPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const ConnectionFailed: Story = {
  args: {
    data: {
      ...meta.args.data,
      error:
        "Hub could not connect the App. Check the credentials, App and installation IDs, active installation status, and GitHub connectivity. No configuration was saved. Re-enter the credentials and try again.",
    },
  },
}
