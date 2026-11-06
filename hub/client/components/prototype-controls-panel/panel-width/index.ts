import type { ScopeSnapshot } from "@utils/prototype-controls-protocol"

export function panelWidth(scopes: readonly ScopeSnapshot[]) {
  const pages = scopes.filter((scope) => scope.declaration.role !== "shared")
  const candidates = pages.length ? pages : scopes
  return candidates.length
    ? Math.max(...candidates.map((scope) => scope.declaration.panel?.width ?? 288))
    : 288
}
