import { readFile } from "node:fs/promises"
import { createContext, runInContext } from "node:vm"
import { describe, expect, it } from "vitest"

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

const capability = "a".repeat(64)

function pendingOperation() {
  const started = Promise.withResolvers<void>()
  const completion = Promise.withResolvers<void>()
  return {
    started: started.promise,
    begin: started.resolve,
    completion: completion.promise,
    release: () => completion.resolve(),
    fail: () => completion.reject(new Error("Synthetic PNG failure")),
  }
}

async function page(hash = `#token=${capability}`, catalogToken?: string) {
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
  const requests: { path: string, headers: Record<string, string>, body: { png?: string, transcript?: string } }[] = []
  const writes: string[] = []
  let nextRender: ReturnType<typeof pendingOperation> | undefined
  let nextPng: ReturnType<typeof pendingOperation> | undefined
  let renderError = false
  let pngCalls = 0
  let terminal: Terminal
  class Terminal {
    constructor() { terminal = this }
    rows = 0
    text = ""
    buffer = {
      active: {
        viewportY: 0,
        getLine: (row: number) => row === 0 ? { translateToString: () => this.text } : undefined,
      },
    }
    open() {}
    reset() { this.text = "" }
    resize(_columns: number, rows: number) {
      if (renderError) {
        renderError = false
        throw new Error("Synthetic preview failure")
      }
      this.rows = rows
    }
    write(text: string, done: () => void) {
      writes.push(text)
      const complete = () => {
        this.text = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
        done()
      }
      const pending = nextRender
      nextRender = undefined
      if (pending) {
        pending.begin()
        void pending.completion.then(complete)
      } else complete()
    }
  }
  const location = { hash }
  await runInContext(script, createContext({
    document: {
      getElementById: (id: string) => elements.get(id),
      createElement: element,
      fonts: { ready: Promise.resolve() },
    },
    Terminal,
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (callback: () => void) => callback(),
    location,
    URLSearchParams,
    history: { replaceState: (_state: unknown, _title: string, hash: string) => { location.hash = hash } },
    htmlToImage: {
      toPng: async () => {
        pngCalls++
        const pending = nextPng
        nextPng = undefined
        if (pending) {
          pending.begin()
          await pending.completion
        }
        return `data:image/png;base64,${Buffer.from(terminal.text).toString("base64")}`
      },
    },
    fetch: async (path: string, options?: { method: string, headers: Record<string, string>, body: string }) => {
      if (options?.method === "POST") {
        posts.push(path)
        requests.push({ path, headers: options.headers, body: JSON.parse(options.body) })
      }
      return {
        ok: true,
        json: async () => path === "/scenes.json"
          ? { scenes, revision: "synthetic-revision", ...(catalogToken ? { token: catalogToken } : {}) }
          : { directory: "synthetic-output", gallery: "/gallery/index.html", pdf: "/gallery/Replica-wizard-design-guide.pdf" },
      }
    },
  }))
  const get = (id: string) => elements.get(id)!
  return {
    get, scenes, posts, requests, writes, location,
    pngCalls: () => pngCalls,
    pauseNextRender() {
      nextRender = pendingOperation()
      return nextRender
    },
    pauseNextPng() {
      nextPng = pendingOperation()
      return nextPng
    },
    failNextRender() { renderError = true },
  }
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
    expect(new URLSearchParams(location.hash.slice(1)).get("scene")).toBe(scenes[1].id)
    expect(new URLSearchParams(location.hash.slice(1)).get("token")).toBe(capability)
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
    expect(get("generate").disabled).toBe(true)
    await get("generate").onclick()
    expect(posts).toEqual([...scenes.map(scene => `/capture/${scene.id}`), "/finish"])
  })

  it("does not start export or another navigation while a preview render is pending", async () => {
    const { get, scenes, posts, writes, pngCalls, pauseNextRender } = await page()
    const pending = pauseNextRender()
    const preview = get("next").onclick()
    await pending.started
    const writeCount = writes.length
    const attempts = [
      get("generate").onclick(),
      get("previous").onclick(),
      get("next").onclick(),
    ]
    get("scene").value = scenes[0].id
    attempts.push(get("scene").onchange())

    try {
      for (const id of ["scene", "previous", "next", "generate"]) expect(get(id).disabled, id).toBe(true)
      expect(writes).toHaveLength(writeCount)
      expect(pngCalls()).toBe(0)
      expect(posts).toEqual([])
    } finally {
      pending.release()
      await Promise.all([preview, ...attempts])
    }

    expect(get("title").textContent).toContain(scenes[1].title)
    expect(get("scene").disabled).toBe(false)
    expect(get("previous").disabled).toBe(false)
    expect(get("generate").disabled).toBe(false)
  })

  it("keeps scene images and transcripts paired when navigation is attempted during PNG export", async () => {
    const { get, scenes, requests, writes, pauseNextPng } = await page()
    await get("next").onclick()
    const pending = pauseNextPng()
    const exporting = get("generate").onclick()
    await pending.started
    const writeCount = writes.length
    const attempts = [
      get("previous").onclick(),
      get("next").onclick(),
      get("generate").onclick(),
    ]
    get("scene").value = scenes[1].id
    attempts.push(get("scene").onchange())

    try {
      for (const id of ["scene", "previous", "next", "generate"]) expect(get(id).disabled, id).toBe(true)
      expect(writes).toHaveLength(writeCount)
      expect(requests).toEqual([])
    } finally {
      pending.release()
      await Promise.all([exporting, ...attempts])
    }

    expect(requests.filter(request => request.path.startsWith("/capture/")).map(({ path, body }) => ({
      path, transcript: body.transcript, imageText: Buffer.from(body.png!.split(",")[1], "base64").toString(),
    }))).toEqual(scenes.map(scene => ({
      path: `/capture/${scene.id}`, transcript: scene.title, imageText: scene.title,
    })))
    expect(get("scene").value).toBe(scenes[1].id)
    expect(get("scene").disabled).toBe(false)
    expect(get("generate").disabled).toBe(true)
  })

  it("restores usable controls after a preview fails", async () => {
    const { get, scenes, failNextRender } = await page()
    failNextRender()

    await get("next").onclick()

    expect(get("status").textContent).toContain("Synthetic preview failure")
    expect(get("scene").disabled).toBe(false)
    expect(get("generate").disabled).toBe(false)
    await get("previous").onclick()
    expect(get("title").textContent).toContain(scenes[0].title)
  })

  it("restores navigation and allows retry after a pending PNG export fails", async () => {
    const { get, scenes, posts, pauseNextPng } = await page()
    await get("next").onclick()
    const pending = pauseNextPng()
    const exporting = get("generate").onclick()
    await pending.started

    pending.fail()
    await exporting

    expect(get("status").textContent).toContain("Synthetic PNG failure")
    expect(posts).toEqual([])
    expect(get("scene").value).toBe(scenes[1].id)
    expect(get("scene").disabled).toBe(false)
    expect(get("previous").disabled).toBe(false)
    expect(get("generate").disabled).toBe(false)
    await get("generate").onclick()
    expect(posts).toEqual([...scenes.map(scene => `/capture/${scene.id}`), "/finish"])
  })

  it("loads a scene from the fragment and preserves its capability across browsing and reload", async () => {
    const scenes = orderedScenes().slice(0, 2)
    const initialHash = `#token=${capability}&scene=${scenes[1].id}`
    const first = await page(initialHash)
    expect(first.get("scene").value).toBe(scenes[1].id)

    await first.get("previous").onclick()
    const reloaded = await page(first.location.hash, "b".repeat(64))
    await reloaded.get("generate").onclick()

    expect(reloaded.get("scene").value).toBe(scenes[0].id)
    expect(new URLSearchParams(reloaded.location.hash.slice(1)).get("token")).toBe(capability)
    expect(reloaded.requests.map(request => request.headers.Authorization)).toEqual(
      Array(reloaded.scenes.length + 1).fill(`Bearer ${capability}`),
    )
  })

  it.each(["", "#token=not-a-capability", `#token=${"A".repeat(64)}`])(
    "does not fall back to a catalog token when the fragment is missing or invalid (%s)",
    async hash => {
      const { get, posts, pngCalls } = await page(hash, "b".repeat(64))

      expect(get("status").textContent).toMatch(/failed|error/i)
      expect(get("generate").disabled).toBe(true)
      await get("generate").onclick()
      expect(posts).toEqual([])
      expect(pngCalls()).toBe(0)
    },
  )
})
