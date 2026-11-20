export function isTemplateScreenshotPath(path: string) {
  return /^screenshots\/(?:templates\/[a-z0-9]+(?:-[a-z0-9]+)*\/)?desktop(?:-dark)?\.png$/.test(
    path,
  )
}

export function templateScreenshotPath(id: string, theme: "light" | "dark") {
  return `screenshots/${id === "default" ? "" : `templates/${id}/`}desktop${theme === "dark" ? "-dark" : ""}.png`
}

export function readTemplateScreenshotPath(requestPath: string) {
  try {
    const path = decodeURIComponent(requestPath)
    if (!path.startsWith("/__replica/")) return null
    const artifactPath = path.slice("/__replica/".length)
    return isTemplateScreenshotPath(artifactPath) ? artifactPath : null
  } catch {
    return null
  }
}
