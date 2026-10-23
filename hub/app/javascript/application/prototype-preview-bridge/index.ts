import { installControlsBridge } from "./controls"
import { targetIssue } from "@utils/prototype-controls/dom-target.mjs"
import { isAnnotationShortcut } from "@utils/is-annotation-shortcut"

type ReviewRoute = { pathname: string; search: string; hash: string }
type AnchorRect = { x: number; y: number; width: number; height: number }
type AnchorViewport = { width: number; height: number; scrollX: number; scrollY: number }
type ElementAnchor = {
  schemaVersion: 1
  kind: "element"
  route: ReviewRoute
  selector: string
  accessibleName: string
  tagName: string
  selectedText: string
  rect: AnchorRect
  viewport: AnchorViewport
  elementOffset: { x: number; y: number }
}
type AreaElement = {
  selector: string
  accessibleName: string
  tagName: string
  role: string
  textExcerpt: string
  rect: AnchorRect
}
type AreaAnchor = {
  schemaVersion: 1
  kind: "area"
  route: ReviewRoute
  path: { x: number; y: number }[]
  rect: AnchorRect
  viewport: AnchorViewport
  elements: AreaElement[]
}
type ElementMatch = Pick<ElementAnchor, "selector" | "accessibleName" | "tagName"> & {
  selectedText?: string
}

const BRIDGE_ATTRIBUTE = "data-replica-canvas-bridge"
const TEXT_ENCODER = new TextEncoder()
let parentOrigin: string | null = null
let selectionShortcutNonce: string | null = null
let cleanupActiveSelection: (() => void) | null = null
let selectedOverlay: HTMLElement | null = null
let selectedOverlayTarget: Element | null = null
let selectionAccent = "light-dark(#0969da, #58a6ff)"
let resolvedRequest: { nonce: string; anchors: { id: number; anchor: unknown }[] } | null = null
let resolvedRoute = ""
let inPlaceRoute = ""
const resolvedGeometry = new Map<
  number,
  {
    x: number
    y: number
    rect?: AnchorRect
    viewportAnchored: boolean
    scrollX: number
    scrollY: number
  }
>()

function routeAddress() {
  const route = currentRoute()
  return route.pathname + route.search + route.hash
}

for (const type of ["popstate", "hashchange"]) {
  window.addEventListener(type, (event) => {
    inPlaceRoute =
      "replicaControlsBinding" in event && event.replicaControlsBinding ? routeAddress() : ""
  })
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function truncate(value: string, maximumBytes: number) {
  let result = ""
  let bytes = 0
  for (const character of value) {
    const characterBytes = TEXT_ENCODER.encode(character).length
    if (bytes + characterBytes > maximumBytes) break
    result += character
    bytes += characterBytes
  }
  return result
}

function currentRoute(): ReviewRoute {
  // Match Hub anchors without rewriting app-owned query encoding.
  const search = window.location.search
    .slice(1)
    .split("&")
    .filter((part) => {
      const key = new URLSearchParams(part).keys().next().value
      return key !== "rc" && !key?.startsWith("rc.")
    })
    .join("&")
  return {
    pathname: window.location.pathname,
    search: search ? `?${search}` : "",
    hash: window.location.hash,
  }
}

function currentViewport(): AnchorViewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }
}

function anchorRect(rect: DOMRect): AnchorRect {
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  }
}

function accessibleName(element: Element) {
  const labelledBy = element.getAttribute("aria-labelledby")
  const labelledText = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
    : ""
  const labels =
    "labels" in element && element.labels
      ? Array.from(element.labels as NodeListOf<HTMLLabelElement>)
          .map((label) => label.textContent || "")
          .join(" ")
      : ""
  return truncate(
    normalizeText(
      element.getAttribute("aria-label") ||
        labelledText ||
        labels ||
        element.getAttribute("alt") ||
        element.getAttribute("title") ||
        "",
    ),
    1000,
  )
}

function escapeSelector(value: string) {
  return typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
}

