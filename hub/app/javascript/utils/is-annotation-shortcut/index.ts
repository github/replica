export function isAnnotationShortcut(event: KeyboardEvent) {
  if (
    (event.key !== "s" && event.key !== "S") ||
    !event.isTrusted ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return false

  const path = event.composedPath().filter((target): target is Element => target instanceof Element)
  if (path.length === 0 && event.target instanceof Element) path.push(event.target)

  for (const target of path) {
    if (
      target.closest(
        'input, textarea, select, [role="textbox"], [role="combobox"], [role="dialog"], dialog, [role="menu"]',
      )
    )
      return false

    const editable = target.closest("[contenteditable]")
    if (editable !== null && editable.getAttribute("contenteditable") !== "false") return false
  }

  return true
}
