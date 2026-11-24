import type { Meta, StoryObj } from "@storybook/react-vite"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { keepFormsLocal } from "@/storybook/keep-forms-local"

import { FreshAuthorizationPage } from "."

const administratorAuthorizationId = "33333333-3333-4333-8333-333333333333"
const administratorConfirmationPath = `/settings/administrators/confirm?authorizationId=${administratorAuthorizationId}`

const meta = {
  title: "Hub/Pages/Security/Fresh authorization",
  component: FreshAuthorizationPage,
  decorators: [keepFormsLocal],
  parameters: { layout: "fullscreen" },
  args: {
    data: {
      productName: "Replica Hub",
      pageTitle: "Fresh authorization required",
      heading: "Fresh authorization required",
      description:
        "Verify the same provider account to continue your confirmed action. The provider may reuse your signed-in browser; this is not a guaranteed password or MFA challenge.",
      submitLabel: "Verify account",
      submitPath: administratorConfirmationPath,
      cancelLabel: "Cancel",
      cancelPath: administratorConfirmationPath,
      authenticityToken: "storybook-token",
    },
  },
} satisfies Meta<typeof FreshAuthorizationPage>

export default meta
type Story = StoryObj<typeof meta>

export const Required: Story = {}
export const NothingToAuthorize: Story = {
  args: {
    data: {
      ...meta.args.data,
      heading: "Nothing to authorize",
      description: "There is no pending action to authorize. Return to the action and try again.",
      canContinue: false,
      continuation: undefined,
      cancelPath: undefined,
    },
  },
}
export const HubAdministratorChange: Story = {
  args: {
    data: {
      ...meta.args.data,
      administrationWorkspace: hubAdministrationWorkspaceData,
      description:
        "Verify the same provider account to continue the Hub administrator role change you confirmed.",
    },
  },
}
export const Continuing: Story = {
  args: {
    data: {
      ...meta.args.data,
      administrationWorkspace: hubAdministrationWorkspaceData,
      pageTitle: "Completing your action",
      heading: "Completing your action",
      description:
        "Your provider verified this session. Continue the exact administrator role change you confirmed, or cancel it without changing any roles.",
      submitLabel: "Continue",
      continuation: { id: administratorAuthorizationId, method: "post" },
      roleChange: {
        operationLabel: "Remove Hub administrator",
        targets: [
          {
            membershipId: "22222222-2222-4222-8222-222222222222",
            providerLabel: "Microsoft Entra account",
            login: "mona",
            name: "Mona Lisa",
          },
        ],
      },
    },
  },
}
export const Conflict: Story = {
  args: {
    data: {
      ...meta.args.data,
      administrationWorkspace: hubAdministrationWorkspaceData,
      pageTitle: "Complete administrator role change",
      heading: "Complete administrator role change",
      description:
        "Your provider verified this session. Continue the exact administrator role change you confirmed, or cancel it without changing any roles.",
      submitLabel: "Continue",
      continuation: { id: administratorAuthorizationId, method: "post" },
      roleChange: {
        operationLabel: "Remove Hub administrator",
        targets: [
          {
            membershipId: "22222222-2222-4222-8222-222222222222",
            providerLabel: "Microsoft Entra account",
            login: "mona",
            name: "Mona Lisa",
          },
        ],
      },
    },
    error:
      "The administrator role changed before this authorization continued. Review the current roster and try again.",
  },
}

const copilotAuthorizationId = "55555555-5555-4555-8555-555555555555"
const copilotConfirmationPath = `/settings/copilot/confirm?authorizationId=${copilotAuthorizationId}`

export const CopilotConnectionConfirmation: Story = {
  args: {
    data: {
      ...meta.args.data,
      administrationWorkspace: { ...hubAdministrationWorkspaceData, selectedSection: "copilot" },
      pageTitle: "Complete Copilot connection",
      heading: "Complete Copilot connection",
      description:
        "Your provider verified this session. Continue to check the configured token and connect Copilot, or cancel without changing the connection.",
      submitLabel: "Connect Copilot",
      submitPath: copilotConfirmationPath,
      cancelPath: copilotConfirmationPath,
      authenticityToken: "",
      continuation: { id: copilotAuthorizationId, method: "post" },
    },
  },
}
