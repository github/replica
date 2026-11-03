import { Button } from "@primer/react-brand"

import { ConversationInbox } from "@features/conversation-inbox"
import { HubWorkspace } from "@features/hub-workspace"

import type { NotificationsPageProps } from "./types"

import "./styles.css"

export function NotificationsPage({
  data,
  notifications,
  unreadCount,
  unreadOnly,
  loading,
  failed,
  hasMore,
  onFilter,
  onToggleRead,
  onLoadMore,
  onRetry,
}: NotificationsPageProps) {
  const copy = data.notificationInbox.copy
  return (
    <HubWorkspace
      data={{
        ...data,
        notificationsUnread: unreadCount > 0,
        notificationsUnreadCount: unreadCount,
        notificationsUnreadLabel: `${copy.heading}, ${copy.unreadCount.replace("%{count}", String(unreadCount))}`,
        selectedSection: "notifications",
      }}
    >
      <div className="notifications-page">
        <ConversationInbox
          mode="page"
          items={notifications}
          totalUnreadCount={unreadCount}
          copy={copy}
          unreadOnly={unreadOnly}
          onFilter={onFilter}
          onToggleRead={onToggleRead}
          status={{ loading, failed, copy, onRetry }}
        />
        {hasMore && !failed ? (
          <Button disabled={loading} onClick={onLoadMore}>
            {copy.loadMore}
          </Button>
        ) : null}
      </div>
    </HubWorkspace>
  )
}
