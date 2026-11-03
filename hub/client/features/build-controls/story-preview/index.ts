import { installControlsBridge } from "@application/prototype-preview-bridge/controls"

const state = { enabled: true, title: "Build preview", items: 3 }

function render() {
  const heading = document.querySelector("h1")
  const description = document.querySelector("p")
  const list = document.querySelector("ul")
  if (!heading || !description || !list) throw new Error("Build controls story markup is missing.")
  heading.textContent = state.title
  description.hidden = !state.enabled
  list.replaceChildren(
    ...Array.from({ length: state.items }, (_, index) => {
      const item = document.createElement("li")
      item.textContent = `Item ${index + 1}`
      return item
    }),
  )
}

Object.assign(window, {
  buildPreview: {
    readEnabled: () => state.enabled,
    writeEnabled: (enabled: boolean) => {
      state.enabled = enabled
      render()
    },
    readTitle: () => state.title,
    writeTitle: (title: string) => {
      state.title = title
      render()
    },
    readItems: () => state.items,
    writeItems: (items: number) => {
      state.items = items
      render()
    },
    add: () => {
      state.items = Math.min(8, state.items + 1)
      render()
    },
  },
})
render()
installControlsBridge(window.location.origin)
