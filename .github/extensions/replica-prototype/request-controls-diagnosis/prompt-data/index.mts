export function promptData(value: Record<string, unknown>) {
  return JSON.stringify(value).replace(
    /[<>`@\u007f-\u009f\u061c\u200e-\u200f\u2028-\u202e\u2066-\u2069]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}
