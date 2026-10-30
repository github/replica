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
  return {
    workspace: settingsWorkspace(workspace, state, search, "welcome"),
    heading: "Getting started with Replica",
    description:
      "Try a local, synthetic Hub journey. Accounts, connections and publication are simulated.",
    videoUrl: null,
    videoEmbedUrl: null,
    videoPosterUrl: null,
    videoLabel: "Explore the mock journey",
    videoDescription:
      "Create a prototype, open its preview, try review controls, and inspect local settings.",
    videoUnavailable: "This mock uses no external video or tracking service.",
    videoFailed: "The introduction is unavailable. Use the links below.",
    readmeLabel: "Learn about Replica",
    readmeDescription: "Read the public project guide.",
    readmePath: "https://github.com/github/replica#readme",
    setupLabel: "Getting started",
    setupDescription: "Read the public local-prototype workflow.",
    setupPath: "https://github.com/github/replica/blob/main/docs/getting-started.md",
    createLabel: "Create mock prototype",
    createDescription: "Choose a starting point for a synthetic prototype.",
    createUnavailable:
      "Choose a mock profile with the create capability and an available repository.",
    hideLabel: "Hide welcome",
    hideDescription: "Hide Welcome in this mock session. You can still visit /welcome.",
    hidePath: state.welcomeHidden ? null : resourcePath("/welcome", search),
    notice: null,
    mockNotice: state.welcomeHidden ? "Welcome is hidden in this mock session." : null,
  }
}
