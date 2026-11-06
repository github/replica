const regions = new WeakMap<Document, { element: HTMLElement; users: number }>()

export const toastRegion = {
  subscribe: (onChange: () => void) => {
    let region = regions.get(document)
    if (!region || !region.element.isConnected) {
      const element = document.createElement("section")
      element.className = "hub-toast-region"
      element.setAttribute("aria-label", "Notifications")
      document.body.append(element)
      region = { element, users: 0 }
      regions.set(document, region)
    }
    const current = region
    current.users += 1
    onChange()
    return () => {
      current.users -= 1
      if (current.users === 0) {
        current.element.remove()
        if (regions.get(document) === current) regions.delete(document)
      }
    }
  },
  getSnapshot: () => regions.get(document)?.element ?? null,
  getServerSnapshot: () => null,
}
