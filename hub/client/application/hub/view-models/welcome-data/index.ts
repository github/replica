import type { WelcomePageData } from "@pages/welcome-page/types"
import type { HubWorkspaceData } from "@features/hub-workspace/types"

import { resourcePath } from "../resource-path"

export function welcomeData(workspace: HubWorkspaceData, hidden: boolean): WelcomePageData {
  const videoUrl: unknown = import.meta.env.VITE_WELCOME_VIDEO_URL
  const videoPosterUrl: unknown = import.meta.env.VITE_WELCOME_VIDEO_POSTER_URL
  const defaultVideo = "J2Z28CwIfsA"
  const customVideo = typeof videoUrl === "string" && videoUrl ? videoUrl : null
  return {
    workspace,
    heading: "Getting started with Replica",
    description: "Turn an idea into an interactive prototype.",
    videoUrl: customVideo,
    videoEmbedUrl: customVideo ? null : `https://www.youtube-nocookie.com/embed/${defaultVideo}`,
    videoWatchUrl: customVideo ? undefined : `https://www.youtube.com/watch?v=${defaultVideo}`,
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
    createDescription:
      workspace.currentUser.provider === "local"
        ? "Draft a prototype brief and copy it for your coding agent."
        : "Turn an idea into a prototype with GitHub Copilot.",
    createUnavailable: "Choose a repository where you can create prototypes.",
    hideLabel: "Hide welcome",
    hideDescription: "Hide Welcome from the sidebar. You can still visit /welcome.",
    hidePath: hidden
      ? null
      : resourcePath("/welcome", {
          repositoryId: workspace.repository?.selectedRepositoryId ?? null,
        }),
    notice: hidden ? "Welcome is hidden from your sidebar. You can still visit /welcome." : null,
  }
}
