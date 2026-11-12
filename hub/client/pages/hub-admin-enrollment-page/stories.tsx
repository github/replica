import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubAdminEnrollmentPage } from "."

const meta = {
  title: "Hub/Pages/Security/Administrator enrollment",
  component: HubAdminEnrollmentPage,
  parameters: { layout: "fullscreen" },
  args: {
    data: {
      alert: null,
      productName: "Replica Hub",
      pageTitle: "Enroll a Hub administrator",
      heading: "Enroll a Hub administrator",
      description:
        "Enter the deployment's bootstrap secret, then verify your identity. This grants deployment administration, not access to private repositories.",
      providerActions: [
        {
          label: "Verify with GitHub",
          path: "/api/auth/github/admin-enrollment/start",
          provider: "github",
        },
      ],
      secretLabel: "Bootstrap secret",
    },
  },
} satisfies Meta<typeof HubAdminEnrollmentPage>

export default meta
type Story = StoryObj<typeof meta>

export const Enrollment: Story = {}

export const MicrosoftEntra: Story = {
  args: {
    data: {
      ...meta.args.data,
      providerActions: [
        {
          label: "Verify with Microsoft Entra",
          path: "/api/auth/entra/admin-enrollment/start",
          provider: "entra",
        },
      ],
    },
  },
}

export const GitHubAndMicrosoftEntra: Story = {
  args: {
    data: {
      ...meta.args.data,
      providerActions: [
        ...meta.args.data.providerActions,
        {
          label: "Verify with Microsoft Entra",
          path: "/api/auth/entra/admin-enrollment/start",
          provider: "entra",
        },
      ],
    },
  },
}

export const InvalidSecret: Story = {
  args: {
    data: {
      ...meta.args.data,
      alert: "Administrator enrollment was denied. Check the bootstrap secret and try again.",
    },
  },
}
