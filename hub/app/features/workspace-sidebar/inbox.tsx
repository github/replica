import { useState } from "react"
import type { MouseEventHandler, ReactNode } from "react"
import { createPortal } from "react-dom"
import { InboxIcon } from "@primer/octicons-react"

import { RepositoryNavigationItem } from "@components/repository-navigation-item"
import { ConversationInbox } from "@features/conversation-inbox"
import { useHoverPreview } from "@hooks/use-hover-preview"

import type { WorkspaceSidebarData } from "./types"
import "./inbox.css"

export function WorkspaceInbox({
  collapsed,
  data,
  inboxPreview,
  onInboxClick,
}: {
  collapsed: boolean
  data: WorkspaceSidebarData
  inboxPreview?: (close: () => void) => ReactNode
  onInboxClick?: MouseEventHandler<HTMLAnchorElement>
}) {
  const liveInbox = data.liveInbox
  const { open, triggerRef, panelRef, enter, leave, close } = useHoverPreview(
    Boolean(inboxPreview || liveInbox),
  )
  const [position, setPosition] = useState({ top: 12, left: 12, width: 448, maxHeight: 592 })
  function openPreview() {
    const trigger = triggerRef.current
    if (trigger) {
      const rect = (trigger.querySelector("a") ?? trigger).getBoundingClientRect()
      const narrowExpanded = !collapsed && window.innerWidth <= 768
      const width = Math.min(448, window.innerWidth - (narrowExpanded ? 24 : 72))
      const left = Math.max(12, Math.min(rect.right + 8, window.innerWidth - width - 12))
      const top = Math.max(
        12,
        Math.min(narrowExpanded ? rect.bottom + 8 : rect.top, window.innerHeight - 200),
      )
      setPosition({ left, top, width, maxHeight: Math.min(592, window.innerHeight - top - 12) })
    }
    enter()
    if (!open) liveInbox?.onOpen()
  }

  if (!data.notificationsPath || !data.notificationsLabel) return null

  return (
    <li
      className="repository-navigation__notifications"
      ref={triggerRef}
      onMouseEnter={openPreview}
      onMouseLeave={(event) => leave({ x: event.clientX, y: event.clientY })}
      onFocus={openPreview}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !panelRef.current?.contains(event.relatedTarget)
        )
          close()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          triggerRef.current?.querySelector<HTMLAnchorElement>("a")?.focus()
          close()
          event.stopPropagation()
        }
      }}
    >
      <RepositoryNavigationItem
        href={data.notificationsPath}
        icon={InboxIcon}
        label={data.notificationsLabel}
        ariaLabel={data.notificationsUnread ? data.notificationsUnreadLabel : undefined}
        count={data.notificationsUnreadCount}
        selected={data.selectedSection === "notifications"}
        onClick={(event) => {
          close()
          onInboxClick?.(event)
        }}
      />
      {data.notificationsUnread && data.notificationsUnreadCount === undefined ? (
        <span className="repository-navigation__unread" aria-hidden="true" />
      ) : null}
      {(inboxPreview || liveInbox) && open
        ? createPortal(
            <div
              ref={panelRef}
              className="repository-navigation__inbox-preview"
              style={position}
              onMouseEnter={enter}
              onMouseLeave={(event) => leave({ x: event.clientX, y: event.clientY })}
            >
              {inboxPreview ? (
                inboxPreview(close)
              ) : liveInbox ? (
                <ConversationInbox
                  items={liveInbox.notifications}
                  copy={liveInbox.copy}
                  totalUnreadCount={liveInbox.unreadCount}
                  unreadOnly
                  onFilter={liveInbox.onFilter}
                  onToggleRead={liveInbox.onToggleRead}
                  viewAllPath={data.notificationsPath}
                  onViewAll={close}
                  onOpenActivity={close}
                  status={{ ...liveInbox, onRetry: liveInbox.onRetry }}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </li>
  )
}
