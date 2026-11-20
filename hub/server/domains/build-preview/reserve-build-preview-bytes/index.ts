const maximumReservedBytes = 100 * 1024 * 1024
const minimumReservationBytes = 64 * 1024
let reservedBytes = 0

/** Shares the source-byte allowance across preview requests in this process. */
export function reserveBuildPreviewBytes(byteLength: number): (() => void) | null {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) return null
  const bytes = Math.max(byteLength, minimumReservationBytes)
  if (bytes > maximumReservedBytes - reservedBytes) return null
  reservedBytes += bytes
  let released = false
  return () => {
    if (released) return
    released = true
    reservedBytes -= bytes
  }
}
