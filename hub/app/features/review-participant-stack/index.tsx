import { HubUserAvatar } from "@components/hub-user-avatar"

import type { ReviewParticipantStackProps } from "./types"

import "./styles.css"

export function ReviewParticipantStack({ participants, size }: ReviewParticipantStackProps) {
  const avatarSize = 24
  const visibleParticipants = participants.slice(0, 4)
  const overflowCount = participants.length - 3

  return (
    <span
      className={`review-participant-stack review-participant-stack--${size}`}
      data-avatar-count={visibleParticipants.length}
      data-participant-count={participants.length}
      aria-hidden="true"
    >
      {(overflowCount > 1 ? visibleParticipants.slice(0, 3) : visibleParticipants).map(
        (participant) => (
          <span className="review-participant-stack__avatar" key={participant.login}>
            <HubUserAvatar src={participant.avatarUrl} size={avatarSize} />
          </span>
        ),
      )}

      {overflowCount > 1 ? (
        <span className="review-participant-stack__avatar review-participant-stack__avatar--overflow">
          +{overflowCount}
        </span>
      ) : null}
    </span>
  )
}
