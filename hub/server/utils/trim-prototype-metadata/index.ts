// Matches the database metadata guard, which also treats NEL as blank.
const edgeSpace = /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$/u

export function trimPrototypeMetadata(value: string) {
  let start = 0
  let end = value.length
  while (start < end && edgeSpace.test(value.charAt(start))) start += 1
  while (end > start && edgeSpace.test(value.charAt(end - 1))) end -= 1
  return value.slice(start, end)
}