function selectorFor(element: Element) {
  if (element.id) {
    const selector = `#${escapeSelector(element.id)}`
    if (document.querySelectorAll(selector).length === 1) return selector
  }

  for (const attribute of ["data-testid", "data-test-id"]) {
    const value = element.getAttribute(attribute)
    if (!value) continue
    const selector = `[${attribute}="${escapeSelector(value)}"]`
    if (document.querySelectorAll(selector).length === 1) return selector
  }

  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== document.documentElement) {
    const tagName = current.tagName.toLowerCase()
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (child) => child.tagName === current?.tagName,
        )
      : []
    const part =
      siblings.length > 1 ? `${tagName}:nth-of-type(${siblings.indexOf(current) + 1})` : tagName
    parts.unshift(part)
    const selector = parts.join(" > ")
    if (document.querySelectorAll(selector).length === 1) return selector
    current = current.parentElement
  }
  return parts.join(" > ")
}

function matches(element: Element, anchor: ElementMatch) {
  if (element.tagName.toLowerCase() !== anchor.tagName) return false
  if (anchor.accessibleName && accessibleName(element) !== anchor.accessibleName) return false
  return (
    !anchor.selectedText || normalizeText(element.textContent || "").includes(anchor.selectedText)
  )
}

function findElement(anchor: ElementMatch) {
  let selected: Element | null = null
  try {
    selected = document.querySelector(anchor.selector)
  } catch {
    // Fall through to the unique accessible-context match.
  }
  if (selected && matches(selected, anchor)) return selected
  if (!anchor.accessibleName && !anchor.selectedText) return null

  let match: Element | null = null
  for (const element of document.getElementsByTagName(anchor.tagName)) {
    if (element === selected || !matches(element, anchor)) continue
    if (match) return null
    match = element
  }
  return match
}

function createOverlay() {
  const overlay = document.createElement("div")
  overlay.setAttribute(BRIDGE_ATTRIBUTE, "")
  Object.assign(overlay.style, {
    position: "fixed",
    colorScheme: "light dark",
    zIndex: "2147483647",
    pointerEvents: "none",
    border: "2px solid var(--replica-selection-accent)",
    borderRadius: "4px",
    background: "color-mix(in srgb, var(--replica-selection-accent) 12%, transparent)",
    boxSizing: "border-box",
  })
  overlay.style.setProperty("--replica-selection-accent", selectionAccent)
  document.documentElement.append(overlay)
  return overlay
}

