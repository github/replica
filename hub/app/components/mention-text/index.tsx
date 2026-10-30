import type { ReactNode } from "react"

import type { ReviewComment } from "@utils/review-comment/types"

import "./styles.css"

export function MentionText({ comment }: { comment: ReviewComment }) {
  const body = comment.body ?? ""
  const mentions = new Set(comment.mentions?.map((mention) => mention.login.toLowerCase()) ?? [])
  const tokens = body.matchAll(
    /(?<![A-Za-z0-9_@/])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![A-Za-z0-9_-])/g,
  )
  const parts: ReactNode[] = []
  let start = 0
  for (const token of tokens) {
    if (!token[1] || !mentions.has(token[1].toLowerCase())) continue

    parts.push(body.slice(start, token.index))
    parts.push(
      <span className="mention-text" key={token.index}>
        {token[0]}
      </span>,
    )
    start = token.index + token[0].length
  }
  parts.push(body.slice(start))
  return <>{parts}</>
}
