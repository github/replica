export interface WordDiffPart {
  kind: "unchanged" | "removed" | "added"
  text: string
}
