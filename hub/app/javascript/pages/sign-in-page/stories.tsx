import type { Meta, StoryObj } from "@storybook/react-vite"

import { SignInPage } from "."

const meta = {
  title: "Hub/Pages/Identity/Sign in",
  component: SignInPage,
  parameters: { layout: "fullscreen" },
  args: {
    configured: true,
    loading: false,
    user: null,
    error: null,
    onSignIn: () => undefined,
    onSignOut: () => undefined,
    onBootstrap: () => undefined,
    onRecovery: () => undefined,
  },
} satisfies Meta<typeof SignInPage>

export default meta
type Story = StoryObj<typeof meta>

export const SignedOut: Story = {}
export const SignedIn: Story = {
  args: {
    user: {
      displayName: "Mona Lisa",
      username: "mona",
      avatarUrl: null,
    },
  },
}
export const Unconfigured: Story = {
  args: { configured: false },
}
export const AuthorizationFailed: Story = {
  args: { error: "GitHub could not authorize this Hub session." },
}
