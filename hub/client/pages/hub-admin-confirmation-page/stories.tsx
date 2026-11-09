import type { Meta, StoryObj } from "@storybook/react-vite"

import { hubAdministrationData } from "@/storybook/fixtures/hub-administration"

import { HubAdminConfirmationPage } from "."
import type { HubAdminConfirmationPageData } from "./types"

const data: HubAdminConfirmationPageData = {
  ...hubAdministrationData,
  pageTitle: "Designate Hub administrator?",
  heading: "Designate Hub administrator?",
  description:
    "This user will be able to designate and remove Hub administrators and read deployment security records. Their GitHub repository permissions will not change.",
  target: { login: "mona", name: "Mona Lisa", identity: "Microsoft Entra account" },
  operation: "DESIGNATE_ADMINISTRATORS",
  targetMembershipId: "22222222-2222-4222-8222-222222222222",
  submitPath: "/api/administrators/authorizations/start",
  submitLabel: "Designate administrator",
  confirmLabel: "I confirm this Hub administrator role change.",
  cancelLabel: "Cancel",
  cancelPath: "/settings/administrators",
  verification:
    "Hub will ask the provider for this session to verify the same account before continuing the confirmed role change.",
  blockedLabel: null,
}

const removalData: HubAdminConfirmationPageData = {
  ...data,
  operation: "REVOKE_ADMINISTRATOR",
  pageTitle: "Remove Hub administrator?",
  heading: "Remove Hub administrator?",
  description:
    "This user will lose Hub administrator controls and deployment security records. Their GitHub repository permissions will not change. Removing your own role takes effect immediately.",
  submitLabel: "Remove administrator",
}

const meta = {
  title: "Hub/Pages/Security/Hub administrator confirmation",
  component: HubAdminConfirmationPage,
  parameters: { layout: "fullscreen" },
  args: { data },
} satisfies Meta<typeof HubAdminConfirmationPage>

export default meta
type Story = StoryObj<typeof meta>

export const Designate: Story = {}
export const Remove: Story = {
  args: { data: removalData },
}
export const FinalAdministrator: Story = {
  args: {
    data: {
      ...removalData,
      blockedLabel:
        "The final Hub administrator cannot be removed. Designate another existing Hub user first.",
    },
  },
}
