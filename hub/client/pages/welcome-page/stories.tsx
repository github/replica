import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { prototypeWorkspaceData } from "@/storybook/fixtures/prototype-workspace"

import { WelcomePage } from "."

const videoUrl: unknown = import.meta.env.VITE_WELCOME_VIDEO_URL
const videoPosterUrl: unknown = import.meta.env.VITE_WELCOME_VIDEO_POSTER_URL

const meta = {
  title: "Hub/Pages/Welcome",
  component: WelcomePage,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div onSubmit={(event) => event.preventDefault()}>
        <Story />
      </div>
    ),
  ],
  args: {
    data: {
      workspace: {
        ...authenticatedHubWorkspaceData,
        welcomeLabel: "Welcome",
        welcomePath: "/welcome",
        selectedSection: "welcome",
      },
      heading: "Getting started with Replica",
      description: "Turn an idea into an interactive prototype.",
      videoUrl: typeof videoUrl === "string" && videoUrl ? videoUrl : null,
      videoEmbedUrl:
        typeof videoUrl === "string" && videoUrl
          ? null
          : "https://www.youtube-nocookie.com/embed/J2Z28CwIfsA",
      videoPosterUrl: typeof videoPosterUrl === "string" && videoPosterUrl ? videoPosterUrl : null,
      videoLabel: "Learn how Replica works",
      videoDescription:
        "Watch how product ideas become interactive prototypes your team can try, discuss, and refine.",
      videoUnavailable:
        "The introduction video is not available yet. You can still get started with the links below.",
      videoFailed:
        "The introduction video could not load. Try reloading the page, or use the links below.",
      readmeLabel: "Learn about Replica",
      readmeDescription: "See how Replica connects prototypes and team feedback.",
      readmePath: "https://github.com/github/replica#readme",
      setupLabel: "Getting started",
      setupDescription: "Create, try, and share your first prototype step by step.",
      setupPath: "https://github.com/github/replica/blob/main/docs/getting-started.md",
      createLabel: "Create prototype",
      createDescription: "Turn an idea into a prototype with GitHub Copilot.",
      createUnavailable: "Creating a prototype here requires a connected GitHub repository.",
      hideLabel: "Hide welcome",
      hideDescription: "Hide Welcome from the sidebar. You can still visit /welcome.",
      hidePath: "/welcome",
      notice: null,
    },
  },
} satisfies Meta<typeof WelcomePage>

export default meta
type Story = StoryObj<typeof meta>

export const Introduction: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "The entire Welcome section is vertically centered up to a 164px top inset and scrolls on shorter screens. The dotted background area stays at the bottom of the viewport, starting 768px from the top on screens at least 1000px tall. Shorter screens reduce that offset to keep the bottom 232px visible. One image scales proportionally to cover that area without repeating. The video card sits 32px below the introduction, increasing to 48px when the screen is at least 48rem wide and 1000px tall. Its caption has a 16px top inset, with 8px side and bottom insets. The Hide welcome row has an 8px top inset.",
      },
    },
  },
}

export const VideoNotConfigured: Story = {
  args: { data: { ...meta.args.data, videoUrl: null, videoEmbedUrl: null } },
}

export const Hidden: Story = {
  args: {
    data: {
      ...meta.args.data,
      workspace: { ...meta.args.data.workspace, welcomePath: null },
      hidePath: null,
      notice: "Welcome is hidden from your sidebar. You can still visit /welcome.",
    },
  },
}

export const NoRepository: Story = {
  args: {
    data: {
      ...meta.args.data,
      workspace: { ...meta.args.data.workspace, repository: null },
    },
  },
}

export const LocalRepository: Story = {
  args: {
    data: {
      ...meta.args.data,
      workspace: {
        ...meta.args.data.workspace,
        repository: {
          ...prototypeWorkspaceData,
          newPrototypePath: null,
        },
      },
    },
  },
}
