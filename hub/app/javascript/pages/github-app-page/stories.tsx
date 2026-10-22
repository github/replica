import type { Meta, StoryObj } from "@storybook/react-vite"

import { hubAdministrationData } from "@/storybook/fixtures/hub-administration"

import { GithubAppPage } from "."
import type { GithubAppPageData } from "./types"

const data: GithubAppPageData = {
  ...hubAdministrationData,
  administrationWorkspace: {
    ...hubAdministrationData.administrationWorkspace,
    selectedSection: "github",
  },
  pageTitle: "GitHub App",
  heading: "GitHub App",
  description: "Administer this Hub's App without changing repository permissions.",
  configurationId: 1,
  version: 0,
  identity: "App 123 - github (Organization, identity 321)",
  installation: "Installation 456: active",
  busyLabel: null,
  verification: "Verify this browser with GitHub, then confirm again. Nothing is replayed.",
  paragraphs: ["Only the current webhook secret is accepted."],
  links: [
    { label: "Replace App credentials", path: "/github_app/credentials" },
    { label: "Webhook secret rotation", path: "/github_app/webhook_rotation" },
    { label: "Reset local GitHub App?", path: "/github_app/reset" },
  ],
  form: null,
}

const meta = {
  title: "Hub/Pages/Security/GitHub App",
  component: GithubAppPage,
  parameters: { layout: "fullscreen" },
  args: { data },
} satisfies Meta<typeof GithubAppPage>

export default meta
type Story = StoryObj<typeof meta>

export const Configured: Story = {}
export const NotConfigured: Story = {
  args: {
    data: {
      ...data,
      configurationId: null,
      version: null,
      identity: null,
      installation: null,
      paragraphs: ["No GitHub App is configured. Setup requires the deployment bootstrap secret."],
      links: [],
    },
  },
}
export const Credentials: Story = {
  args: {
    data: {
      ...data,
      heading: "Replace App credentials",
      description: "A candidate key verifies App identity, not client-secret correctness.",
      links: [],
      form: {
        action: "/github_app/credentials",
        method: "patch",
        submitLabel: "Save replacement credentials",
        confirmLabel: "I confirm these replacements belong to the same GitHub App.",
        disabled: false,
        credentials: {
          secretLabel: "New client secret",
          keyLabel: "New private key file (.pem)",
          limits:
            "At most 4 KiB for the secret and 16 KiB for the PEM. Saved secrets are never displayed.",
        },
      },
    },
  },
}
export const InvalidCredentials: Story = {
  args: {
    data: {
      ...Credentials.args!.data!,
      alert:
        "Hub could not validate these replacements for the same App. Enter the client secret and upload a valid PEM private key again.",
    },
  },
}
export const WebhookStart: Story = {
  args: {
    data: {
      ...data,
      pageTitle: "Webhook secret rotation",
      heading: "Webhook secret rotation",
      description:
        "Hub generates the secret and updates GitHub directly. No secret is displayed or copied through this page.",
      links: [],
      form: {
        action: "/github_app/webhook_rotation",
        method: "post",
        operation: "start",
        submitLabel: "Start webhook rotation",
        confirmLabel:
          "I confirm that Hub should generate and install a replacement webhook secret while accepting the previous secret.",
        disabled: false,
      },
    },
  },
}
export const PendingWebhook: Story = {
  args: {
    data: {
      ...data,
      pageTitle: "Webhook secret rotation",
      heading: "Webhook secret rotation",
      description:
        "Hub generates the secret and updates GitHub directly. No secret is displayed or copied through this page.",
      paragraphs: ["GitHub has not confirmed the update. Retry sends the same saved replacement."],
      links: [],
      form: {
        action: "/github_app/webhook_rotation",
        method: "post",
        operation: "retry",
        submitLabel: "Retry saved webhook update",
        confirmLabel: "I confirm that both secrets will remain accepted.",
        disabled: false,
      },
    },
  },
}
export const ConfirmedWebhook: Story = {
  args: {
    data: {
      ...data,
      pageTitle: "Webhook secret rotation",
      heading: "Webhook secret rotation",
      description:
        "Hub generates the secret and updates GitHub directly. No secret is displayed or copied through this page.",
      paragraphs: ["GitHub confirmed the replacement. Both secrets remain accepted."],
      links: [],
      form: {
        action: "/github_app/webhook_rotation",
        method: "delete",
        submitLabel: "Stop accepting the old secret",
        confirmLabel: "Delayed deliveries signed with the old secret will be rejected.",
        disabled: false,
      },
    },
  },
}
export const Reset: Story = {
  args: {
    data: {
      ...data,
      heading: "Reset local GitHub App?",
      description: "Sign everyone out. The remote App is not changed.",
      paragraphs: [
        "Users, administrator roles, Builds, files, reviews and audit history remain.",
        "Retained public links may resume under existing policy after reinstall.",
      ],
      links: [],
      form: {
        action: "/github_app",
        method: "delete",
        submitLabel: "Delete local App configuration",
        confirmLabel: "I have the bootstrap secret and understand the sign-out and revocation.",
        confirmationPhraseLabel: 'Type "delete local GitHub App configuration"',
        disabled: false,
      },
    },
  },
}
export const ResetWithoutBootstrap: Story = {
  args: {
    data: {
      ...Reset.args!.data!,
      form: {
        ...Reset.args!.data!.form!,
        disabled: true,
        blockedLabel:
          "The deployment bootstrap secret is not configured. Ask the server owner to restore it before resetting the App.",
      },
    },
  },
}
export const Failed: Story = {
  args: {
    data: {
      ...data,
      alert:
        "GitHub could not confirm the operation. Pending webhook rotation retains both secrets.",
    },
  },
}
export const Busy: Story = {
  args: {
    data: {
      ...data,
      pageTitle: "Webhook secret rotation",
      heading: "Webhook secret rotation",
      description:
        "Hub generates the secret and updates GitHub directly. No secret is displayed or copied through this page.",
      busyLabel: "A webhook update is in progress. Wait before changing the App.",
      paragraphs: ["Both secrets are accepted while this update is in progress."],
      links: [],
      form: {
        action: "/github_app/webhook_rotation",
        method: "post",
        operation: "retry",
        submitLabel: "Retry saved webhook update",
        confirmLabel: "I confirm that both secrets will remain accepted.",
        disabled: true,
      },
    },
  },
}
