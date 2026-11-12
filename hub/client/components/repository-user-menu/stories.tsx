import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"

import { RepositoryUserMenu } from "."

const meta = {
  title: "Components/Repository User Menu",
  component: RepositoryUserMenu,
  args: {
    accountMenuLabel: authenticatedHeaderData.accountMenuLabel,
    authenticityToken: authenticatedHeaderData.authenticityToken,
    currentUser: authenticatedHeaderData.currentUser,
    darkThemeLabel: authenticatedHeaderData.darkThemeLabel,
    lightThemeLabel: authenticatedHeaderData.lightThemeLabel,
    signOutLabel: authenticatedHeaderData.signOutLabel,
    signOutPath: authenticatedHeaderData.signOutPath,
    systemThemeLabel: authenticatedHeaderData.systemThemeLabel,
  },
  decorators: [
    (Story, context) => (
      <div
        style={{
          width: context.args.collapsed ? "2.5rem" : "13.8125rem",
          background: "var(--brand-color-canvas-muted)",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RepositoryUserMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Collapsed: Story = {
  args: { collapsed: true },
}

export const EntraMember: Story = {
  args: {
    accountMenuLabel: "Account menu for Mona",
    currentUser: {
      avatarUrl: null,
      login: "mona@example.test",
      name: "Mona",
      provider: "entra",
    },
  },
}

export const LongIdentity: Story = {
  args: {
    currentUser: {
      ...authenticatedHeaderData.currentUser,
      name: "The Octocat With An Extraordinarily Long Display Name",
      login: "octocat-with-a-very-long-handle",
    },
  },
}
