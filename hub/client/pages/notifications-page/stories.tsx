import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@primer/react-brand"

import { mona } from "@/storybook/fixtures/users"
import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { inboxCopy } from "@/storybook/fixtures/inbox-activity"
import { githubPrototype } from "@/storybook/fixtures/repositories"
import type { InboxNotification } from "@utils/notification/types"
import { useNotificationInbox } from "@hooks/use-notification-inbox"
import { useRepositoryInbox } from "@hooks/use-repository-inbox"

import { NotificationsPage } from "."

const notification: InboxNotification = {
  id: 1,
  version: 0,
  actor: mona,
  kind: "mention",
  excerpt: "Can you check the spacing, @octocat?",
  createdAt: "2026-10-09T09:00:00Z",
  read: false,
  repository: "github/prototype",
  prototype: "Welcome",
  path: "/repositories/2001/prototypes/1?comment=1&notification=1",
  updatePath: "/notifications/1",
  target: { prototypeId: 1, threadId: 1, commentId: 1 },
}
const meta = {
  title: "Hub/Pages/Notifications",
  component: NotificationsPage,
  args: {
    data: {
      ...authenticatedHubWorkspaceData,
      collapseNavigationLabel: "Collapse sidebar",
      expandNavigationLabel: "Expand sidebar",
      navigationLabel: "Repository navigation",
      notificationsPath: "/notifications",
      notificationsLabel: "Inbox",
      notificationsUnread: true,
      notificationsUnreadCount: 1,
      notificationsUnreadLabel: "Inbox, 1 unread items",
      repository: {
        ...authenticatedHubWorkspaceData.repository,
        newPrototypeLabel: "Create",
        newPrototypePath: "/repositories/2001/new",
        prototypesLabel: "Prototypes",
        prototypesPath: "/repositories/2001",
        repositories: [githubPrototype],
        repositoryMenuLabel: "Repositories",
        selectedRepositoryId: "2001",
        repositorySelectorLabel: "Choose repository. github/prototype selected",
      },
      notificationInbox: {
        path: "/notifications/inbox",
        copy: {
          ...inboxCopy,
          error: "Notifications could not be updated. Try again.",
          loading: "Loading notifications...",
          loadMore: "Load more",
          retry: "Retry",
        },
      },
    },
    notifications: [notification],
    unreadCount: 1,
    unreadOnly: false,
    loading: false,
    failed: false,
    hasMore: false,
    onFilter: () => {},
    onToggleRead: () => {},
    onLoadMore: () => {},
    onRetry: () => {},
  },
} satisfies Meta<typeof NotificationsPage>

export default meta
type Story = StoryObj<typeof meta>
export const Single: Story = {}
export const NoRepositories: Story = {
  args: {
    data: { ...meta.args.data, repository: null, securityAuditPath: null },
  },
}
export const Empty: Story = {
  args: {
    notifications: [],
    unreadCount: 0,
    data: { ...meta.args.data, notificationsUnread: false, notificationsUnreadCount: 0 },
  },
}
export const Multiple: Story = {
  args: {
    notifications: (
      ["comment", "mention", "reply", "reaction", "resolved", "reopened", "reaction"] as const
    ).map((kind, index) => {
      const id = index + 1
      const commentId = kind === "reply" ? 2 : 1
      return {
        ...notification,
        id,
        kind,
        reactionContent: kind === "reaction" ? (index === 6 ? "heart" : "+1") : null,
        read: index === 3 || kind === "resolved",
        excerpt:
          kind === "comment"
            ? "Could we make the next step clearer?"
            : kind === "reply"
              ? "I have updated the spacing."
              : notification.excerpt,
        path: `/repositories/2001/prototypes/1?comment=${commentId}&notification=${id}`,
        updatePath: `/notifications/${id}`,
        target: { ...notification.target, commentId },
      }
    }),
    unreadCount: 5,
    data: {
      ...meta.args.data,
      notificationsUnreadCount: 5,
      notificationsUnreadLabel: "Inbox, 5 unread items",
    },
  },
}
export const Failure: Story = { args: { notifications: [], failed: true } }
export const Loading: Story = { args: { notifications: [], loading: true } }

