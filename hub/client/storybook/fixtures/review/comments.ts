import type {
  ReviewCommentFilters,
  ReviewRootComment,
  ReviewThread,
} from "@utils/review-comment/types"

import { mona, octocat } from "../users"

export const defaultReviewFilters: ReviewCommentFilters = {
  search: "",
  currentBuildOnly: false,
  currentPageOnly: false,
  showResolved: false,
  showRead: true,
  onlyMine: false,
  participant: null,
}

export const overflowReviewParticipants = [
  octocat,
  mona,
  {
    login: "hubot",
    name: "Hubot",
    avatarUrl: "https://avatars.githubusercontent.com/u/480938?v=4",
  },
  {
    login: "defunkt",
    name: "Chris Wanstrath",
    avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
  },
  {
    login: "mojombo",
    name: "Tom Preston-Werner",
    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  },
]

export const octocatRootComment: ReviewRootComment = {
  id: 1,
  kind: "root",
  buildNumber: 1,
  buildPath: "/repositories/2001/prototypes/1?build=1",
  body: "Please align this control with the content above it.",
  anchor: {
    schemaVersion: 1,
    kind: "element",
    route: { pathname: "/", search: "", hash: "" },
    selector: "#save",
    accessibleName: "Save",
    tagName: "button",
    selectedText: "",
    rect: { x: 120, y: 160, width: 120, height: 40 },
    viewport: { width: 1_280, height: 720, scrollX: 0, scrollY: 0 },
    elementOffset: { x: 0.5, y: 0.5 },
  },
  createdAt: "2026-09-14T12:00:00Z",
  updatedAt: "2026-09-14T12:00:00Z",
  editedAt: null,
  deletedAt: null,
  resolvedAt: null,
  resolvedBy: null,
  activityVersion: 2,
  viewerLastSeenActivityVersion: 1,
  author: octocat,
  viewerCanEdit: true,
  viewerCanDelete: true,
  reactions: [{ content: "heart", count: 1, viewerHasReacted: true }],
}

export const singleReviewThread: ReviewThread = {
  root: octocatRootComment,
  replies: [],
  participants: [octocat],
  lastActivityAt: octocatRootComment.updatedAt,
  unread: true,
}

export const repliedReviewThread: ReviewThread = {
  root: octocatRootComment,
  replies: [
    {
      id: 2,
      kind: "reply",
      rootId: 1,
      body: "The spacing is updated.",
      createdAt: "2026-09-14T15:00:00Z",
      updatedAt: "2026-09-14T15:00:00Z",
      editedAt: null,
      deletedAt: null,
      author: mona,
      viewerCanEdit: false,
      viewerCanDelete: false,
      reactions: [],
    },
  ],
  participants: [octocat, mona],
  lastActivityAt: "2026-09-14T15:00:00Z",
  unread: false,
}
