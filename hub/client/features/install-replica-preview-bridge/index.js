;(function installReplicaPreviewBridge() {
  "use strict"

  // Preview hosts serve this script directly, so it cannot import Vite modules.
  const HUB_ORIGIN = "__REPLICA_HUB_ORIGIN__"
  const REVIEW_ENABLED = "__REPLICA_REVIEW_ENABLED__" !== "false"
  const PROTOCOL_VERSION = 1
  const ANCHOR_SCHEMA_VERSION = 1
  const REQUEST_ID_MAXIMUM_BYTES = 128
  const ANCHORS_PER_MESSAGE = 200
  const ANCHOR_MAXIMUM_BYTES = 16_384
  const PATHNAME_MAXIMUM_BYTES = 2_048
  const SEARCH_MAXIMUM_BYTES = 2_048
  const HASH_MAXIMUM_BYTES = 1_024
  const SELECTOR_MAXIMUM_BYTES = 4_096
  const ACCESSIBLE_NAME_MAXIMUM_BYTES = 1_000
  const TAG_NAME_MAXIMUM_BYTES = 64
  const SELECTED_TEXT_MAXIMUM_BYTES = 2_000
  const AREA_ROLE_MAXIMUM_BYTES = 64
  const AREA_TEXT_EXCERPT_MAXIMUM_BYTES = 500
  const AREA_PATH_MAXIMUM_POINTS = 160
  const AREA_ELEMENTS_MAXIMUM = 8
  const AREA_MINIMUM_DIAGONAL = 8
  const AREA_SAMPLE_GRID = 6
  const AREA_GEOMETRY_TOLERANCE = 0.15
  const GEOMETRY_ABSOLUTE_MAXIMUM = 1_000_000
  const VIEWPORT_DIMENSION_MAXIMUM = 100_000
  const HIGHLIGHT_FADE_MILLISECONDS = 200
  const BRIDGE_NODE_ATTRIBUTE = "data-replica-bridge"
  const textEncoder = new TextEncoder()
  const nativeReplaceState = History.prototype.replaceState

  let selectionMode = null
  let selectionRequestId = null
  let drawingPointerId = null
  let shapeOptimizing = false
  let areaStroke = []
  let selectionPending = false
  let pendingAreaAnchor = null
  let highlightedElement = null
  let highlightElement = null
  let areaHighlightElement = null
  let areaHighlightPath = null
  let originalCursor = ""
  let originalTouchAction = ""
  let focusTimer = null
  let geometryFrame = null
  let pendingFragmentRoute = null
  let fragmentRestoreToken = null
  const anchors = new Map()
  const geometry = new Map()

  function isViewportAnchoredElement(element) {
    for (let current = element; current; current = current.parentElement) {
      const position = window.getComputedStyle(current).position
      if (position === "fixed" || position === "sticky") return true
    }
    return false
  }

  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  function hasExactKeys(value, expected) {
    const actual = Object.keys(value)
    return actual.length === expected.length && expected.every((key) => actual.includes(key))
  }

  function byteLength(value) {
    return textEncoder.encode(value).length
  }

  function isBoundedString(value, maximumBytes, options = {}) {
    if (typeof value !== "string" || byteLength(value) > maximumBytes) return false
    if (options.required && value.trim() === "") return false
    if (options.prefix && value !== "" && !value.startsWith(options.prefix)) return false
    return true
  }

  function isFiniteNumber(value, minimum, maximum) {
    return (
      typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    )
  }

  function isRoute(value) {
    return (
      isObject(value) &&
      hasExactKeys(value, ["pathname", "search", "hash"]) &&
      isBoundedString(value.pathname, PATHNAME_MAXIMUM_BYTES, {
        required: true,
        prefix: "/",
      }) &&
      isBoundedString(value.search, SEARCH_MAXIMUM_BYTES, { prefix: "?" }) &&
      isBoundedString(value.hash, HASH_MAXIMUM_BYTES, { prefix: "#" })
    )
  }

  function isRect(value, allowNegativePosition) {
    const minimumPosition = allowNegativePosition ? -GEOMETRY_ABSOLUTE_MAXIMUM : 0
    return (
      isObject(value) &&
      hasExactKeys(value, ["x", "y", "width", "height"]) &&
      isFiniteNumber(value.x, minimumPosition, GEOMETRY_ABSOLUTE_MAXIMUM) &&
      isFiniteNumber(value.y, minimumPosition, GEOMETRY_ABSOLUTE_MAXIMUM) &&
      isFiniteNumber(value.width, 0, GEOMETRY_ABSOLUTE_MAXIMUM) &&
      isFiniteNumber(value.height, 0, GEOMETRY_ABSOLUTE_MAXIMUM)
    )
  }

  function isViewport(value) {
    return (
      isObject(value) &&
      hasExactKeys(value, ["width", "height", "scrollX", "scrollY"]) &&
      isFiniteNumber(value.width, 1, VIEWPORT_DIMENSION_MAXIMUM) &&
      isFiniteNumber(value.height, 1, VIEWPORT_DIMENSION_MAXIMUM) &&
      isFiniteNumber(value.scrollX, 0, GEOMETRY_ABSOLUTE_MAXIMUM) &&
      isFiniteNumber(value.scrollY, 0, GEOMETRY_ABSOLUTE_MAXIMUM)
    )
  }

  function isNormalizedPoint(value) {
    return (
      isObject(value) &&
      hasExactKeys(value, ["x", "y"]) &&
      isFiniteNumber(value.x, 0, 1) &&
      isFiniteNumber(value.y, 0, 1)
    )
  }

  function hasValidSerializedSize(value) {
    try {
      return byteLength(JSON.stringify(value)) <= ANCHOR_MAXIMUM_BYTES
    } catch {
      return false
    }
  }

  function isElementAnchor(value) {
    if (
      !isObject(value) ||
      !hasExactKeys(value, [
        "schemaVersion",
        "kind",
        "route",
        "selector",
        "accessibleName",
        "tagName",
        "selectedText",
        "rect",
        "viewport",
        "elementOffset",
      ])
    ) {
      return false
    }

    return (
      value.schemaVersion === ANCHOR_SCHEMA_VERSION &&
      value.kind === "element" &&
      isRoute(value.route) &&
      isBoundedString(value.selector, SELECTOR_MAXIMUM_BYTES, { required: true }) &&
      isBoundedString(value.accessibleName, ACCESSIBLE_NAME_MAXIMUM_BYTES) &&
      isBoundedString(value.tagName, TAG_NAME_MAXIMUM_BYTES, { required: true }) &&
      /^[a-z][a-z0-9-]*$/.test(value.tagName) &&
      isBoundedString(value.selectedText, SELECTED_TEXT_MAXIMUM_BYTES) &&
      isRect(value.rect, false) &&
      isViewport(value.viewport) &&
      isNormalizedPoint(value.elementOffset) &&
      hasValidSerializedSize(value)
    )
  }

  function isAreaElement(value) {
    return (
      isObject(value) &&
      hasExactKeys(value, [
        "selector",
        "accessibleName",
        "tagName",
        "role",
        "textExcerpt",
        "rect",
      ]) &&
      isBoundedString(value.selector, SELECTOR_MAXIMUM_BYTES, { required: true }) &&
      isBoundedString(value.accessibleName, ACCESSIBLE_NAME_MAXIMUM_BYTES) &&
      isBoundedString(value.tagName, TAG_NAME_MAXIMUM_BYTES, { required: true }) &&
      /^[a-z][a-z0-9-]*$/.test(value.tagName) &&
      isBoundedString(value.role, AREA_ROLE_MAXIMUM_BYTES) &&
      isBoundedString(value.textExcerpt, AREA_TEXT_EXCERPT_MAXIMUM_BYTES) &&
      isRect(value.rect, false)
    )
  }

  function isAreaAnchor(value) {
    return (
      isObject(value) &&
      hasExactKeys(value, [
        "schemaVersion",
        "kind",
        "route",
        "path",
        "rect",
        "viewport",
        "elements",
      ]) &&
      value.schemaVersion === ANCHOR_SCHEMA_VERSION &&
      value.kind === "area" &&
      isRoute(value.route) &&
      Array.isArray(value.path) &&
      value.path.length >= 2 &&
      value.path.length <= AREA_PATH_MAXIMUM_POINTS &&
      value.path.every(isNormalizedPoint) &&
      isRect(value.rect, false) &&
      Math.hypot(value.rect.width, value.rect.height) >= AREA_MINIMUM_DIAGONAL &&
      isViewport(value.viewport) &&
      Array.isArray(value.elements) &&
      value.elements.length <= AREA_ELEMENTS_MAXIMUM &&
      value.elements.every(isAreaElement) &&
      hasValidSerializedSize(value)
    )
  }

  function isAnchor(value) {
    return isElementAnchor(value) || isAreaAnchor(value)
  }

  function isCommand(message) {
    if (
      !isObject(message) ||
      !hasExactKeys(message, ["protocolVersion", "requestId", "type", "payload"]) ||
      message.protocolVersion !== PROTOCOL_VERSION ||
      !isBoundedString(message.requestId, REQUEST_ID_MAXIMUM_BYTES, { required: true }) ||
      typeof message.type !== "string" ||
      !isObject(message.payload)
    ) {
      return false
    }

    if (
      message.type === "replica:bridge:request-ready" ||
      message.type === "replica:bridge:select-element" ||
      message.type === "replica:bridge:select-area" ||
      message.type === "replica:bridge:cancel-selection" ||
      message.type === "replica:bridge:clear-selection"
    ) {
      return hasExactKeys(message.payload, [])
    }

    if (message.type === "replica:bridge:focus-anchor") {
      return (
        hasExactKeys(message.payload, ["commentId"]) &&
        Number.isSafeInteger(message.payload.commentId) &&
        message.payload.commentId > 0
      )
    }

    if (message.type === "replica:bridge:set-theme") {
      return (
        hasExactKeys(message.payload, ["theme"]) &&
        (message.payload.theme === "light" || message.payload.theme === "dark")
      )
    }

    if (message.type === "replica:bridge:restore-fragment") {
      return (
        hasExactKeys(message.payload, ["route"]) &&
        isRoute(message.payload.route) &&
        message.payload.route.hash.length > 1 &&
        !message.payload.route.hash.startsWith("#/") &&
        !message.payload.route.hash.startsWith("#!") &&
        new URL(message.payload.route.hash, location.href).hash === message.payload.route.hash
      )
    }

    if (message.type === "replica:bridge:resolve-anchors") {
      if (
        !hasExactKeys(message.payload, ["replace", "anchors"]) ||
        typeof message.payload.replace !== "boolean" ||
        !Array.isArray(message.payload.anchors) ||
        message.payload.anchors.length > ANCHORS_PER_MESSAGE
      ) {
        return false
      }

      return message.payload.anchors.every(
        (entry) =>
          isObject(entry) &&
          hasExactKeys(entry, ["commentId", "originBuild", "anchor"]) &&
          Number.isSafeInteger(entry.commentId) &&
          entry.commentId > 0 &&
          typeof entry.originBuild === "boolean" &&
          isAnchor(entry.anchor),
      )
    }

    return false
  }

  function createRequestId() {
    return crypto.randomUUID()
  }

  function currentRoute() {
    return {
      pathname: truncate(location.pathname, PATHNAME_MAXIMUM_BYTES),
      search: truncate(controlFreeSearch(), SEARCH_MAXIMUM_BYTES),
      hash: truncate(location.hash, HASH_MAXIMUM_BYTES),
    }
  }

  function controlFreeSearch() {
    const search = location.search
      .slice(1)
      .split("&")
      .filter((part) => {
        const key = new URLSearchParams(part).keys().next().value
        return key !== "rc" && !key?.startsWith("rc.")
      })
      .join("&")
    return search ? `?${search}` : ""
  }

  function post(type, requestId, payload) {
    window.parent.postMessage(
      { protocolVersion: PROTOCOL_VERSION, requestId, type, payload },
      HUB_ORIGIN,
    )
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim()
  }

  function truncate(value, maximumBytes) {
    let result = ""
    for (const character of value) {
      if (byteLength(result + character) > maximumBytes) break
      result += character
    }
    return result
  }

  function accessibleName(element) {
    const labelledBy = element.getAttribute("aria-labelledby")
    const labelledText = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || "")
          .join(" ")
      : ""
    const labels =
      "labels" in element && element.labels
        ? Array.from(element.labels)
            .map((label) => label.textContent || "")
            .join(" ")
        : ""
    const value =
      element.getAttribute("aria-label") ||
      labelledText ||
      labels ||
      element.getAttribute("alt") ||
      element.getAttribute("title") ||
      ""
    return truncate(normalizeText(value), ACCESSIBLE_NAME_MAXIMUM_BYTES)
  }

  function selectedText(element) {
    const selection = window.getSelection()
    const anchorNode = selection?.anchorNode
    const focusNode = selection?.focusNode
    if (
      !selection ||
      selection.isCollapsed ||
      !anchorNode ||
      !focusNode ||
      !element.contains(anchorNode) ||
      !element.contains(focusNode)
    )
      return ""
    return truncate(normalizeText(selection.toString()), SELECTED_TEXT_MAXIMUM_BYTES)
  }

  function textExcerpt(element) {
    return truncate(normalizeText(element.textContent || ""), AREA_TEXT_EXCERPT_MAXIMUM_BYTES)
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(value, maximum))
  }

  function capturedViewport() {
    return {
      width: clamp(window.innerWidth, 1, VIEWPORT_DIMENSION_MAXIMUM),
      height: clamp(window.innerHeight, 1, VIEWPORT_DIMENSION_MAXIMUM),
      scrollX: clamp(window.scrollX, 0, GEOMETRY_ABSOLUTE_MAXIMUM),
      scrollY: clamp(window.scrollY, 0, GEOMETRY_ABSOLUTE_MAXIMUM),
    }
  }

  function documentRectangle(element) {
    const rect = element.getBoundingClientRect()
    const x = clamp(rect.left + window.scrollX, 0, GEOMETRY_ABSOLUTE_MAXIMUM)
    const y = clamp(rect.top + window.scrollY, 0, GEOMETRY_ABSOLUTE_MAXIMUM)
    return {
      x,
      y,
      width: clamp(rect.width, 0, GEOMETRY_ABSOLUTE_MAXIMUM - x),
      height: clamp(rect.height, 0, GEOMETRY_ABSOLUTE_MAXIMUM - y),
    }
  }

  function escapedIdentifier(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value)
    return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
  }

  function escapedAttribute(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  }

  function isUniqueSelector(selector, element) {
    try {
      const matches = document.querySelectorAll(selector)
      return matches.length === 1 && matches[0] === element
    } catch {
      return false
    }
  }

  function selectorFor(element) {
    if (element.id) {
      const selector = `#${escapedIdentifier(element.id)}`
      if (isUniqueSelector(selector, element)) return selector
    }

    for (const attribute of ["data-testid", "data-test-id", "data-component"]) {
      const value = element.getAttribute(attribute)
      if (!value || byteLength(value) > 512) continue
      const selector = `${element.tagName.toLowerCase()}[${attribute}="${escapedAttribute(value)}"]`
      if (isUniqueSelector(selector, element)) return selector
    }

    const parts = []
    let current = element
    while (current instanceof Element) {
      const tagName = current.tagName.toLowerCase()
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter(
            (sibling) => sibling.tagName === current.tagName,
          )
        : []
      const position = siblings.indexOf(current)
      parts.unshift(
        siblings.length > 1 && position >= 0 ? `${tagName}:nth-of-type(${position + 1})` : tagName,
      )
      const selector = parts.join(" > ")
      if (byteLength(selector) > SELECTOR_MAXIMUM_BYTES) return null
      if (isUniqueSelector(selector, element)) return selector
      current = current.parentElement
    }
    return null
  }

  function capturedAnchor(element, event) {
    const selector = selectorFor(element)
    if (!selector) return null

    const rect = element.getBoundingClientRect()
    const width = Math.max(0, Math.min(rect.width, GEOMETRY_ABSOLUTE_MAXIMUM))
    const height = Math.max(0, Math.min(rect.height, GEOMETRY_ABSOLUTE_MAXIMUM))
    const offsetX = width > 0 ? (event.clientX - rect.left) / width : 0.5
    const offsetY = height > 0 ? (event.clientY - rect.top) / height : 0.5
    return {
      schemaVersion: ANCHOR_SCHEMA_VERSION,
      kind: "element",
      route: currentRoute(),
      selector,
      accessibleName: accessibleName(element),
      tagName: element.tagName.toLowerCase(),
      selectedText: selectedText(element),
      rect: {
        x: Math.max(0, Math.min(rect.left + window.scrollX, GEOMETRY_ABSOLUTE_MAXIMUM)),
        y: Math.max(0, Math.min(rect.top + window.scrollY, GEOMETRY_ABSOLUTE_MAXIMUM)),
        width,
        height,
      },
      viewport: capturedViewport(),
      elementOffset: {
        x: Math.max(0, Math.min(offsetX, 1)),
        y: Math.max(0, Math.min(offsetY, 1)),
      },
    }
  }

  function pointDistance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y)
  }

  function pathBounds(points) {
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
      diagonal: Math.hypot(right - left, bottom - top),
    }
  }

  function pointToSegmentDistance(point, start, end) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return pointDistance(point, start)

    const projection = clamp(
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
      0,
      1,
    )
    return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy))
  }

  function pathScore(points, candidate, normalizer) {
    const squaredErrors = points.map((point) => {
      let nearest = Number.POSITIVE_INFINITY
      for (let index = 1; index < candidate.length; index += 1) {
        nearest = Math.min(
          nearest,
          pointToSegmentDistance(point, candidate[index - 1], candidate[index]),
        )
      }
      return nearest * nearest
    })
    return (
      Math.sqrt(squaredErrors.reduce((sum, error) => sum + error, 0) / squaredErrors.length) /
      normalizer
    )
  }

  function rectanglePath(bounds, square) {
    const centerX = (bounds.left + bounds.right) / 2
    const centerY = (bounds.top + bounds.bottom) / 2
    const halfWidth = square ? (bounds.width + bounds.height) / 4 : bounds.width / 2
    const halfHeight = square ? halfWidth : bounds.height / 2
    const left = centerX - halfWidth
    const right = centerX + halfWidth
    const top = centerY - halfHeight
    const bottom = centerY + halfHeight
    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
      { x: left, y: top },
    ]
  }

  function ellipsePath(bounds, circle) {
    const centerX = (bounds.left + bounds.right) / 2
    const centerY = (bounds.top + bounds.bottom) / 2
    const radiusX = circle ? (bounds.width + bounds.height) / 4 : bounds.width / 2
    const radiusY = circle ? radiusX : bounds.height / 2
    return Array.from({ length: 49 }, (_, index) => {
      const angle = (index / 48) * Math.PI * 2
      return {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      }
    })
  }

  function optimizedStroke(points) {
    if (points.length < 2) return points

    const bounds = pathBounds(points)
    if (bounds.diagonal < 16) return points

    const first = points[0]
    const last = points[points.length - 1]
    const closureRatio = pointDistance(first, last) / bounds.diagonal
    if (closureRatio > 0.25 || points.length < 8) {
      const line = [first, last]
      return pathScore(points, line, bounds.diagonal) <= 0.08 ? line : points
    }

    const candidates = [
      rectanglePath(bounds, false),
      rectanglePath(bounds, true),
      ellipsePath(bounds, false),
      ellipsePath(bounds, true),
    ].map((path) => ({ path, score: pathScore(points, path, bounds.diagonal) }))
    const best = candidates.reduce((current, candidate) =>
      candidate.score < current.score ? candidate : current,
    )
    return best.score <= 0.1 ? best.path : points
  }

  function downsamplePath(points, maximum) {
    if (points.length <= maximum) return points

    return Array.from({ length: maximum }, (_, index) => {
      const sourceIndex = Math.round((index / (maximum - 1)) * (points.length - 1))
      return points[sourceIndex]
    })
  }

  function areaElementContext(element) {
    const selector = selectorFor(element)
    if (!selector) return null

    return {
      selector,
      accessibleName: accessibleName(element),
      tagName: element.tagName.toLowerCase(),
      role: truncate(element.getAttribute("role") || "", AREA_ROLE_MAXIMUM_BYTES),
      textExcerpt: textExcerpt(element),
      rect: documentRectangle(element),
    }
  }

  function captureAreaElements(bounds) {
    const found = new Map()
    for (
      let column = 0;
      column < AREA_SAMPLE_GRID && found.size < AREA_ELEMENTS_MAXIMUM;
      column += 1
    ) {
      for (let row = 0; row < AREA_SAMPLE_GRID && found.size < AREA_ELEMENTS_MAXIMUM; row += 1) {
        const x = bounds.left + (bounds.width * (column + 0.5)) / AREA_SAMPLE_GRID
        const y = bounds.top + (bounds.height * (row + 0.5)) / AREA_SAMPLE_GRID
        const element = document
          .elementsFromPoint(x, y)
          .find(
            (candidate) =>
              candidate !== document.documentElement &&
              candidate !== document.body &&
              !candidate.closest(`[${BRIDGE_NODE_ATTRIBUTE}]`),
          )
        if (!element) continue

        const context = areaElementContext(element)
        if (context && !found.has(context.selector))
          found.set(context.selector, { context, element })
      }
    }

    const entries = Array.from(found.values())
    return entries
      .filter(
        (entry) =>
          !entries.some(
            (candidate) => candidate !== entry && entry.element.contains(candidate.element),
          ),
      )
      .slice(0, AREA_ELEMENTS_MAXIMUM)
      .map((entry) => entry.context)
  }

  function normalizedAreaPath(points, bounds) {
    return points.map((point) => ({
      x: bounds.width > 0 ? clamp((point.x - bounds.left) / bounds.width, 0, 1) : 0.5,
      y: bounds.height > 0 ? clamp((point.y - bounds.top) / bounds.height, 0, 1) : 0.5,
    }))
  }

  function capturedAreaAnchor(clientPoints, optimize) {
    let points = optimize ? optimizedStroke(clientPoints) : clientPoints
    points = downsamplePath(points, AREA_PATH_MAXIMUM_POINTS)
    const bounds = pathBounds(points)
    if (bounds.diagonal < AREA_MINIMUM_DIAGONAL) return { reason: "area-too-small" }

    const left = clamp(bounds.left + window.scrollX, 0, GEOMETRY_ABSOLUTE_MAXIMUM)
    const top = clamp(bounds.top + window.scrollY, 0, GEOMETRY_ABSOLUTE_MAXIMUM)
    const right = clamp(bounds.right + window.scrollX, left, GEOMETRY_ABSOLUTE_MAXIMUM)
    const bottom = clamp(bounds.bottom + window.scrollY, top, GEOMETRY_ABSOLUTE_MAXIMUM)
    const anchor = {
      schemaVersion: ANCHOR_SCHEMA_VERSION,
      kind: "area",
      route: currentRoute(),
      path: normalizedAreaPath(points, bounds),
      rect: { x: left, y: top, width: right - left, height: bottom - top },
      viewport: capturedViewport(),
      elements: captureAreaElements(bounds),
    }

    while (!isAreaAnchor(anchor) && anchor.elements.length > 0) anchor.elements.pop()
    while (!isAreaAnchor(anchor) && anchor.path.length > 2) {
      anchor.path = downsamplePath(anchor.path, Math.max(2, Math.floor(anchor.path.length / 2)))
    }
    return isAreaAnchor(anchor) ? { anchor } : { reason: "area-unavailable" }
  }

  function routeMatches(route) {
    const current = currentRoute()
    return (
      route.pathname === current.pathname &&
      route.search === current.search &&
      route.hash === current.hash
    )
  }

  function querySelectorElement(selector) {
    try {
      return document.querySelector(selector)
    } catch {
      return null
    }
  }

  function savedContextText(context) {
    return "selectedText" in context ? context.selectedText : context.textExcerpt
  }

  function elementMatchesContext(element, context) {
    if (element.tagName.toLowerCase() !== context.tagName) return false
    if (context.accessibleName && accessibleName(element) !== context.accessibleName) return false
    if ("role" in context && context.role && element.getAttribute("role") !== context.role)
      return false

    const savedText = savedContextText(context)
    return !savedText || normalizeText(element.textContent || "").includes(savedText)
  }

  function uniqueContextElement(context, excludedElement) {
    const savedText = savedContextText(context)
    if (!context.accessibleName && !savedText) return null

    let match = null
    for (const element of document.getElementsByTagName(context.tagName)) {
      if (
        element === excludedElement ||
        element.closest(`[${BRIDGE_NODE_ATTRIBUTE}]`) ||
        !elementMatchesContext(element, context)
      ) {
        continue
      }
      if (match) return null

      match = element
    }
    return match
  }

  function resolvedElementContext(context) {
    const selected = querySelectorElement(context.selector)
    if (selected && elementMatchesContext(selected, context)) {
      return { status: "resolved", element: selected }
    }

    const moved = uniqueContextElement(context, selected)
    if (moved) return { status: "moved", element: moved }
    return { status: selected ? "changed" : "missing" }
  }

  function viewportRectangle(element) {
    const rect = element.getBoundingClientRect()
    return {
      x: clamp(rect.left, -GEOMETRY_ABSOLUTE_MAXIMUM, GEOMETRY_ABSOLUTE_MAXIMUM),
      y: clamp(rect.top, -GEOMETRY_ABSOLUTE_MAXIMUM, GEOMETRY_ABSOLUTE_MAXIMUM),
      width: clamp(rect.width, 0, GEOMETRY_ABSOLUTE_MAXIMUM),
      height: clamp(rect.height, 0, GEOMETRY_ABSOLUTE_MAXIMUM),
    }
  }

  function resolvedElementAnchor(commentId, anchor, originBuild) {
    const target = resolvedElementContext(anchor)
    if (!target.element) return { result: { commentId, status: target.status } }

    const boundedRect = viewportRectangle(target.element)
    if (!isRect(boundedRect, true)) {
      return { result: { commentId, status: "missing" } }
    }

    const documentRect = documentRectangle(target.element)
    const status =
      target.status === "moved" || (!originBuild && rectanglesDiffer(anchor.rect, documentRect))
        ? "moved"
        : "resolved"
    return {
      result: {
        commentId,
        status,
        rect: boundedRect,
        point: {
          x: clamp(
            boundedRect.x + boundedRect.width * anchor.elementOffset.x,
            -GEOMETRY_ABSOLUTE_MAXIMUM,
            GEOMETRY_ABSOLUTE_MAXIMUM,
          ),
          y: clamp(
            boundedRect.y + boundedRect.height * anchor.elementOffset.y,
            -GEOMETRY_ABSOLUTE_MAXIMUM,
            GEOMETRY_ABSOLUTE_MAXIMUM,
          ),
        },
      },
      element: target.element,
      viewportAnchored: isViewportAnchoredElement(target.element),
    }
  }

  function rectangleUnion(rectangles) {
    const left = Math.min(...rectangles.map((rect) => rect.x))
    const top = Math.min(...rectangles.map((rect) => rect.y))
    const right = Math.max(...rectangles.map((rect) => rect.x + rect.width))
    const bottom = Math.max(...rectangles.map((rect) => rect.y + rect.height))
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  function normalizedRectangle(rect, union) {
    return {
      x: union.width > 0 ? (rect.x - union.x) / union.width : 0,
      y: union.height > 0 ? (rect.y - union.y) / union.height : 0,
      width: union.width > 0 ? rect.width / union.width : 1,
      height: union.height > 0 ? rect.height / union.height : 1,
    }
  }

  function areaGeometryMatches(savedRectangles, currentRectangles) {
    if (savedRectangles.length <= 1) return true

    const savedUnion = rectangleUnion(savedRectangles)
    const currentUnion = rectangleUnion(currentRectangles)
    return savedRectangles.every((savedRect, index) => {
      const currentRect = currentRectangles[index]
      const saved = normalizedRectangle(savedRect, savedUnion)
      const current = normalizedRectangle(currentRect, currentUnion)
      return ["x", "y", "width", "height"].every(
        (key) => Math.abs(saved[key] - current[key]) <= AREA_GEOMETRY_TOLERANCE,
      )
    })
  }

  function transformCoordinate(value, savedStart, savedSize, currentStart, currentSize) {
    if (savedSize === 0) return value + currentStart - savedStart
    return currentStart + ((value - savedStart) / savedSize) * currentSize
  }

  function transformedAreaRectangle(rect, savedUnion, currentUnion) {
    const left = transformCoordinate(
      rect.x,
      savedUnion.x,
      savedUnion.width,
      currentUnion.x,
      currentUnion.width,
    )
    const right = transformCoordinate(
      rect.x + rect.width,
      savedUnion.x,
      savedUnion.width,
      currentUnion.x,
      currentUnion.width,
    )
    const top = transformCoordinate(
      rect.y,
      savedUnion.y,
      savedUnion.height,
      currentUnion.y,
      currentUnion.height,
    )
    const bottom = transformCoordinate(
      rect.y + rect.height,
      savedUnion.y,
      savedUnion.height,
      currentUnion.y,
      currentUnion.height,
    )
    return {
      x: clamp(Math.min(left, right), 0, GEOMETRY_ABSOLUTE_MAXIMUM),
      y: clamp(Math.min(top, bottom), 0, GEOMETRY_ABSOLUTE_MAXIMUM),
      width: clamp(Math.abs(right - left), 0, GEOMETRY_ABSOLUTE_MAXIMUM),
      height: clamp(Math.abs(bottom - top), 0, GEOMETRY_ABSOLUTE_MAXIMUM),
    }
  }

  function rectanglesDiffer(first, second) {
    return ["x", "y", "width", "height"].some((key) => Math.abs(first[key] - second[key]) > 4)
  }

  function areaPinPoint(anchor, rect) {
    const target = { x: 1, y: 0 }
    const normalized = anchor.path.reduce(
      (nearest, candidate) => {
        const distance = (candidate.x - target.x) ** 2 + (candidate.y - target.y) ** 2
        return distance < nearest.distance ? { point: candidate, distance } : nearest
      },
      { point: target, distance: Number.POSITIVE_INFINITY },
    ).point
    return {
      x: clamp(
        rect.x + normalized.x * rect.width,
        -GEOMETRY_ABSOLUTE_MAXIMUM,
        GEOMETRY_ABSOLUTE_MAXIMUM,
      ),
      y: clamp(
        rect.y + normalized.y * rect.height,
        -GEOMETRY_ABSOLUTE_MAXIMUM,
        GEOMETRY_ABSOLUTE_MAXIMUM,
      ),
    }
  }

  function areaResult(commentId, anchor, status, documentRect) {
    const rect = {
      x: clamp(
        documentRect.x - window.scrollX,
        -GEOMETRY_ABSOLUTE_MAXIMUM,
        GEOMETRY_ABSOLUTE_MAXIMUM,
      ),
      y: clamp(
        documentRect.y - window.scrollY,
        -GEOMETRY_ABSOLUTE_MAXIMUM,
        GEOMETRY_ABSOLUTE_MAXIMUM,
      ),
      width: clamp(documentRect.width, 0, GEOMETRY_ABSOLUTE_MAXIMUM),
      height: clamp(documentRect.height, 0, GEOMETRY_ABSOLUTE_MAXIMUM),
    }
    return { commentId, status, rect, point: areaPinPoint(anchor, rect) }
  }

  function resolvedAreaAnchor(commentId, anchor, originBuild) {
    if (originBuild) {
      return {
        result: areaResult(commentId, anchor, "resolved", anchor.rect),
        documentRect: anchor.rect,
      }
    }
    if (anchor.elements.length === 0) return { result: { commentId, status: "missing" } }

    const targets = anchor.elements.map(resolvedElementContext)
    if (targets.some((target) => target.status === "changed")) {
      return { result: { commentId, status: "changed" } }
    }

    const available = targets.filter((target) => target.element)
    if (available.length === 0) return { result: { commentId, status: "missing" } }
    if (available.length !== targets.length) return { result: { commentId, status: "changed" } }
    if (new Set(targets.map((target) => target.element)).size !== targets.length) {
      return { result: { commentId, status: "changed" } }
    }

    const savedRectangles = anchor.elements.map((element) => element.rect)
    const currentRectangles = targets.map((target) => documentRectangle(target.element))
    if (!areaGeometryMatches(savedRectangles, currentRectangles)) {
      return { result: { commentId, status: "changed" } }
    }

    const savedUnion = rectangleUnion(savedRectangles)
    const currentUnion = rectangleUnion(currentRectangles)
    const documentRect = transformedAreaRectangle(anchor.rect, savedUnion, currentUnion)
    const status =
      targets.some((target) => target.status === "moved") ||
      rectanglesDiffer(anchor.rect, documentRect)
        ? "moved"
        : "resolved"
    return {
      result: areaResult(commentId, anchor, status, documentRect),
      documentRect,
      viewportAnchored: targets.some((target) => isViewportAnchoredElement(target.element)),
    }
  }

  function resolvedAnchor(commentId, reference) {
    const anchor = reference.anchor
    if (!routeMatches(anchor.route)) {
      return { result: { commentId, status: "route-mismatch" } }
    }
    return anchor.kind === "area"
      ? resolvedAreaAnchor(commentId, anchor, reference.originBuild)
      : resolvedElementAnchor(commentId, anchor, reference.originBuild)
  }

  function resolveGeometry(commentId, reference) {
    const resolved = resolvedAnchor(commentId, reference)
    geometry.set(commentId, {
      ...resolved,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    })
    return resolved.result
  }

  function resolveEntries(entries, requestId) {
    const results = entries.map(([commentId, reference]) => resolveGeometry(commentId, reference))
    post("replica:bridge:anchors-resolved", requestId, { results })
    return results
  }

  function sendAllGeometry() {
    geometryFrame = null
    if (highlightedElement) showHighlight(highlightedElement, true)
    refreshPendingArea()
    const entries = Array.from(anchors.entries())
    for (let index = 0; index < entries.length; index += ANCHORS_PER_MESSAGE) {
      resolveEntries(entries.slice(index, index + ANCHORS_PER_MESSAGE), createRequestId())
    }
  }

  function scheduleGeometry() {
    if (geometryFrame !== null || (anchors.size === 0 && !pendingAreaAnchor)) return
    geometryFrame = window.requestAnimationFrame(sendAllGeometry)
  }

  function handleScroll(event) {
    // Keep ordinary targets in document coordinates; nested scroll and sticky targets need layout.
    if (event.target !== document && event.target !== window) {
      scheduleGeometry()
      return
    }
    if (highlightedElement && isViewportAnchoredElement(highlightedElement)) {
      showHighlight(highlightedElement, true)
    }
    refreshPendingArea()
    if (geometryFrame !== null) {
      window.cancelAnimationFrame(geometryFrame)
      sendAllGeometry()
      return
    }
    const results = Array.from(anchors, ([commentId, reference]) => {
      const cached = geometry.get(commentId)
      if (!cached || cached.viewportAnchored) {
        return resolveGeometry(commentId, reference)
      }
      const result = cached.result
      if (!result.point) return result
      const dx = cached.scrollX - window.scrollX
      const dy = cached.scrollY - window.scrollY
      return {
        ...result,
        point: {
          x: clamp(result.point.x + dx, -GEOMETRY_ABSOLUTE_MAXIMUM, GEOMETRY_ABSOLUTE_MAXIMUM),
          y: clamp(result.point.y + dy, -GEOMETRY_ABSOLUTE_MAXIMUM, GEOMETRY_ABSOLUTE_MAXIMUM),
        },
        rect: {
          ...result.rect,
          x: clamp(result.rect.x + dx, -GEOMETRY_ABSOLUTE_MAXIMUM, GEOMETRY_ABSOLUTE_MAXIMUM),
          y: clamp(result.rect.y + dy, -GEOMETRY_ABSOLUTE_MAXIMUM, GEOMETRY_ABSOLUTE_MAXIMUM),
        },
      }
    })
    for (let index = 0; index < results.length; index += ANCHORS_PER_MESSAGE) {
      post("replica:bridge:anchors-resolved", createRequestId(), {
        results: results.slice(index, index + ANCHORS_PER_MESSAGE),
      })
    }
  }

  function ensureHighlight() {
    if (highlightElement) return highlightElement
    highlightElement = document.createElement("div")
    highlightElement.setAttribute(BRIDGE_NODE_ATTRIBUTE, "highlight")
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    Object.assign(highlightElement.style, {
      background: "rgba(9, 105, 218, 0.12)",
      border: "2px solid rgb(9, 105, 218)",
      borderRadius: "4px",
      boxSizing: "border-box",
      opacity: "0",
      pointerEvents: "none",
      position: "fixed",
      transition: reduceMotion ? "none" : `opacity ${HIGHLIGHT_FADE_MILLISECONDS}ms ease-out`,
      zIndex: "2147483647",
    })
    document.documentElement.append(highlightElement)
    return highlightElement
  }

  function clearFocusTimer() {
    if (focusTimer === null) return

    window.clearTimeout(focusTimer)
    focusTimer = null
  }

  function showHighlight(element, preserveTimer = false) {
    if (!preserveTimer) clearFocusTimer()
    const rect = element.getBoundingClientRect()
    const highlight = ensureHighlight()
    const viewportAnchored = isViewportAnchoredElement(element)
    Object.assign(highlight.style, {
      height: `${Math.max(0, rect.height)}px`,
      position: viewportAnchored ? "fixed" : "absolute",
      left: `${rect.left + (viewportAnchored ? 0 : window.scrollX)}px`,
      opacity: "1",
      top: `${rect.top + (viewportAnchored ? 0 : window.scrollY)}px`,
      width: `${Math.max(0, rect.width)}px`,
    })
    highlightedElement = element
  }

  function hideHighlight() {
    if (highlightElement) highlightElement.style.opacity = "0"
    highlightedElement = null
  }

  function ensureAreaHighlight() {
    if (areaHighlightElement && areaHighlightPath) return areaHighlightElement

    areaHighlightElement = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    areaHighlightElement.setAttribute(BRIDGE_NODE_ATTRIBUTE, "area-highlight")
    areaHighlightElement.setAttribute("aria-hidden", "true")
    Object.assign(areaHighlightElement.style, {
      height: "100%",
      inset: "0",
      overflow: "visible",
      pointerEvents: "none",
      position: "fixed",
      width: "100%",
      zIndex: "2147483647",
    })
    areaHighlightPath = document.createElementNS("http://www.w3.org/2000/svg", "polyline")
    areaHighlightPath.setAttribute("fill", "none")
    areaHighlightPath.setAttribute("stroke", "rgb(9, 105, 218)")
    areaHighlightPath.setAttribute("stroke-linecap", "round")
    areaHighlightPath.setAttribute("stroke-linejoin", "round")
    areaHighlightPath.setAttribute("stroke-width", "2")
    areaHighlightElement.append(areaHighlightPath)
    document.documentElement.append(areaHighlightElement)
    return areaHighlightElement
  }

  function showAreaHighlight(points) {
    ensureAreaHighlight()
    areaHighlightElement.style.position = "absolute"
    areaHighlightPath.setAttribute(
      "points",
      points.map((point) => `${point.x + window.scrollX},${point.y + window.scrollY}`).join(" "),
    )
    areaHighlightElement.style.opacity = points.length > 1 ? "1" : "0"
  }

  function clearAreaHighlight() {
    pendingAreaAnchor = null
    if (areaHighlightPath) areaHighlightPath.setAttribute("points", "")
    if (areaHighlightElement) areaHighlightElement.style.opacity = "0"
  }

  function refreshPendingArea() {
    if (!pendingAreaAnchor) return

    const rect = {
      x: pendingAreaAnchor.rect.x - window.scrollX,
      y: pendingAreaAnchor.rect.y - window.scrollY,
      width: pendingAreaAnchor.rect.width,
      height: pendingAreaAnchor.rect.height,
    }
    showAreaHighlight(
      pendingAreaAnchor.path.map((point) => ({
        x: rect.x + point.x * rect.width,
        y: rect.y + point.y * rect.height,
      })),
    )
  }

  function stopSelection(clearPendingArea) {
    const wasSelecting = selectionMode !== null
    selectionMode = null
    selectionRequestId = null
    drawingPointerId = null
    shapeOptimizing = false
    areaStroke = []
    if (wasSelecting) {
      document.documentElement.style.cursor = originalCursor
      document.documentElement.style.touchAction = originalTouchAction
    }
    document.removeEventListener("pointermove", handleElementPointerMove, true)
    document.removeEventListener("pointerdown", handleElementPointerDown, true)
    document.removeEventListener("pointerdown", handleAreaPointerDown, true)
    document.removeEventListener("pointermove", handleAreaPointerMove, true)
    document.removeEventListener("pointerup", handleAreaPointerUp, true)
    document.removeEventListener("pointercancel", handleAreaPointerCancel, true)
    document.removeEventListener("keydown", handleSelectionKeyDown, true)
    hideHighlight()
    if (clearPendingArea) {
      selectionPending = false
      clearAreaHighlight()
    }
  }

  function prepareSelection(requestId, mode) {
    stopSelection(true)
    clearFocusTimer()
    hideHighlight()
    selectionMode = mode
    selectionRequestId = requestId
    originalCursor = document.documentElement.style.cursor
    originalTouchAction = document.documentElement.style.touchAction
    document.documentElement.style.cursor = "crosshair"
    document.addEventListener("keydown", handleSelectionKeyDown, true)
  }

  function startElementSelection(requestId) {
    prepareSelection(requestId, "element")
    document.addEventListener("pointermove", handleElementPointerMove, true)
    document.addEventListener("pointerdown", handleElementPointerDown, true)
  }

  function startAreaSelection(requestId) {
    prepareSelection(requestId, "area")
    document.documentElement.style.touchAction = "none"
    document.addEventListener("pointerdown", handleAreaPointerDown, true)
    document.addEventListener("pointermove", handleAreaPointerMove, true)
    document.addEventListener("pointerup", handleAreaPointerUp, true)
    document.addEventListener("pointercancel", handleAreaPointerCancel, true)
  }

  function eventElement(event) {
    return event.target instanceof Element && !event.target.closest(`[${BRIDGE_NODE_ATTRIBUTE}]`)
      ? event.target
      : null
  }

  function handleElementPointerMove(event) {
    const element = eventElement(event)
    if (element && element !== highlightedElement) showHighlight(element)
  }

  function handleElementPointerDown(event) {
    if (selectionMode !== "element" || !selectionRequestId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const requestId = selectionRequestId
    const element = eventElement(event)
    const anchor = element ? capturedAnchor(element, event) : null
    stopSelection(true)
    if (anchor && isElementAnchor(anchor)) {
      selectionPending = true
      post("replica:bridge:element-selected", requestId, { anchor })
    } else {
      post("replica:bridge:selection-failed", requestId, { reason: "element-unavailable" })
    }
  }

  function handleAreaPointerDown(event) {
    if (
      selectionMode !== "area" ||
      !selectionRequestId ||
      drawingPointerId !== null ||
      event.button !== 0
    ) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    drawingPointerId = event.pointerId
    shapeOptimizing = event.shiftKey
    areaStroke = [{ x: event.clientX, y: event.clientY }]
    showAreaHighlight(areaStroke)
  }

  function handleAreaPointerMove(event) {
    if (
      selectionMode !== "area" ||
      drawingPointerId === null ||
      event.pointerId !== drawingPointerId
    ) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    const point = { x: event.clientX, y: event.clientY }
    const previous = areaStroke[areaStroke.length - 1]
    if (!previous || pointDistance(previous, point) >= 1) areaStroke.push(point)
    shapeOptimizing = event.shiftKey
    showAreaHighlight(shapeOptimizing ? optimizedStroke(areaStroke) : areaStroke)
  }

  function handleAreaPointerUp(event) {
    if (
      selectionMode !== "area" ||
      !selectionRequestId ||
      drawingPointerId === null ||
      event.pointerId !== drawingPointerId
    ) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    const finalPoint = { x: event.clientX, y: event.clientY }
    const previous = areaStroke[areaStroke.length - 1]
    if (!previous || pointDistance(previous, finalPoint) >= 1) areaStroke.push(finalPoint)

    const requestId = selectionRequestId
    const captured = capturedAreaAnchor(areaStroke, shapeOptimizing || event.shiftKey)
    if (captured.anchor) {
      selectionPending = true
      pendingAreaAnchor = captured.anchor
      stopSelection(false)
      refreshPendingArea()
      post("replica:bridge:area-selected", requestId, { anchor: captured.anchor })
      return
    }

    stopSelection(true)
    post("replica:bridge:selection-failed", requestId, { reason: captured.reason })
  }

  function handleAreaPointerCancel(event) {
    if (
      selectionMode !== "area" ||
      !selectionRequestId ||
      drawingPointerId === null ||
      event.pointerId !== drawingPointerId
    ) {
      return
    }

    const requestId = selectionRequestId
    stopSelection(true)
    post("replica:bridge:selection-cancelled", requestId, {})
  }

  function handleSelectionKeyDown(event) {
    if (!selectionMode || event.key !== "Escape" || !selectionRequestId) return

    event.preventDefault()
    event.stopImmediatePropagation()
    const requestId = selectionRequestId
    stopSelection(true)
    post("replica:bridge:selection-cancelled", requestId, {})
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false

    const editable = target.closest("[contenteditable]")
    return (
      target.matches("input, textarea, select") ||
      (editable && editable.getAttribute("contenteditable") !== "false")
    )
  }

  function handleConversationEscape(event) {
    if (
      event.key === "Escape" &&
      !selectionMode &&
      !selectionPending &&
      !pendingAreaAnchor &&
      !event.defaultPrevented &&
      !event.isComposing &&
      !(
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], dialog, [role="menu"]')
      )
    ) {
      window.setTimeout(() => {
        if (event.defaultPrevented || selectionMode || selectionPending || pendingAreaAnchor) return

        post("replica:bridge:conversation-dismiss-requested", createRequestId(), {})
      }, 0)
    }
  }

  function handleShortcutKeyDown(event) {
    const key = event.key.toLowerCase()
    const messageType =
      key === "c" && event.shiftKey
        ? "replica:bridge:sidebar-toggle-requested"
        : key === "c"
          ? "replica:bridge:element-selection-requested"
          : key === "h" && !event.shiftKey
            ? "replica:bridge:area-selection-requested"
            : null
    if (
      selectionMode ||
      selectionPending ||
      pendingAreaAnchor ||
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      !messageType ||
      isEditableTarget(event.target)
    ) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    post(messageType, createRequestId(), {})
  }

  function focusAnchor(commentId, requestId) {
    clearFocusTimer()
    hideHighlight()
    const reference = anchors.get(commentId)
    if (!reference) {
      post("replica:bridge:anchor-focused", requestId, {
        result: { commentId, status: "missing" },
      })
      return
    }

    let resolution = resolvedAnchor(commentId, reference)
    let result = resolution.result
    if ((result.status === "resolved" || result.status === "moved") && resolution.element) {
      resolution.element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" })
      showHighlight(resolution.element)
      focusTimer = window.setTimeout(() => {
        focusTimer = null
        hideHighlight()
      }, 1_500)
    } else if (
      (result.status === "resolved" || result.status === "moved") &&
      resolution.documentRect &&
      typeof window.scrollTo === "function"
    ) {
      window.scrollTo({
        left: Math.max(
          0,
          resolution.documentRect.x + resolution.documentRect.width / 2 - window.innerWidth / 2,
        ),
        top: Math.max(
          0,
          resolution.documentRect.y + resolution.documentRect.height / 2 - window.innerHeight / 2,
        ),
        behavior: "auto",
      })
    }
    if (result.status === "resolved" || result.status === "moved") {
      resolution = resolvedAnchor(commentId, reference)
      result = resolution.result
    }
    post("replica:bridge:anchor-focused", requestId, { result })
    scheduleGeometry()
  }

  function afterRender(callback) {
    // Let application frames queued during startup render before resolving the fragment.
    window.requestAnimationFrame(() => window.requestAnimationFrame(callback))
  }

  function fragmentTarget(hash) {
    let name = hash.slice(1)
    try {
      name = decodeURIComponent(name)
    } catch {
      // Malformed percent escapes can still be literal DOM IDs.
    }
    return (
      document.getElementById(name) ||
      Array.from(document.getElementsByName(name)).find((element) => element.tagName === "A")
    )
  }

  function clearPendingFragmentOnNavigation() {
    if (
      pendingFragmentRoute &&
      (pendingFragmentRoute.pathname !== location.pathname ||
        pendingFragmentRoute.search !== controlFreeSearch() ||
        pendingFragmentRoute.hash !== location.hash)
    ) {
      pendingFragmentRoute = null
    }
  }

  function restorePendingFragment() {
    clearPendingFragmentOnNavigation()
    if (!pendingFragmentRoute) return

    const target = fragmentTarget(pendingFragmentRoute.hash)
    if (!target) return

    pendingFragmentRoute = null
    target.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" })
    scheduleGeometry()
  }

  function restoreFragment(route, requestId) {
    const token = {}
    fragmentRestoreToken = token
    pendingFragmentRoute = null
    const matchesDocument = () =>
      route.pathname === location.pathname && route.search === controlFreeSearch()
    if (!matchesDocument()) return

    const acknowledge = () => {
      if (fragmentRestoreToken !== token) return

      routeChanged()
      post("replica:bridge:ready", requestId, { route: currentRoute() })
    }
    afterRender(() => {
      if (fragmentRestoreToken !== token || !matchesDocument()) return

      const target = fragmentTarget(route.hash)
      if (target) {
        const url = new URL(location.href)
        url.hash = route.hash
        // Bypass router wrappers without sending the hashchange/popstate they interpret as routes.
        nativeReplaceState.call(history, history.state, "", url.href)
        target.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" })
        acknowledge()
        return
      }

      pendingFragmentRoute = route
      if (location.hash === route.hash) {
        acknowledge()
        return
      }
      // A bare fragment may be an application route. Let its normal navigation handlers run.
      window.addEventListener("hashchange", () => afterRender(acknowledge), {
        capture: true,
        once: true,
      })
      location.hash = route.hash
    })
  }

  function handleMessage(event) {
    if (event.origin !== HUB_ORIGIN || event.source !== window.parent || !isCommand(event.data))
      return

    const message = event.data
    if (message.type === "replica:bridge:request-ready") {
      post("replica:bridge:ready", message.requestId, { route: currentRoute() })
      return
    }
    if (message.type === "replica:bridge:set-theme") {
      const theme = message.payload.theme
      document.documentElement.style.colorScheme = theme
      document.documentElement.dataset.replicaTheme = theme
      window.dispatchEvent(new CustomEvent("replica:theme-change", { detail: { theme } }))
      return
    }
    if (message.type === "replica:bridge:restore-fragment") {
      restoreFragment(message.payload.route, message.requestId)
      return
    }
    if (!REVIEW_ENABLED) return

    if (message.type === "replica:bridge:select-element") {
      startElementSelection(message.requestId)
      return
    }
    if (message.type === "replica:bridge:select-area") {
      startAreaSelection(message.requestId)
      return
    }
    if (message.type === "replica:bridge:cancel-selection") {
      stopSelection(true)
      post("replica:bridge:selection-cancelled", message.requestId, {})
      return
    }
    if (message.type === "replica:bridge:clear-selection") {
      stopSelection(true)
      return
    }
    if (message.type === "replica:bridge:focus-anchor") {
      focusAnchor(message.payload.commentId, message.requestId)
      return
    }
    if (message.payload.replace) {
      anchors.clear()
      geometry.clear()
    }
    for (const entry of message.payload.anchors) {
      anchors.set(entry.commentId, {
        anchor: entry.anchor,
        originBuild: entry.originBuild,
      })
    }
    resolveEntries(
      message.payload.anchors.map((entry) => [
        entry.commentId,
        { anchor: entry.anchor, originBuild: entry.originBuild },
      ]),
      message.requestId,
    )
  }

  function routeChanged() {
    clearPendingFragmentOnNavigation()
    post("replica:bridge:route-changed", createRequestId(), { route: currentRoute() })
    scheduleGeometry()
  }

  function patchHistory(methodName) {
    const original = history[methodName]
    history[methodName] = function patchedHistoryMethod(...argumentsList) {
      const result = original.apply(this, argumentsList)
      routeChanged()
      return result
    }
  }

  window.addEventListener("message", handleMessage)
  if (REVIEW_ENABLED) {
    window.addEventListener("keydown", handleShortcutKeyDown, true)
    window.addEventListener("keydown", handleConversationEscape)
  }
  window.addEventListener("popstate", routeChanged)
  window.addEventListener("hashchange", routeChanged)
  window.addEventListener("resize", scheduleGeometry)
  window.addEventListener("scroll", handleScroll, { capture: true, passive: true })
  patchHistory("pushState")
  patchHistory("replaceState")

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(scheduleGeometry)
    resizeObserver.observe(document.documentElement)
  }
  if (typeof MutationObserver === "function") {
    const mutationObserver = new MutationObserver((mutations) => {
      const hasPrototypeChange = mutations.some((mutation) => {
        const target = mutation.target
        return !(target instanceof Element && target.closest(`[${BRIDGE_NODE_ATTRIBUTE}]`))
      })
      if (hasPrototypeChange) {
        restorePendingFragment()
        scheduleGeometry()
      }
    })
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
  }
})()
