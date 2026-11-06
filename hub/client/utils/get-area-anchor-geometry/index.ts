import type { AnchorRectangle, AreaAnchor } from "@utils/review-anchor/types"

/** Maps a normalized saved stroke onto one resolved viewport rectangle. */
export function getAreaAnchorGeometry(anchor: AreaAnchor, rect: AnchorRectangle) {
  const path = anchor.path.map((point) => ({
    x: rect.x + point.x * rect.width,
    y: rect.y + point.y * rect.height,
  }))
  const pinTarget = { x: rect.x + rect.width, y: rect.y }
  const point = path.reduce(
    (nearest, candidate) => {
      const candidateDistance = (candidate.x - pinTarget.x) ** 2 + (candidate.y - pinTarget.y) ** 2
      return candidateDistance < nearest.distance
        ? { point: candidate, distance: candidateDistance }
        : nearest
    },
    { point: pinTarget, distance: Number.POSITIVE_INFINITY },
  ).point

  return { path, point }
}
