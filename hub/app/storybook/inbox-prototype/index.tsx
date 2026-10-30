import { useState } from "react"

import { PrototypeCard } from "@components/prototype-card"
import { ConversationInbox } from "@features/conversation-inbox"
import { PrototypeIndexHeader } from "@features/prototype-index-header"
import { RepositoryWorkspace } from "@features/repository-workspace"
import type { ConversationActivity } from "@features/conversation-inbox/types"

import { InboxPrototypeConversation } from "../inbox-prototype-conversation"
import { authenticatedHeaderData } from "../fixtures/authenticated-header"
import { inboxActivities, inboxCopy } from "../fixtures/inbox-activity"
import { welcomePrototype } from "../fixtures/prototypes"
import { githubEmpty, githubPrototype } from "../fixtures/repositories"

import "./styles.css"

export function InboxPrototype({
  empty = false,
  initialInbox = false,
  initialUnread = false,
  defaultNavigationCollapsed = false,
}: {
  empty?: boolean
  initialInbox?: boolean
  initialUnread?: boolean
  defaultNavigationCollapsed?: boolean
}) {
  const [inbox, setInbox] = useState(initialInbox)
  const [unreadOnly, setUnreadOnly] = useState(initialUnread)
  const [items, setItems] = useState(inboxActivities)
  const [search, setSearch] = useState("")
  const [selectedActivity, setSelectedActivity] = useState<ConversationActivity | null>(null)
  const visibleItems = empty ? [] : items
  const unreadCount = visibleItems.filter((item) => !item.read).length
  const inboxProps = {
    items: visibleItems,
    copy: inboxCopy,
    unreadOnly,
    onFilter: setUnreadOnly,
    onToggleRead: (id: number) =>
      setItems((previous) =>
        previous.map((item) => (item.id === id ? { ...item, read: !item.read } : item)),
      ),
    onViewAll: () => {
      setSelectedActivity(null)
      setInbox(true)
    },
    onOpenActivity: (activity: ConversationActivity) => {
      setSelectedActivity(activity)
      setInbox(false)
    },
  }

  return (
    <div
      onClick={(event) => {
        if (!(event.target instanceof Element)) return
        if (event.target.closest('a[href="#prototypes"]')) {
          event.preventDefault()
          setInbox(false)
          setSelectedActivity(null)
        }
      }}
    >
      <RepositoryWorkspace
        defaultNavigationCollapsed={defaultNavigationCollapsed}
        data={{
          ...authenticatedHeaderData,
          collapseNavigationLabel: "Collapse sidebar",
          expandNavigationLabel: "Expand sidebar",
          navigationLabel: "Repository navigation",
          newPrototypeLabel: "Create",
          newPrototypePath: "#prototypes",
          prototypesLabel: "Prototypes",
          prototypesPath: "#prototypes",
          notificationsLabel: "Inbox",
          notificationsPath: "#inbox",
          notificationsUnread: unreadCount > 0,
          notificationsUnreadCount: unreadCount,
          notificationsUnreadLabel: `Inbox, ${inboxCopy.unreadCount.replace("%{count}", String(unreadCount))}`,
          selectedSection: inbox ? "notifications" : "prototypes",
          repositories: [githubPrototype, githubEmpty],
          repositoryMenuLabel: "Repositories",
          repositorySelectorLabel: "Choose repository. github/prototype selected",
          selectedRepositoryId: "2001",
        }}
        inboxPreview={(close) => (
          <ConversationInbox
            {...inboxProps}
            onViewAll={() => {
              close()
              inboxProps.onViewAll()
            }}
            onOpenActivity={(activity) => {
              close()
              inboxProps.onOpenActivity(activity)
            }}
          />
        )}
        onInboxClick={(event) => {
          event.preventDefault()
          setInbox(true)
          setSelectedActivity(null)
        }}
      >
        <div className="inbox-prototype__notice">
          Visual prototype · Sample activity, not connected to Hub
        </div>
        {selectedActivity ? (
          <InboxPrototypeConversation
            key={selectedActivity.id}
            activity={selectedActivity}
            onBack={inboxProps.onViewAll}
          />
        ) : inbox ? (
          <div className="inbox-prototype__page">
            <ConversationInbox {...inboxProps} mode="page" />
          </div>
        ) : (
          <>
            <PrototypeIndexHeader
              heading="Prototypes"
              clearSearchLabel="Clear search"
              searchLabel="Search prototypes"
              searchQuery={search}
              onSearchChange={setSearch}
            />
            <div className="inbox-prototype__gallery">
              {["Welcome", "Navigation refresh", "Settings exploration"]
                .filter((name) => name.toLowerCase().includes(search.toLowerCase()))
                .map((name, index) => (
                  <PrototypeCard
                    key={name}
                    prototype={{
                      ...welcomePrototype,
                      id: String(index + 1),
                      name,
                      path: "#prototypes",
                      description: "Explore the latest iteration and join the conversation.",
                    }}
                    passingLabel="passing"
                    notPassingLabel="not passing"
                    noBuildLabel="No build yet"
                  />
                ))}
            </div>
          </>
        )}
      </RepositoryWorkspace>
    </div>
  )
}
