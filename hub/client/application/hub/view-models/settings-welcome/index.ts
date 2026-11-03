import type { WelcomePageData } from "@pages/welcome-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"
import { settingsWorkspace } from "../settings-workspace"

export function settingsWelcome(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
): WelcomePageData {
  const videoUrl: unknown = import.meta.env.VITE_WELCOME_VIDEO_URL
  const videoPosterUrl: unknown = import.meta.env.VITE_WELCOME_VIDEO_POSTER_URL
  return {
    workspace: settingsWorkspace(workspace, state, search, "welcome"),
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
    hidePath: state.welcomeHidden ? null : resourcePath("/welcome", search),
    notice: state.welcomeHidden
      ? "Welcome is hidden from your sidebar. You can still visit /welcome."
      : null,
  }
}
