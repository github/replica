/** Keeps injected bindings and canvas clicks behind the same DOM safety checks. */
export function targetIssue(element, clicking = false) {
  if (!(element instanceof HTMLElement) || !element.isConnected)
    return "The binding target is missing or stale."
  const rect = element.getBoundingClientRect()
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor)
    if (
      ancestor.hasAttribute("hidden") ||
      ancestor.hasAttribute("inert") ||
      ancestor.getAttribute("aria-hidden") === "true" ||
      ancestor.getAttribute("aria-disabled") === "true" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.display === "none" ||
      Number(style.opacity || 1) === 0
    )
      return "The binding target is hidden or disabled."
  }
  if (
    element.hasAttribute("data-replica-canvas-bridge") ||
    element.matches(":disabled") ||
    !rect.width ||
    !rect.height
  )
    return "The binding target is hidden or disabled."
  if (!clicking) return ""
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  if (!hit || (hit !== element && !element.contains(hit)))
    return "The binding target is blocked by another element."
  const control = element.closest(
    'button, input, select, textarea, [role="button"], [role="link"], a',
  )
  const form =
    element.closest("form") ||
    (element instanceof HTMLButtonElement || element instanceof HTMLInputElement
      ? element.form
      : null)
  if (control !== element || form) return "The binding target is not a safe standalone control."
  const anchor = element.closest("a")
  if (anchor) {
    const href = anchor.getAttribute("href")
    let destination
    try {
      destination = new URL(href || "", window.location.href)
    } catch {
      return "The binding target has an invalid link URL."
    }
    if (
      !href ||
      !["http:", "https:"].includes(destination.protocol) ||
      destination.origin !== window.location.origin ||
      destination.username ||
      destination.password ||
      anchor.hasAttribute("download") ||
      (anchor.hasAttribute("target") && anchor.getAttribute("target") !== "_self")
    )
      return "The binding target leaves the prototype or downloads a file."
  }
  return ""
}
