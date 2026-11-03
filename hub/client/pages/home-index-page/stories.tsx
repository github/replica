import type { Meta, StoryObj } from "@storybook/react-vite"

import { useHubTheme } from "@hooks/use-hub-theme"

import type { HomeIndexPageData } from "./types"
import { HomeIndexPage } from "."

const data: HomeIndexPageData = {
  alert: null,
  authenticityToken: "storybook-token",
  badge: "Collaborative prototyping",
  badgeAlternate: "Built for feedback",
  description:
    "Replica Hub turns GitHub branches into shareable prototypes where your team can review changes and leave feedback.",
  heading: "Build and review prototypes with your team.",
  localMode: false,
  notice: null,
  footerNote: "\u00a9 2026 GitHub, Inc.",
  pageTitle: "Replica Hub",
  pauseAnimationLabel: "Pause animation",
  resumeAnimationLabel: "Resume animation",
  signInLabel: "Sign in with GitHub",
  signInPath: "/auth/github",
}

const meta = {
  title: "Hub/Pages/Home",
  component: HomeIndexPage,
  args: { colorMode: "dark", data },
  argTypes: {
    colorMode: { control: false, table: { disable: true } },
  },
  render: function HomeIndexStory(args) {
    const { resolvedColorMode } = useHubTheme()
    return <HomeIndexPage {...args} colorMode={resolvedColorMode} />
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Signed-out Hero with Primer's full entrance sequence, rotating label, size-2 heading, and GitHub sign-in icon.",
      },
    },
  },
} satisfies Meta<typeof HomeIndexPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const AccessAlert: Story = {
  args: {
    data: {
      ...data,
      alert: "Your GitHub account does not have access to this Hub's prototype repositories.",
    },
  },
}
export const AuthorizationFailed: Story = {
  args: {
    data: {
      ...data,
      alert:
        "GitHub authorization failed, expired, or used a different account. No sensitive changes were made. Return to the original action to try again.",
    },
  },
}

export const SessionsEnded: Story = {
  args: {
    data: {
      ...data,
      alert:
        "A Hub administrator ended all sessions while you were signing in. Start a new GitHub sign-in.",
    },
  },
}

export const AuthorizationSucceeded: Story = {
  args: {
    data: {
      ...data,
      notice:
        "GitHub authorization succeeded for this connection only. Return to the action and submit it again within five minutes.",
    },
  },
}

export const LocalDevelopment: Story = {
  args: {
    data: {
      ...data,
      badge: "Local development",
      badgeAlternate: "Branches, builds, feedback",
      description: "Explore committed branches in local Git repositories.",
      heading: "Build and review prototypes on your computer.",
      localMode: true,
      signInLabel: "Open local Hub",
      signInPath: "/auth/local",
    },
  },
}
