import { readFile } from "node:fs/promises"
import { createContext, runInContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"

import { orderedScenes } from "./catalog.ts"

interface Element {
  value: string
  textContent: string
  href: string
  hidden: boolean
  disabled: boolean
  clientWidth: number
  offsetWidth: number
  offsetHeight: number
  style: Record<string, string>
  children: Element[]
  onclick: () => Promise<void>
  onchange: () => Promise<void>
  append: (...children: Element[]) => void
  replaceChildren: () => void
}

async function page() {
  const html = await readFile(new URL("./capture.html", import.meta.url), "utf8")
  const script = await readFile(new URL("./capture.js", import.meta.url), "utf8")
  const elements = new Map<string, Element>()
  function element(): Element {
    return {
      value: "", textContent: "", href: "", hidden: false, disabled: false,
      clientWidth: 800, offsetWidth: 1100, offsetHeight: 720, style: {},
      children: [],
      onclick: async () => {}, onchange: async () => {},
      append(...children: Element[]) { this.children.push(...children) },
      replaceChildren() { this.children = [] },
    }
  }
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) elements.set(id, element())
  for (const id of ["scene", "previous", "next", "generate"]) elements.get(id)!.disabled = true
  const scenes = orderedScenes().slice(0, 2).map(scene => ({ ...scene, ansi: scene.title }))
  const posts: string[] = []
  class Terminal {
    rows = 0
    text = ""
    buffer = { active: { viewportY: 0, getLine: () => ({ translateToString: () => this.text }) } }
    open() {}
    reset() {}
    resize(_columns: number, rows: number) { this.rows = rows }
    write(text: string, done: () => void) { this.text = text; done() }
  }
  const location = { hash: "" }
  runInContext(script, createContext({
    document: {
      getElementById: (id: string) => elements.get(id),
      createElement: element,
      fonts: { ready: Promise.resolve() },
    },
    Terminal,
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (callback: () => void) => callback(),
    location,
    history: { replaceState: (_state: unknown, _title: string, hash: string) => { location.hash = hash } },
    htmlToImage: { toPng: async () => "data:image/png;base64,synthetic-test-image" },
    fetch: async (path: string, options?: { method: string }) => {
      if (options?.method === "POST") posts.push(path)
      return {
        ok: true,
        json: async () => path === "/scenes.json"
          ? { scenes, token: "synthetic-test-token", revision: "synthetic-revision" }
          : { directory: "synthetic-output", gallery: "/gallery/index.html", pdf: "/gallery/Replica-wizard-design-guide.pdf" },
      }
    },
  }))
  const get = (id: string) => elements.get(id)!
  await vi.waitFor(() => expect(get("scene").disabled).toBe(false))
  return { get, scenes, posts, location }
}

describe("live gallery navigation", () => {
  it("browses the canonical scenes using previous, next and the selector before export", async () => {
    const { get, scenes, location } = await page()

    expect(get("previous").disabled).toBe(true)
    expect(get("scene").value).toBe(scenes[0].id)
    await get("next").onclick()
    expect(get("scene").value).toBe(scenes[1].id)
    expect(get("next").disabled).toBe(true)
    expect(get("title").textContent).toContain(scenes[1].title)
    expect(get("notes").children.map(node => node.textContent)).toContain(scenes[1].purpose)
    expect(location.hash).toBe(`#${scenes[1].id}`)
    await get("previous").onclick()
    expect(get("scene").value).toBe(scenes[0].id)
    get("scene").value = scenes[1].id
    await get("scene").onchange()
    expect(get("title").textContent).toContain(scenes[1].title)
  })

  it("exports every scene while retaining the selected screen and usable navigation afterwards", async () => {
    const { get, scenes, posts } = await page()
    await get("next").onclick()

    await get("generate").onclick()

    expect(posts).toEqual([...scenes.map(scene => `/capture/${scene.id}`), "/finish"])
    expect(get("scene").value).toBe(scenes[1].id)
    expect(get("scene").disabled).toBe(false)
    expect(get("previous").disabled).toBe(false)
    expect(get("generate").disabled).toBe(true)
    expect(get("original").hidden).toBe(false)
    expect(get("original").href).toBe(`/gallery/screens/${scenes[1].id}.png`)
    expect(get("result").children.map(link => link.href)).toContain("/gallery/Replica-wizard-design-guide.pdf")
    await get("previous").onclick()
    expect(get("scene").value).toBe(scenes[0].id)
    expect(get("transcript").href).toBe(`/gallery/screens/${scenes[0].id}.txt`)
  })
})
