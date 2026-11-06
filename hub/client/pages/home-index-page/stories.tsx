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
  notice: null,
  footerNote: "\u00a9 2026 GitHub, Inc.",
  pageTitle: "Replica Hub",
  pauseAnimationLabel: "Pause animation",
  resumeAnimationLabel: "Resume animation",
  signInActions: [
    {
      label: "Sign in with GitHub",
      path: "/api/auth/github/start",
      provider: "github",
    },
  ],
}

const meta = {
  title: "Hub/Pages/Home",
  component: HomeIndexPage,
  args: { colorMode: "dark", data },
  beforeEach: () => {
    const originalMatchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    })
    return () => {
      window.matchMedia = originalMatchMedia
    }
  },
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
          "Signed-out Hero with Primer's full entrance sequence, rotating label, size-2 heading, and explicit configured provider actions.",
      },
    },
  },
} satisfies Meta<typeof HomeIndexPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const MicrosoftEntra: Story = {
  args: {
    data: {
      ...data,
      signInActions: [
        {
          label: "Sign in with Microsoft Entra",
          path: "/api/auth/entra/start",
          provider: "entra",
        },
      ],
    },
  },
}

export const GitHubAndMicrosoftEntra: Story = {
  args: {
    data: {
      ...data,
      signInActions: [
        ...data.signInActions,
        {
          label: "Sign in with Microsoft Entra",
          path: "/api/auth/entra/start",
          provider: "entra",
        },
      ],
    },
  },
}

export const AuthorizationFailed: Story = {
  args: {
    data: {
      ...data,
      alert:
        "Sign-in could not be completed, or this account is not an active Hub member. Start a new sign-in to try again.",
    },
  },
}

export const SessionRestoreFailed: Story = {
  args: {
    data: {
      ...data,
      alert: "Replica Hub could not restore your session. Sign in again to continue.",
    },
  },
}
