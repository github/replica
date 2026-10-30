import { isMacPlatform } from "@utils/is-mac-platform"

export function isSubmitShortcut(event: KeyboardEvent, { allowPlainEnter = false } = {}) {
  // Safari can end composition before the Enter keydown.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const composing = event.isComposing || event.keyCode === 229
  const submitModifier = isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
  const plainEnter = allowPlainEnter && !event.metaKey && !event.ctrlKey

  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !composing &&
    !event.repeat &&
    (submitModifier || plainEnter)
  )
}
