import { PREVIEW_BRIDGE_PATH } from "./constants.ts"

const closingHead = /<\/head\s*>/i

export function injectPreviewBridge(html: Uint8Array): Uint8Array {
  const source = new TextDecoder().decode(html)
  const script = `<script src="${PREVIEW_BRIDGE_PATH}"></script>`
  const output = closingHead.test(source)
    ? source.replace(closingHead, `${script}</head>`)
    : `${source}${script}`
  return new TextEncoder().encode(output)
}