function positionOverlay(overlay: HTMLElement, rect: DOMRect | AnchorRect) {
  const documentPositioned = overlay.style.position === "absolute"
  const left = "left" in rect ? rect.left : rect.x - window.scrollX
  const top = "top" in rect ? rect.top : rect.y - window.scrollY
  Object.assign(overlay.style, {
    left: `${left + (documentPositioned ? window.scrollX : 0)}px`,
    top: `${top + (documentPositioned ? window.scrollY : 0)}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
}

function replaceSelectedOverlay(overlay: HTMLElement, target: Element | null = null) {
  selectedOverlay?.remove()
  selectedOverlay = overlay
  selectedOverlayTarget = target
  selectedOverlay.style.pointerEvents = "none"
}

function post(origin: string, value: object) {
  window.parent.postMessage(value, origin)
}

function finishSelection() {
  cleanupActiveSelection?.()
  cleanupActiveSelection = null
}

function failSelection(origin: string, nonce: string, reason: string) {
  finishSelection()
  post(origin, { type: "replica:canvas:selection-failed", nonce, reason })
}

function elementAnchor(element: Element, clientX: number, clientY: number): ElementAnchor | null {
  const rect = element.getBoundingClientRect()
  const selector = selectorFor(element)
  if (!rect.width || !rect.height || !selector) return null
  const selectedText = truncate(normalizeText(window.getSelection()?.toString() || ""), 2000)
  return {
    schemaVersion: 1,
    kind: "element",
    route: currentRoute(),
    selector,
    accessibleName: accessibleName(element),
    tagName: element.tagName.toLowerCase(),
    selectedText: element.contains(window.getSelection()?.anchorNode || null) ? selectedText : "",
    rect: anchorRect(rect),
    viewport: currentViewport(),
    elementOffset: {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    },
  }
}

function startElementSelection(origin: string, nonce: string) {
  finishSelection()
  let hovered: Element | null = null
  const overlay = createOverlay()
  const previousCursor = document.documentElement.style.cursor
  document.documentElement.style.cursor = "crosshair"

  function move(event: PointerEvent) {
    const target =
      event.target instanceof Element ? event.target.closest(`:not([${BRIDGE_ATTRIBUTE}])`) : null
    if (!target || target === document.documentElement || target === document.body) {
      hovered = null
      overlay.style.display = "none"
      return
    }
    hovered = target
    overlay.style.display = "block"
    positionOverlay(overlay, target.getBoundingClientRect())
  }

  function select(event: MouseEvent) {
    if (!hovered) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const anchor = elementAnchor(hovered, event.clientX, event.clientY)
    if (!anchor) {
      overlay.remove()
      failSelection(origin, nonce, "element-unavailable")
      return
    }
    overlay.style.position = isViewportAnchoredElement(hovered) ? "fixed" : "absolute"
    positionOverlay(overlay, hovered.getBoundingClientRect())
    replaceSelectedOverlay(overlay, hovered)
    finishSelection()
    post(origin, { type: "replica:canvas:selected", nonce, anchor })
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return
    event.preventDefault()
    finishSelection()
    post(origin, { type: "replica:canvas:selection-cancelled", nonce })
  }

  document.addEventListener("pointermove", move, true)
  document.addEventListener("click", select, true)
  document.addEventListener("keydown", keydown, true)
  cleanupActiveSelection = () => {
    document.removeEventListener("pointermove", move, true)
    document.removeEventListener("click", select, true)
    document.removeEventListener("keydown", keydown, true)
    document.documentElement.style.cursor = previousCursor
    if (selectedOverlay !== overlay) overlay.remove()
  }
}

function areaElements(rect: DOMRect): AreaElement[] {
  const points: [number, number][] = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + 1, rect.top + 1],
    [rect.right - 1, rect.top + 1],
    [rect.right - 1, rect.bottom - 1],
    [rect.left + 1, rect.bottom - 1],
  ]
  const elements = new Set<Element>()
  for (const [x, y] of points) {
    for (const element of document.elementsFromPoint(x, y)) {
      if (!element.hasAttribute(BRIDGE_ATTRIBUTE)) elements.add(element)
      if (elements.size >= 8) break
    }
    if (elements.size >= 8) break
  }
  return Array.from(elements).flatMap((element) => {
    const selector = selectorFor(element)
    const elementRect = element.getBoundingClientRect()
    if (!selector || !elementRect.width || !elementRect.height) return []
    return [
      {
        selector,
        accessibleName: accessibleName(element),
        tagName: element.tagName.toLowerCase(),
        role: truncate(element.getAttribute("role") || "", 64),
        textExcerpt: truncate(normalizeText(element.textContent || ""), 500),
        rect: anchorRect(elementRect),
      },
    ]
  })
}

function areaAnchor(rect: DOMRect): AreaAnchor {
  return {
    schemaVersion: 1,
    kind: "area",
    route: currentRoute(),
    path: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ],
    rect: anchorRect(rect),
    viewport: currentViewport(),
    elements: areaElements(rect),
  }
}

function startAreaSelection(origin: string, nonce: string, allowElement = false) {
  finishSelection()
  const surface = document.createElement("div")
  surface.setAttribute(BRIDGE_ATTRIBUTE, "")
  Object.assign(surface.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    cursor: "crosshair",
    touchAction: "none",
  })
  const overlay = createOverlay()
  overlay.style.display = "none"
  document.body.append(surface)
  let start: { x: number; y: number } | null = null
  let target: Element | null = null
  let pointerId: number | null = null
  let keyboardPoint: { x: number; y: number } | null = null

  function elementAt(x: number, y: number) {
    surface.style.pointerEvents = "none"
    const element = document.elementFromPoint(x, y)
    surface.style.pointerEvents = ""
    return element === document.body || element === document.documentElement ? null : element
  }

  function complete(anchor: ElementAnchor | AreaAnchor, rect: DOMRect, element?: Element) {
    overlay.style.position = element && isViewportAnchoredElement(element) ? "fixed" : "absolute"
    positionOverlay(overlay, rect)
    replaceSelectedOverlay(overlay, element)
    finishSelection()
    post(origin, {
      type: "replica:canvas:selected",
      nonce,
      anchor,
    })
  }

  function update(clientX: number, clientY: number) {
    if (!start) return
    const left = Math.min(start.x, clientX)
    const top = Math.min(start.y, clientY)
    const width = Math.abs(clientX - start.x)
    const height = Math.abs(clientY - start.y)
    overlay.style.display = "block"
    positionOverlay(overlay, new DOMRect(left, top, width, height))
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || start) return
    event.preventDefault()
    start = { x: event.clientX, y: event.clientY }
    pointerId = event.pointerId
    target = allowElement ? elementAt(event.clientX, event.clientY) : null
    surface.setPointerCapture(event.pointerId)
    update(event.clientX, event.clientY)
  }

  function pointerMove(event: PointerEvent) {
    if (!start) {
      if (!allowElement) return
      const element = elementAt(event.clientX, event.clientY)
      overlay.style.display = element ? "block" : "none"
      if (element) positionOverlay(overlay, element.getBoundingClientRect())
      return
    }
    if (event.pointerId !== pointerId) return
    event.preventDefault()
    update(event.clientX, event.clientY)
  }

  function pointerUp(event: PointerEvent) {
    if (!start || event.pointerId !== pointerId) return
    event.preventDefault()
    const endX = Math.max(0, Math.min(window.innerWidth, event.clientX))
    const endY = Math.max(0, Math.min(window.innerHeight, event.clientY))
    const rect = new DOMRect(
      Math.min(start.x, endX),
      Math.min(start.y, endY),
      Math.abs(endX - start.x),
      Math.abs(endY - start.y),
    )
    if (allowElement && Math.hypot(rect.width, rect.height) < 8) {
      const anchor = target ? elementAnchor(target, start.x, start.y) : null
      if (!anchor || !target) {
        failSelection(origin, nonce, "element-unavailable")
        return
      }
      complete(anchor, target.getBoundingClientRect(), target)
      return
    }
    if (
      allowElement ? rect.width < 8 || rect.height < 8 : Math.hypot(rect.width, rect.height) < 8
    ) {
      failSelection(origin, nonce, "area-too-small")
      return
    }
    complete(areaAnchor(rect), rect)
  }

  function keyboardClick(event: MouseEvent) {
    if (
      !allowElement ||
      event.detail !== 0 ||
      !(event.target instanceof Element) ||
      event.target.hasAttribute(BRIDGE_ATTRIBUTE)
    )
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    const element = event.target
    const rect = element.getBoundingClientRect()
    const anchor = elementAnchor(element, rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (!anchor) {
      failSelection(origin, nonce, "element-unavailable")
      return
    }
    complete(anchor, rect, element)
  }

  function cancel(event?: Event) {
    finishSelection()
    post(origin, {
      type: "replica:canvas:selection-cancelled",
      nonce,
      reason: event ? "interrupted" : "escape",
    })
  }

  function keydown(event: KeyboardEvent) {
    if (allowElement && event.shiftKey && event.key === "Enter") {
      event.preventDefault()
      keyboardPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      start = null
      overlay.style.display = "block"
      positionOverlay(overlay, new DOMRect(keyboardPoint.x, keyboardPoint.y, 4, 4))
      return
    }
    if (
      keyboardPoint &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)
    ) {
      event.preventDefault()
      if (event.key === "Enter" || event.key === " ") {
        if (!start) {
          start = { ...keyboardPoint }
        } else {
          const rect = new DOMRect(
            Math.min(start.x, keyboardPoint.x),
            Math.min(start.y, keyboardPoint.y),
            Math.abs(start.x - keyboardPoint.x),
            Math.abs(start.y - keyboardPoint.y),
          )
          if (rect.width < 8 || rect.height < 8) {
            failSelection(origin, nonce, "area-too-small")
            return
          }
          complete(areaAnchor(rect), rect)
        }
      } else {
        keyboardPoint = {
          x: Math.max(
            0,
            Math.min(
              window.innerWidth,
              keyboardPoint.x +
                (event.key === "ArrowRight" ? 10 : event.key === "ArrowLeft" ? -10 : 0),
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              window.innerHeight,
              keyboardPoint.y +
                (event.key === "ArrowDown" ? 10 : event.key === "ArrowUp" ? -10 : 0),
            ),
          ),
        }
        if (start) update(keyboardPoint.x, keyboardPoint.y)
        else positionOverlay(overlay, new DOMRect(keyboardPoint.x, keyboardPoint.y, 4, 4))
      }
      return
    }
    if (event.key !== "Escape") return
    event.preventDefault()
    cancel()
  }

  surface.addEventListener("pointerdown", pointerDown)
  surface.addEventListener("pointermove", pointerMove)
  surface.addEventListener("pointerup", pointerUp)
  surface.addEventListener("pointercancel", cancel)
  surface.addEventListener("lostpointercapture", cancel)
  if (allowElement) document.addEventListener("click", keyboardClick, true)
  document.addEventListener("keydown", keydown, true)
  cleanupActiveSelection = () => {
    surface.removeEventListener("pointerdown", pointerDown)
    surface.removeEventListener("pointermove", pointerMove)
    surface.removeEventListener("pointerup", pointerUp)
    surface.removeEventListener("pointercancel", cancel)
    surface.removeEventListener("lostpointercapture", cancel)
    if (allowElement) document.removeEventListener("click", keyboardClick, true)
    document.removeEventListener("keydown", keydown, true)
    surface.remove()
    if (selectedOverlay !== overlay) overlay.remove()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isViewportAnchoredElement(element: Element) {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const position = window.getComputedStyle(current).position
    if (position === "fixed" || position === "sticky") return true
  }
  return false
}

function resolveAnchor(anchor: unknown) {
  const route = currentRoute()
  if (
    !isRecord(anchor) ||
    !isRecord(anchor.route) ||
    anchor.route.pathname !== route.pathname ||
    anchor.route.search !== route.search ||
    anchor.route.hash !== route.hash
  ) {
    return null
  }
  if (anchor.kind === "area") {
    if (
      !isRecord(anchor.rect) ||
      typeof anchor.rect.x !== "number" ||
      typeof anchor.rect.y !== "number" ||
      typeof anchor.rect.width !== "number" ||
      typeof anchor.rect.height !== "number" ||
      !Object.values(anchor.rect).every(Number.isFinite)
    )
      return null
    const rect = {
      x: anchor.rect.x - window.scrollX,
      y: anchor.rect.y - window.scrollY,
      width: anchor.rect.width,
      height: anchor.rect.height,
    }
    return {
      x: rect.x + rect.width,
      y: rect.y,
      rect,
      viewportAnchored: false,
    }
  }
  if (
    anchor.kind !== "element" ||
    typeof anchor.selector !== "string" ||
    typeof anchor.accessibleName !== "string" ||
    typeof anchor.tagName !== "string" ||
    (anchor.selectedText !== undefined && typeof anchor.selectedText !== "string") ||
    !isRecord(anchor.elementOffset) ||
    typeof anchor.elementOffset.x !== "number" ||
    typeof anchor.elementOffset.y !== "number" ||
    !Number.isFinite(anchor.elementOffset.x) ||
    !Number.isFinite(anchor.elementOffset.y)
  )
    return null
  const element = findElement({
    selector: anchor.selector,
    accessibleName: anchor.accessibleName,
    tagName: anchor.tagName,
    selectedText: anchor.selectedText,
  })
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return {
    x: rect.left + rect.width * anchor.elementOffset.x,
    y: rect.top + rect.height * anchor.elementOffset.y,
    viewportAnchored: isViewportAnchoredElement(element),
  }
}

function sendResolvedGeometry(documentScroll = false) {
  if (!resolvedRequest || !parentOrigin) return
  const route = currentRoute()
  const routeKey = JSON.stringify(route)
  documentScroll = documentScroll && routeKey === resolvedRoute
  resolvedRoute = routeKey
  const results = []
  for (const entry of resolvedRequest.anchors) {
    const cached = resolvedGeometry.get(entry.id)
    let point
    if (documentScroll && cached && !cached.viewportAnchored) {
      const dx = cached.scrollX - window.scrollX
      const dy = cached.scrollY - window.scrollY
      point = {
        x: cached.x + dx,
        y: cached.y + dy,
        ...(cached.rect
          ? { rect: { ...cached.rect, x: cached.rect.x + dx, y: cached.rect.y + dy } }
          : {}),
      }
    } else {
      const resolved = resolveAnchor(entry.anchor)
      if (!resolved) {
        resolvedGeometry.delete(entry.id)
        continue
      }
      resolvedGeometry.set(entry.id, {
        ...resolved,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      })
      point = {
        x: resolved.x,
        y: resolved.y,
        ...("rect" in resolved ? { rect: resolved.rect } : {}),
      }
    }
    results.push({ id: entry.id, ...point })
  }
  post(parentOrigin, {
    type: "replica:canvas:resolved",
    protocolVersion: 1,
    nonce: resolvedRequest.nonce,
    route,
    ...(inPlaceRoute === routeAddress() ? { replaceRoute: true } : {}),
    results,
  })
}

function receiveCanvasMessage(event: MessageEvent<unknown>) {
  const data = event.data
  if (
    document.querySelector('script[src="/__replica/bridge/v1.js"]') ||
    event.source !== window.parent ||
    event.origin !== parentOrigin ||
    !isRecord(data) ||
    typeof data.nonce !== "string" ||
    data.nonce.length > 100
  ) {
    return
  }

  if (data.type === "replica:canvas:request-ready") {
    if (data.selectionShortcut === true) selectionShortcutNonce = data.nonce
    else if (data.selectionShortcut === false && selectionShortcutNonce === data.nonce)
      selectionShortcutNonce = null
    post(event.origin, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      nonce: data.nonce,
      route: currentRoute(),
      ...(inPlaceRoute === routeAddress() ? { replaceRoute: true } : {}),
    })
    return
  }

  if (data.type === "replica:canvas:theme") {
    if (
      typeof data.accent !== "string" ||
      data.accent.length > 200 ||
      !CSS.supports("color", data.accent)
    )
      return
    selectionAccent = data.accent
    for (const overlay of document.querySelectorAll<HTMLElement>(`[${BRIDGE_ATTRIBUTE}]`)) {
      overlay.style.setProperty("--replica-selection-accent", selectionAccent)
    }
    return
  }

  if (data.type === "replica:canvas:click") {
    const { selector, expectedLabel, route } = data
    const current = currentRoute()
    let error = "The click target is unavailable or ambiguous."
    let target: Element | null = null
    if (
      typeof selector === "string" &&
      selector.length > 0 &&
      selector.length <= 512 &&
      typeof expectedLabel === "string" &&
      expectedLabel.length > 0 &&
      expectedLabel.length <= 200 &&
      isRecord(route) &&
      typeof route.pathname === "string" &&
      route.pathname === current.pathname &&
      route.search === current.search &&
      route.hash === current.hash
    ) {
      try {
        const matches = document.querySelectorAll(selector)
        if (matches.length === 1) target = matches.item(0)
      } catch {
        error = "The click selector is invalid."
      }
    } else {
      error = "The prototype route changed or the click input is invalid."
    }
    if (target) {
      const element = target as HTMLElement
      if (
        targetIssue(element, true) ||
        (accessibleName(element) || normalizeText(element.textContent || "").slice(0, 200)) !==
          expectedLabel
      ) {
        error = "The target is hidden, blocked, disabled, unsafe, or its accessible name changed."
      } else {
        element.click()
        post(event.origin, {
          type: "replica:canvas:click-result",
          nonce: data.nonce,
          clicked: true,
        })
        return
      }
    }
    post(event.origin, {
      type: "replica:canvas:click-result",
      nonce: data.nonce,
      clicked: false,
      error,
    })
    return
  }

  if (data.type === "replica:canvas:select") {
    if (data.mode === "element") startElementSelection(event.origin, data.nonce)
    else if (data.mode === "area") startAreaSelection(event.origin, data.nonce)
    else if (data.mode === "improvement") startAreaSelection(event.origin, data.nonce, true)
    return
  }

  if (data.type === "replica:canvas:cancel-selection") {
    finishSelection()
    post(event.origin, {
      type: "replica:canvas:selection-cancelled",
      nonce: data.nonce,
      reason: "command",
    })
    return
  }

  if (data.type === "replica:canvas:clear-selection") {
    selectedOverlay?.remove()
    selectedOverlay = null
    selectedOverlayTarget = null
    return
  }

  if (data.type !== "replica:canvas:resolve" || !Array.isArray(data.anchors)) {
    return
  }

  const references: { id: number; anchor: unknown }[] = []
  const anchors: unknown[] = data.anchors
  for (const entry of anchors) {
    if (!isRecord(entry) || typeof entry.id !== "number" || !Number.isSafeInteger(entry.id))
      continue
    references.push({ id: entry.id, anchor: entry.anchor })
  }
  resolvedRequest = { nonce: data.nonce, anchors: references }
  resolvedGeometry.clear()
  sendResolvedGeometry()
}

const installed = Symbol.for("replica.canvas.bridge.v1")
const bridgeWindow = window as Window & { [installed]?: boolean | (() => void) }

export function installBridge(origin: string) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Invalid Replica canvas parent.")
  const previous = bridgeWindow[installed]
  if (previous === true)
    throw new Error("Remove the old source bridge before using the extension-owned bridge.")
  if (typeof previous === "function") previous()
  selectionAccent = "light-dark(#0969da, #58a6ff)"
  parentOrigin = origin
  selectionShortcutNonce = null
  resolvedRequest = null
  resolvedRoute = ""
  resolvedGeometry.clear()
  const releaseControls = installControlsBridge(origin)
  let geometryFrame: number | null = null
  function refreshGeometry() {
    if (geometryFrame !== null) window.cancelAnimationFrame(geometryFrame)
    geometryFrame = null
    if (selectedOverlay && selectedOverlayTarget) {
      selectedOverlay.style.position = isViewportAnchoredElement(selectedOverlayTarget)
        ? "fixed"
        : "absolute"
      positionOverlay(selectedOverlay, selectedOverlayTarget.getBoundingClientRect())
    }
    sendResolvedGeometry()
  }
  function scheduleGeometry() {
    if (geometryFrame !== null || !resolvedRequest) return
    geometryFrame = window.requestAnimationFrame(refreshGeometry)
  }
  function handleScroll(event: Event) {
    if (
      selectedOverlay &&
      selectedOverlayTarget &&
      ((event.target !== document && event.target !== window) ||
        isViewportAnchoredElement(selectedOverlayTarget))
    ) {
      positionOverlay(selectedOverlay, selectedOverlayTarget.getBoundingClientRect())
    }
    if (geometryFrame !== null) refreshGeometry()
    else sendResolvedGeometry(event.target === document || event.target === window)
  }
  function handleResize() {
    sendResolvedGeometry()
  }
  function handleEscape(event: KeyboardEvent) {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.isComposing ||
      cleanupActiveSelection ||
      !resolvedRequest ||
      (event.target instanceof Element &&
        event.target.closest('[role="dialog"], dialog, [role="menu"]'))
    )
      return
    const request = resolvedRequest
    window.setTimeout(() => {
      if (event.defaultPrevented || cleanupActiveSelection || resolvedRequest !== request) return

      post(origin, {
        type: "replica:canvas:conversation-dismiss-requested",
        nonce: request.nonce,
      })
    }, 0)
  }
  function handlePointerDown(event: PointerEvent) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.isPrimary === false ||
      cleanupActiveSelection ||
      !resolvedRequest
    )
      return
    post(origin, {
      type: "replica:canvas:conversation-dismiss-requested",
      nonce: resolvedRequest.nonce,
      restoreFocus: false,
    })
  }
  function handleSelectionShortcut(event: KeyboardEvent) {
    if (!selectionShortcutNonce || !isAnnotationShortcut(event)) return
    event.preventDefault()
    post(origin, {
      type: "replica:canvas:selection-toggle-requested",
      nonce: selectionShortcutNonce,
    })
  }
  window.addEventListener("message", receiveCanvasMessage)
  window.addEventListener("scroll", handleScroll, { capture: true, passive: true })
  window.addEventListener("resize", handleResize)
  window.addEventListener("keydown", handleEscape)
  window.addEventListener("keydown", handleSelectionShortcut)
  window.addEventListener("pointerdown", handlePointerDown, true)
  const mutations = new MutationObserver((entries) => {
    if (
      entries.some(
        (entry) =>
          !(
            entry.target instanceof Element &&
            entry.target.closest(`[${BRIDGE_ATTRIBUTE}], [data-replica-controls-bridge]`)
          ),
      )
    )
      scheduleGeometry()
  })
  mutations.observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  })
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleGeometry) : null
  resize?.observe(document.documentElement)
  bridgeWindow[installed] = () => {
    window.removeEventListener("message", receiveCanvasMessage)
    window.removeEventListener("scroll", handleScroll, true)
    window.removeEventListener("resize", handleResize)
    window.removeEventListener("keydown", handleEscape)
    window.removeEventListener("keydown", handleSelectionShortcut)
    window.removeEventListener("pointerdown", handlePointerDown, true)
    selectionShortcutNonce = null
    mutations.disconnect()
    resize?.disconnect()
    if (geometryFrame !== null) window.cancelAnimationFrame(geometryFrame)
    resolvedRequest = null
    resolvedRoute = ""
    resolvedGeometry.clear()
    releaseControls()
    finishSelection()
    selectedOverlay?.remove()
    selectedOverlay = null
    selectedOverlayTarget = null
  }
}
