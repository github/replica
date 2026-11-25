export function countPendingImprovements(
  threads: { originalPending: boolean; messages: { pending?: boolean }[] }[],
) {
  return threads.reduce(
    (count, thread) =>
      count +
      Number(thread.originalPending) +
      thread.messages.filter((entry) => entry.pending).length,
    0,
  )
}
