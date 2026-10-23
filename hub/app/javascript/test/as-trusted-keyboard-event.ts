export type AnnotationShortcutModule = {
  isAnnotationShortcut(event: KeyboardEvent): boolean
}

export function asTrustedKeyboardEvent(event: KeyboardEvent) {
  return new Proxy(event, {
    get(target, property) {
      if (property === "isTrusted") return true
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== "function") return value
      return value.bind(target) as unknown
    },
  })
}
