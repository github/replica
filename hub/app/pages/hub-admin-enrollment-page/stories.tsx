import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubAdminEnrollmentPage } from "."

const meta = {
  title: "Hub/Pages/Security/Operator enrollment",
  component: HubAdminEnrollmentPage,
  parameters: { layout: "fullscreen" },
  args: {
    data: {
      productName: "Replica Hub",
      pageTitle: "Enroll a Hub operator",
      heading: "Enroll a Hub operator",
      description:
        "Enter the deployment's bootstrap secret, then verify your own GitHub account. This grants deployment administration, not access to private repositories.",
      secretLabel: "Bootstrap secret",
      submitLabel: "Verify with GitHub",
      submitPath: "/operator/enrollment",
      authenticityToken: "storybook-token",
    },
  },
} satisfies Meta<typeof HubAdminEnrollmentPage>

export default meta
type Story = StoryObj<typeof meta>

export const Enrollment: Story = {}
export const Simulation: Story = {
  args: {
    data: {
      ...meta.args.data,
      simulation: true,
      canContinue: true,
      heading: "Try administrator enrollment",
      description:
        "Continue as synthetic Octocat, then confirm a local continuation. No secret or provider identity is requested.",
      submitLabel: "Start mock enrollment example",
      submitPath: "/settings/enroll",
    },
  },
}
