import type {
  ConversationActivity,
  ConversationActivityKind,
  ConversationInboxCopy,
} from "@features/conversation-inbox/types"

import { mona, octocat } from "./users"

export const inboxCopy: ConversationInboxCopy = {
  heading: "Inbox",
  all: "All",
  unread: "Unread",
  unreadCount: "%{count} unread items",
  empty: "No activity yet",
  emptyDescription: "Mentions and updates to your conversations will appear here.",
  emptyUnread: "You are all caught up",
  emptyUnreadDescription: "No unread activity. Switch to All to revisit your conversations.",
  viewAll: "View all",
  markRead: "Mark as read",
  markUnread: "Mark as unread",
  actions: {
    comment: "commented on your prototype",
    mention: "mentioned you",
    reply: "replied to a conversation",
    reaction: "reacted to your comment",
    resolved: "resolved a conversation",
    reopened: "reopened a conversation",
  },
}

const examples: Array<{
  kind: ConversationActivityKind
  prototype: string
  excerpt: string
}> = [
  {
    kind: "mention",
    prototype: "Welcome",
    excerpt: "@octocat, does this feel like the right place for the next step?",
  },
  {
    kind: "reply",
    prototype: "Navigation refresh",
    excerpt: "I tried the narrower version. The labels are much easier to scan now.",
  },
  {
    kind: "reaction",
    prototype: "Welcome",
    excerpt: "Added a thumbs-up to your comment: “This makes the first step feel clearer.”",
  },
  {
    kind: "resolved",
    prototype: "Settings exploration",
    excerpt: "The updated spacing is in the latest build. Thanks for catching this!",
  },
  {
    kind: "reply",
    prototype: "Welcome",
    excerpt: "What if we keep the primary action visible while the panel is open?",
  },
  {
    kind: "mention",
    prototype: "Navigation refresh",
    excerpt: "@octocat, I added the empty state we discussed. Would love another look.",
  },
  {
    kind: "reopened",
    prototype: "Settings exploration",
    excerpt: "Reopening this so we can compare the compact layout on smaller screens.",
  },
  {
    kind: "comment",
    prototype: "Welcome",
    excerpt: "Could we make the next step clearer?",
  },
]

export const inboxActivities: ConversationActivity[] = Array.from({ length: 16 }, (_, index) => {
  const example = examples[index % examples.length]
  if (!example) throw new Error("Inbox activity fixture is missing")

  return {
    ...example,
    reactionContent: example.kind === "reaction" ? "+1" : null,
    id: index + 1,
    actor: example.kind !== "mention" && index % 3 === 0 ? octocat : mona,
    repository: "github/prototype",
    createdAt: new Date(Date.now() - (index + 1) * 12 * 60_000).toISOString(),
    read: index > 5,
    target: {
      prototypeId:
        example.prototype === "Welcome" ? 1 : example.prototype === "Navigation refresh" ? 2 : 3,
      threadId: (index % examples.length) + 1,
      commentId: (index % examples.length) + 1 + (example.kind === "reply" ? 1000 : 0),
    },
  }
})