export const CachedRefresh: Story = {
  beforeEach: () => {
    const originalFetch = globalThis.fetch
    let samples: InboxNotification[] = [
      { ...notification, id: 3, excerpt: "The next step could be clearer." },
      { ...notification, id: 2, excerpt: "Could we try a shorter label?" },
      { ...notification, id: 1, read: true, excerpt: "Previously read feedback." },
    ].map((item) => ({
      ...item,
      updatePath: `/notifications/${item.id}`,
      path: `/repositories/2001/prototypes/1?comment=1&notification=${item.id}`,
    }))
    let nextId = 4
    globalThis.fetch = async (input, init) => {
      const source =
        input instanceof Request ? input.url : input instanceof URL ? input.href : input
      const url = new URL(source, window.location.origin)
      if (url.pathname === "/__storybook__/notifications/new") {
        const id = nextId++
        samples.unshift({
          ...notification,
          id,
          kind: "comment",
          createdAt: new Date().toISOString(),
          excerpt: `New sample notification ${id}.`,
          updatePath: `/notifications/${id}`,
          path: `/repositories/2001/prototypes/1?comment=1&notification=${id}`,
        })
        return Response.json({ queued: true })
      }
      if (url.pathname === "/notifications/inbox") {
        await new Promise((resolve) => window.setTimeout(resolve, 900))
        const unread = url.searchParams.get("unread") === "true"
        return Response.json({
          notifications: samples
            .filter((item) => !unread || !item.read)
            .slice(0, Number(url.searchParams.get("limit")) || 50),
          nextBefore: null,
          unreadCount: samples.filter((item) => !item.read).length,
        })
      }
      if (/^\/notifications\/\d+$/.test(url.pathname) && init?.method === "PATCH") {
        const id = Number(url.pathname.split("/").at(-1))
        const item = samples.find((sample) => sample.id === id)
        if (!item) return new Response(null, { status: 404 })

        if (typeof init.body !== "string") throw new Error("Expected a JSON notification update")

        const { notification: update } = JSON.parse(init.body) as {
          notification: { read: boolean; version: number }
        }
        if (update.version !== item.version) return new Response(null, { status: 409 })

        samples = samples.map((sample) =>
          sample.id === id ? { ...sample, read: update.read, version: sample.version + 1 } : sample,
        )
        return Response.json({
          read: update.read,
          version: item.version + 1,
          unreadCount: samples.filter((sample) => !sample.read).length,
        })
      }
      return originalFetch(input, init)
    }
    return () => {
      globalThis.fetch = originalFetch
    }
  },
  render: function CachedNotificationsPreview(args) {
    const inbox = useNotificationInbox({
      path: args.data.notificationInbox.path,
      authenticityToken: args.data.authenticityToken,
      initialUnreadCount: 2,
      onReadChange: (id, saved) => data.liveInbox?.onReadUpdate(id, saved),
    })
    const data = useRepositoryInbox(
      { ...args.data, notificationsUnreadCount: inbox.unreadCount },
      { onReadChange: inbox.onReadUpdate, onUnreadCountChange: inbox.onUnreadCountChange },
    )

    return (
      <>
        <div style={{ padding: "1rem", display: "flex", gap: "1rem", alignItems: "center" }}>
          <span>Sample notifications. Refreshes take 900ms; cached items stay visible.</span>
          <Button
            size="small"
            onClick={() => void fetch("/__storybook__/notifications/new", { method: "POST" })}
          >
            Add sample notification
          </Button>
        </div>
        <NotificationsPage {...args} data={data} {...inbox} />
      </>
    )
  },
}
