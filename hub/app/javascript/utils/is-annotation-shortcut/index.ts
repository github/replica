export function isAnnotationShortcut(event: KeyboardEvent) {
  if (
    event.key.toLowerCase() !== "v" ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return false

  const target = event.target
  if (!(target instanceof Element)) return true
  if (
    target.closest(
      'input, textarea, select, [role="textbox"], [role="combobox"], [role="dialog"], dialog, [role="menu"]',
    )
  )
    return false

  const editable = target.closest("[contenteditable]")
  return editable === null || editable.getAttribute("contenteditable") === "false"
}
