import pngjs from "pngjs"

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Checks that a screenshot is a complete PNG and returns its width and height. */
export function pngDimensions(
  bytes: Buffer,
  name: string,
  maximumWidth: number,
  maximumHeight: number,
) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    (bytes.readUInt32BE(16) > maximumWidth || bytes.readUInt32BE(20) > maximumHeight)
  ) {
    throw new Error(
      `Screenshot ${name} must be at most ${maximumWidth} by ${maximumHeight} pixels.`,
    )
  }

  let image

  try {
    image = pngjs.PNG.sync.read(bytes, { checkCRC: true })
  } catch {
    throw new Error(`Screenshot ${name} must be a complete PNG file.`)
  }

  return { width: image.width, height: image.height }
}
