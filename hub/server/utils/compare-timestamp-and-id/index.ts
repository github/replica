interface Selection {
  createdAt: Date | null
  id: bigint | null
}

/** Sorts null timestamps first and unknown IDs last at the same timestamp. */
export function compareTimestampAndId(first: Selection, second: Selection): number {
  const firstTime = first.createdAt?.getTime() ?? 0
  const secondTime = second.createdAt?.getTime() ?? 0
  if (firstTime !== secondTime) return firstTime > secondTime ? 1 : -1
  if (firstTime === 0) return 0
  if (first.id === second.id) return 0
  if (first.id === null) return 1
  if (second.id === null) return -1
  return first.id > second.id ? 1 : -1
}
