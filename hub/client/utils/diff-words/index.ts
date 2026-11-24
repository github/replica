import type { WordDiffPart } from "./types"

type Run = { kind: "unchanged"; text: string } | { kind: "changed"; removed: string; added: string }

// Words, runs of spaces, and single punctuation marks, so "action." still matches
// "action".
const tokenPattern = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu
const wordPattern = /[\p{L}\p{N}_]+/gu

/**
 * Compares two pieces of text word by word so an admin can see exactly what a
 * suggested edit removes and adds. Removed text comes before added text. A shared
 * word or space caught between two edits joins them, so changes read as whole phrases
 * instead of alternating fragments.
 */
export function diffWords(before: string, after: string): WordDiffPart[] {
  const oldTokens = before.match(tokenPattern) ?? []
  const newTokens = after.match(tokenPattern) ?? []

  // Longest common subsequence lengths, filled from the end of both texts.
  const width = newTokens.length + 1
  const common = new Array<number>((oldTokens.length + 1) * width).fill(0)
  function commonAt(i: number, j: number) {
    return common[i * width + j] ?? 0
  }
  for (let i = oldTokens.length - 1; i >= 0; i -= 1) {
    for (let j = newTokens.length - 1; j >= 0; j -= 1) {
      common[i * width + j] =
        oldTokens[i] === newTokens[j]
          ? commonAt(i + 1, j + 1) + 1
          : Math.max(commonAt(i + 1, j), commonAt(i, j + 1))
    }
  }

  const runs: Run[] = []
  let i = 0
  let j = 0
  while (i < oldTokens.length || j < newTokens.length) {
    const oldToken = oldTokens[i]
    const newToken = newTokens[j]
    if (oldToken !== undefined && oldToken === newToken) {
      appendRun(runs, { kind: "unchanged", text: oldToken })
      i += 1
      j += 1
    } else if (
      oldToken !== undefined &&
      (newToken === undefined || commonAt(i + 1, j) >= commonAt(i, j + 1))
    ) {
      appendRun(runs, { kind: "changed", removed: oldToken, added: "" })
      i += 1
    } else {
      appendRun(runs, { kind: "changed", removed: "", added: newToken ?? "" })
      j += 1
    }
  }

  const merged: Run[] = []
  runs.forEach((run, index) => {
    const foldsIntoChange =
      run.kind === "unchanged" &&
      runs[index - 1]?.kind === "changed" &&
      runs[index + 1]?.kind === "changed" &&
      (run.text.match(wordPattern) ?? []).length <= 1
    if (foldsIntoChange) {
      appendRun(merged, { kind: "changed", removed: run.text, added: run.text })
    } else {
      appendRun(merged, run)
    }
  })

  return merged.flatMap((run): WordDiffPart[] => {
    if (run.kind === "unchanged") return [{ kind: "unchanged", text: run.text }]
    return [
      ...(run.removed ? [{ kind: "removed" as const, text: run.removed }] : []),
      ...(run.added ? [{ kind: "added" as const, text: run.added }] : []),
    ]
  })
}

// Joins a run onto the previous one when both are the same kind.
function appendRun(runs: Run[], run: Run) {
  const last = runs.at(-1)
  if (last?.kind === "unchanged" && run.kind === "unchanged") {
    last.text += run.text
  } else if (last?.kind === "changed" && run.kind === "changed") {
    last.removed += run.removed
    last.added += run.added
  } else {
    runs.push({ ...run })
  }
}
