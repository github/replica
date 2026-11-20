export function getPreviewBasePath(pathname) {
  return /^\/previews\/github\/[1-9]\d*\/[1-9]\d*\//.exec(pathname)?.[0] ?? "/"
}
