import { configureStore } from "@reduxjs/toolkit"
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { Provider } from "react-redux"
import { afterEach, describe, expect, it, vi } from "vitest"

import { navigationRequest } from "@application/navigation-request"
import { RepositoryWorkspace } from "@features/repository-workspace"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import { HubWorkspace } from "@features/hub-workspace"
import type { HubWorkspaceData } from "@features/hub-workspace/types"
import repositoryStories from "@pages/repositories-show-page/stories"
import managementStories from "@pages/prototype-management-page/stories"
import inboxStories from "@pages/notifications-page/stories"

import AnalyticsView from "../../views/analytics/show"
import BuildsIndexView from "../../views/builds"
import BuildsShowView from "../../views/builds/show"
import NewPrototypesView from "../../views/new_prototypes/show"
import PrototypeManagementView from "../../views/prototype_management/show"
import PrototypesShowView from "../../views/prototypes/show"
import ReplicaBrowsesShowView from "../../views/replica_browses/show"
import RepositoriesShowView from "../../views/repositories/show"
import ShareLinksIndexView from "../../views/share_links"
import SecurityAuditView from "../../views/security_audits/show"
import RepositorySecurityAuditView from "../../views/repository_security_audits/show"
import GithubAppView from "../../views/github_apps/show"
import GithubAppResetView from "../../views/github_apps/reset_confirmation"
import GithubAppCredentialsView from "../../views/github_app_credentials/edit"
import GithubAppWebhookView from "../../views/github_app_webhook_rotations/show"
import HubAdminsView from "../../views/hub_admins"
import HubAdminConfirmationView from "../../views/hub_admins/edit"
import SessionRevocationView from "../../views/session_revocations/show"
import SharingSettingsView from "../../views/sharing_settings/show"
import FreshAuthorizationView from "../../views/fresh_authorizations/show"

let collapsed = false
let shell: "repository" | "workspace" | "administrationWorkspace" | "authenticatedWorkspace" =
  "repository"

function SidebarPage({ data }: { data: RepositoryWorkspaceData }) {
  return <RepositoryWorkspace data={data} defaultNavigationCollapsed={collapsed} />
}

function HubSidebarPage({
  data,
}: {
  data: {
    workspace?: RepositoryWorkspaceData
    administrationWorkspace?: HubWorkspaceData
    authenticatedWorkspace?: HubWorkspaceData
  }
}) {
  if (data.workspace) return <SidebarPage data={data.workspace} />

  const workspace = data.administrationWorkspace ?? data.authenticatedWorkspace
  if (!workspace) throw new Error("Expected a Hub workspace fixture")

  return <HubWorkspace data={workspace} defaultNavigationCollapsed={collapsed} />
}

