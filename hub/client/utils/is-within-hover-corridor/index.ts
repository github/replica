type Point = { x: number; y: number }
type Bounds = { left: number; right: number; top: number; bottom: number }

export function isWithinHoverCorridor(point: Point, origin: Point, bounds: Bounds) {
  const margin = 8
  let a: Point
  let b: Point
  if (origin.x < bounds.left) {
    a = { x: bounds.left, y: bounds.top - margin }
    b = { x: bounds.left, y: bounds.bottom + margin }
  } else if (origin.x > bounds.right) {
    a = { x: bounds.right, y: bounds.top - margin }
    b = { x: bounds.right, y: bounds.bottom + margin }
  } else if (origin.y < bounds.top) {
    a = { x: bounds.left - margin, y: bounds.top }
    b = { x: bounds.right + margin, y: bounds.top }
  } else if (origin.y > bounds.bottom) {
    a = { x: bounds.left - margin, y: bounds.bottom }
    b = { x: bounds.right + margin, y: bounds.bottom }
  } else {
    return (
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom
    )
  }

  const area = (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
  if (area === 0) return false

  const sides = [
    (point.x - a.x) * (origin.y - a.y) - (origin.x - a.x) * (point.y - a.y),
    (point.x - b.x) * (a.y - b.y) - (a.x - b.x) * (point.y - b.y),
    (point.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (point.y - origin.y),
  ]
  return !(sides.some((side) => side < 0) && sides.some((side) => side > 0))
}
