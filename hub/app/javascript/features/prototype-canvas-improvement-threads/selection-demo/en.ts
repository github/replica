import { copy as threadCopy } from "../en"

export const copy = {
  ...threadCopy,
  select: (body: string) => `Select note: ${body}`,
  selected: (count: number) => `${count} selected`,
  selection: "Selected notes",
  clear: "clear selection",
  fixSelected: "Fix selected",
}