vi.mock("@pages/analytics-page", () => ({ AnalyticsPage: SidebarPage }))
vi.mock("@pages/builds-index-page", () => ({ BuildsIndexPage: SidebarPage }))
vi.mock("@pages/builds-show-page", () => ({ BuildsShowPage: SidebarPage }))
vi.mock("@pages/new-prototype-page", () => ({ NewPrototypePage: SidebarPage }))
vi.mock("@pages/prototype-management-page", () => ({ PrototypeManagementPage: SidebarPage }))
vi.mock("@pages/prototypes-show-page", () => ({ PrototypesShowPage: SidebarPage }))
vi.mock("@pages/replica-browse-page", () => ({ ReplicaBrowsePage: SidebarPage }))
vi.mock("@pages/repositories-show-page", () => ({ RepositoriesShowPage: SidebarPage }))
vi.mock("@pages/share-links-index-page", () => ({ ShareLinksIndexPage: SidebarPage }))
vi.mock("@pages/security-audit-page", () => ({ SecurityAuditPage: HubSidebarPage }))
vi.mock("@pages/github-app-page", () => ({ GithubAppPage: HubSidebarPage }))
vi.mock("@pages/hub-admins-page", () => ({ HubAdminsPage: HubSidebarPage }))
vi.mock("@pages/hub-admin-confirmation-page", () => ({ HubAdminConfirmationPage: HubSidebarPage }))
vi.mock("@pages/session-revocation-page", () => ({ SessionRevocationPage: HubSidebarPage }))
vi.mock("@pages/sharing-settings-page", () => ({ SharingSettingsPage: HubSidebarPage }))
vi.mock("@pages/fresh-authorization-page", () => ({ FreshAuthorizationPage: HubSidebarPage }))
vi.mock("@hooks/use-page-data", () => ({
  usePageData: () => {
    const data = {
      ...repositoryStories.args.data,
      management: managementStories.args.data.management,
      repositoryChoices: managementStories.args.data.repositoryChoices,
      notificationInbox: inboxStories.args.data.notificationInbox,
      notificationsPath: "/notifications",
      notificationsLabel: "Inbox",
      notificationsUnreadCount: 12,
    }
    if (shell === "repository") return data

    return {
      [shell]: {
        ...data,
        productName: "Replica",
        repositoriesLabel: "Repositories",
        repositoriesPath: "/repositories",
        repository: data,
      },
    }
  },
}))
vi.mock("@hooks/use-page-section", () => ({
  usePageSection: () => ({ loading: false, failed: false, retry: () => {} }),
}))
vi.mock("@hooks/use-hub-theme", () => ({
  useHubTheme: () => ({ resolvedColorMode: "light" }),
  useOptionalHubTheme: () => null,
}))
vi.mock("@hooks/use-prototype-review", () => ({
  usePrototypeReview: () => ({
    threads: [],
    selectedThread: null,
    comments: { loading: false, loadFailed: false },
    bridge: { route: { pathname: "/", search: "", hash: "" } },
  }),
}))
vi.mock("@hooks/use-preview-bridge", () => ({
  usePreviewBridge: () => ({
    route: { pathname: "/", search: "", hash: "" },
    handleFrameLoad: () => {},
  }),
}))
vi.mock("@hooks/use-prototype-viewer-url", () => ({
  usePrototypeViewerUrl: () => ({
    viewerUrl: "/preview",
    minimized: false,
    setMinimized: () => {},
  }),
}))
vi.mock("@hooks/use-prototype-control-query", () => ({
  useControlQuery: () => ({ query: "", values: {}, notice: null }),
}))
vi.mock("@hooks/use-prototype-share-control-settings", () => ({
  useShareControlSettings: () => ({ error: null }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  shell = "repository"
})

const views = [
  ["repositories", RepositoriesShowView],
  ["analytics", AnalyticsView],
  ["new prototype", NewPrototypesView],
  ["prototype management", PrototypeManagementView],
  ["prototype review", PrototypesShowView],
  ["Build history", BuildsIndexView],
  ["Build details", BuildsShowView],
  ["share links", ShareLinksIndexView],
  ["template preview", ReplicaBrowsesShowView],
] as const

function renderWithNavigationStore(view: ReactNode) {
  const store = configureStore({
    reducer: { navigationRequest: navigationRequest.reducer },
  })
  return render(<Provider store={store}>{view}</Provider>)
}

describe("Sidebar inbox previews", () => {
  it.each(
    [
      ["Hub audit", SecurityAuditView, "administrationWorkspace"],
      ["repository audit", RepositorySecurityAuditView, "workspace"],
      ["GitHub App", GithubAppView, "administrationWorkspace"],
      ["GitHub App reset", GithubAppResetView, "administrationWorkspace"],
      ["GitHub App credentials", GithubAppCredentialsView, "administrationWorkspace"],
      ["webhook rotation", GithubAppWebhookView, "administrationWorkspace"],
      ["Hub admins", HubAdminsView, "administrationWorkspace"],
      ["admin confirmation", HubAdminConfirmationView, "administrationWorkspace"],
      ["session revocation", SessionRevocationView, "administrationWorkspace"],
      ["sharing settings", SharingSettingsView, "administrationWorkspace"],
      ["fresh authorization", FreshAuthorizationView, "administrationWorkspace"],
      ["denied admin page", HubAdminsView, "authenticatedWorkspace"],
    ].flatMap(([name, View, workspace]) =>
      [false, true].map((collapsed) => ({ name, View, workspace, collapsed })),
    ),
  )(
    "preserves the preview on $name with collapsed=$collapsed",
    async ({ View, workspace, collapsed: value }) => {
      if (typeof View !== "function" || typeof workspace !== "string") {
        throw new Error("Expected a workspace view fixture")
      }
      if (
        workspace !== "workspace" &&
        workspace !== "administrationWorkspace" &&
        workspace !== "authenticatedWorkspace"
      ) {
        throw new Error("Expected a workspace projection")
      }
      shell = workspace
      collapsed = value
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            notifications: inboxStories.args.notifications,
            unreadCount: 12,
            nextBefore: null,
          }),
        ),
      )
      renderWithNavigationStore(<View />)
      const inbox = screen.getByRole("link", { name: "Inbox, 12 unread items" })
      fireEvent.mouseEnter(inbox)
      const preview = await screen.findByRole("region", { name: "Inbox" })
      await within(preview).findByRole("link", { name: /mentioned you/ })
      expect(inbox.closest("aside")).toHaveAttribute("data-collapsed", String(value))
      expect(inbox.closest("aside")).not.toContainElement(preview)
      fireEvent.focus(within(preview).getByRole("link", { name: "View all" }))
      expect(preview).toBeInTheDocument()
      fireEvent.keyDown(preview, { key: "Escape" })
      expect(screen.queryByRole("region", { name: "Inbox" })).not.toBeInTheDocument()
    },
  )

  it.each(
    views.flatMap(([name, View]) =>
      [false, true].map((collapsed) => ({
        name,
        View,
        collapsed,
        state: collapsed ? "collapsed" : "expanded",
      })),
    ),
  )("opens lazily on the $name page with a $state sidebar", async ({ View, collapsed: value }) => {
    collapsed = value
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        notifications: inboxStories.args.notifications,
        unreadCount: 12,
        nextBefore: null,
      }),
    )
    vi.stubGlobal("fetch", fetch)
    renderWithNavigationStore(<View />)
    expect(fetch).not.toHaveBeenCalled()
    const inbox = screen.getByRole("link", { name: "Inbox, 12 unread items" })
    expect(inbox.closest("aside")).toHaveAttribute("data-collapsed", String(value))
    fireEvent.mouseEnter(inbox)
    const preview = await screen.findByRole("region", { name: "Inbox" })
    await within(preview).findByRole("link", { name: /mentioned you/ })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL("http://localhost:3000/notifications/inbox?limit=10&unread=true"),
      { credentials: "same-origin" },
    )
    expect(within(preview).getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/notifications",
    )
  })
})
