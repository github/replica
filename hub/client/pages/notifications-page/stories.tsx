import { useEffect, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@primer/react-brand"

import { inboxActivities } from "@/storybook/fixtures/inbox-activity"
import { signedInRepository, signedInWorkspace } from "@/storybook/fixtures/signed-in-workspace"
import { notificationInboxConfiguration } from "@utils/notification/inbox-configuration"
import type { InboxNotification } from "@utils/notification/types"

import { NotificationsPage } from "."
import type { NotificationsPageProps } from "./types"

const pageSize = 4
const activity: InboxNotification[] = inboxActivities.slice(0, 8).map((item, index, items) => {
  const id = items.length - index
  const { threadId, commentId } = item.target
  const prototypeId = `00000000-0000-4000-8000-00000000020${item.target.prototypeId}`
  return {
    ...item,
    id,
    version: 0,
    read: index === 2 || index === 5,
    target: { prototypeId, threadId, commentId },
    path: `${signedInRepository.prototypesPath}/prototypes/${prototypeId}?comment=${threadId}&message=${commentId}&notification=${id}`,
    updatePath: `/api/notifications/${id}`,
  }
})

function InboxStory({
  allowRefresh = false,
  ...args
}: NotificationsPageProps & { allowRefresh?: boolean }) {
  const [items, setItems] = useState(args.notifications)
  const [unreadOnly, setUnreadOnly] = useState(args.unreadOnly)
  const [visibleLimit, setVisibleLimit] = useState(pageSize)
  const [failed, setFailed] = useState(args.failed)
  const [refreshing, setRefreshing] = useState(false)
  const unread = items.filter((item) => !item.read)
  const matchingItems = unreadOnly ? unread : items

  useEffect(() => {
    if (!refreshing) return

    const timer = window.setTimeout(() => {
      setItems(([latest, ...older]) => {
        if (!latest) return []

        const id = latest.id + 1
        const { prototypeId, threadId, commentId } = latest.target
        return [
          {
            ...latest,
            id,
            version: 0,
            read: false,
            kind: "mention",
            excerpt: "@octocat, the revised welcome flow is ready to review.",
            createdAt: new Date().toISOString(),
            path: `${signedInRepository.prototypesPath}/prototypes/${prototypeId}?comment=${threadId}&message=${commentId}&notification=${id}`,
            updatePath: `/api/notifications/${id}`,
          },
          latest,
          ...older,
        ]
      })
      setRefreshing(false)
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [refreshing])

  return (
    <>
      <NotificationsPage
        {...args}
        notifications={failed ? [] : matchingItems.slice(0, visibleLimit)}
        unreadOnly={unreadOnly}
        unreadCount={failed ? 0 : unread.length}
        failed={failed}
        hasMore={matchingItems.length > visibleLimit}
        onFilter={(next) => {
          if (next === unreadOnly) return
          setUnreadOnly(next)
          setVisibleLimit(pageSize)
        }}
        onToggleRead={(id) =>
          setItems((current) =>
            current.map((item) =>
              item.id === id ? { ...item, read: !item.read, version: item.version + 1 } : item,
            ),
          )
        }
        onLoadMore={() => setVisibleLimit((current) => current + pageSize)}
        onRetry={() => setFailed(false)}
      />
      {allowRefresh ? (
        <div style={{ position: "fixed", right: "1rem", bottom: "1rem" }}>
          <Button size="small" disabled={refreshing} onClick={() => setRefreshing(true)}>
            {refreshing ? "Refreshing sample activity…" : "Add sample activity and refresh"}
          </Button>
        </div>
      ) : null}
    </>
  )
}

const meta = {
  title: "Hub/Pages/Inbox",
  component: NotificationsPage,
  parameters: { layout: "fullscreen" },
  render: (args, { id }) => <InboxStory key={id} {...args} />,
  args: {
    data: {
      ...signedInWorkspace,
      notificationsLabel: "Inbox",
      notificationsPath: `/notifications?repositoryId=${signedInRepository.selectedRepositoryId}`,
      notificationsUnread: true,
      // The page gets its data from this story, not the sidebar's connected requests.
      notificationInbox: notificationInboxConfiguration,
    },
    notifications: activity.slice(0, 1),
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
export const Empty: Story = {
  args: {
    notifications: [],
    unreadCount: 0,
    data: { ...meta.args.data, notificationsUnread: false },
  },
}
export const NoRepositories: Story = {
  args: {
    ...Empty.args,
    data: {
      ...meta.args.data,
      repository: null,
      navigationLabel: "Hub navigation",
      emptyRepositoryLabel: "No repository selected",
      canvasConnectionsPath: "/canvas/connections",
      notificationsPath: "/notifications",
      notificationsUnread: false,
    },
  },
}
export const Multiple: Story = { args: { notifications: activity, unreadCount: 6 } }
export const Failure: Story = { args: { notifications: activity, unreadCount: 0, failed: true } }
export const Loading: Story = { args: { ...Empty.args, loading: true } }

export const CachedRefresh: Story = {
  args: { notifications: activity.slice(0, 3), unreadCount: 2 },
  render: (args, { id }) => <InboxStory key={id} {...args} allowRefresh />,
}
