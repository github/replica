export function declaresPreviewMount(bytes: Uint8Array, mount: string): boolean {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    return (
      typeof value === "object" && value !== null && "basePath" in value && value.basePath === mount
    )
  } catch {
    return false
  }
}
