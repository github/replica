import type { Meta, StoryObj } from "@storybook/react-vite"

import { CurrentSessionPage } from "."

const meta = {
  title: "Hub/Pages/Security/Current session",
  component: CurrentSessionPage,
  parameters: { layout: "fullscreen" },
  args: {
    data: {
      heading: "Signed in to Replica Hub",
      description: "Your Hub session is active and will be checked against current membership.",
      alert: null,
      notice: null,
      roleLabel: "Administrator",
      administratorLabel: "Manage Hub administrators",
      administratorPath: "/settings/administrators",
      signOutLabel: "Sign out",
      signOutPath: "/api/auth/session/sign-out",
    },
  },
} satisfies Meta<typeof CurrentSessionPage>

export default meta
type Story = StoryObj<typeof meta>

export const Administrator: Story = {}

export const Member: Story = {
  args: {
    data: {
      ...meta.args.data,
      roleLabel: "Member",
      administratorLabel: undefined,
      administratorPath: undefined,
    },
  },
}

export const CallbackSucceeded: Story = {
  args: {
    data: {
      ...meta.args.data,
      notice: "Sign-in succeeded and Replica Hub restored your active session.",
    },
  },
}

export const AuthorizationUnavailable: Story = {
  args: {
    data: {
      ...meta.args.data,
      alert:
        "Verification is temporarily unavailable. Return to settings and start the administrator action again.",
    },
  },
}

export const SignOutUnavailable: Story = {
  args: {
    data: {
      ...meta.args.data,
      alert: "Sign-out is temporarily unavailable. Try again.",
    },
  },
}
