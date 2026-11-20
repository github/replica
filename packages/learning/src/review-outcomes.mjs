/** Return the latest explicit reviewer outcome in sequence order, or null for legacy evidence. */
export function latestReviewOutcome(events) {
  return (
    events
      .filter(
        (event) =>
          event.type === "x-replica.review_outcome" &&
          event.payload &&
          ["confirmed_fixed", "still_present", "not_applicable", "needs_more_review"].includes(
            event.payload.outcome,
          ) &&
          Number.isSafeInteger(event.payload.sequence) &&
          event.payload.sequence > 0,
      )
      .sort((left, right) => left.payload.sequence - right.payload.sequence)
      .at(-1) ?? null
  )
}
