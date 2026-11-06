import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createContext, runInContext } from "node:vm"
import { deflateSync } from "node:zlib"
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib"
import type { PDFPage } from "pdf-lib"
import { afterEach, describe, expect, it } from "vitest"

import { orderedScenes } from "./catalog.ts"
import { decodeCapture, galleryHtml, scriptJson, writeDesignPack } from "./output.ts"
import type { Capture, RenderedScene, Scene } from "./types.ts"

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAEklEQVR4nGNgGAWjYBSMgqELAATEAAE0eCSYAAAAAElFTkSuQmCC"
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function outputDirectory() {
  const directory = resolve(`.design-gallery-output-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory)
  return directory
}

function renderedScenes(): RenderedScene[] {
  const catalog: Scene[] = ["zebra-recovery", "alpha-shell"].map((id, index) => ({
    id,
    title: index === 0 ? "Recovery review" : "Shell result",
    group: "Synthetic examples",
    source: "infrastructure/installer/design-gallery/output.test.ts",
    kind: "shell",
    message: `Synthetic message ${index}`,
    purpose: `Purpose for ${id}`,
    decision: `Decision for ${id}`,
    consequence: `Consequence for ${id}`,
    phase: "provision",
    columns: 80,
    rows: 24,
  }))
  return orderedScenes(catalog).map(scene => ({ ...scene, ansi: scene.message }))
}

function pageText(page: PDFPage) {
  const contents = page.node.Contents()
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, index) =>
        page.doc.context.lookup(contents.get(index)))
    : contents instanceof PDFRawStream ? [contents] : []
  return streams.flatMap(stream => {
    if (!(stream instanceof PDFRawStream)) throw new Error("PDF page has no readable content stream.")
    const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")
    return [...operators.matchAll(/<([0-9a-f]+)>\s*Tj/gi)]
      .map(match => Buffer.from(match[1], "hex").toString("latin1"))
  }).join(" ")
}

describe("design capture decoding", () => {
  it("retains a complete PNG and its visible-text transcript", async () => {
    const capture = await decodeCapture({
      png: `data:image/png;base64,${pngBase64}`,
      transcript: "Synthetic terminal output\nDecision remains visible.",
    })

    expect(Buffer.from(capture.png)).toEqual(Buffer.from(pngBase64, "base64"))
    expect(capture.transcript).toBe("Synthetic terminal output\nDecision remains visible.")
  })

  it.each([
    ["missing payload", undefined],
    ["wrong image type", { png: `data:image/jpeg;base64,${pngBase64}`, transcript: "Synthetic" }],
    ["empty transcript", { png: `data:image/png;base64,${pngBase64}`, transcript: " \n" }],
    ["non-PNG bytes", { png: `data:image/png;base64,${Buffer.from("not a PNG").toString("base64")}`, transcript: "Synthetic" }],
    ["missing image end", {
      png: `data:image/png;base64,${Buffer.from(pngBase64, "base64").subarray(0, -12).toString("base64")}`,
      transcript: "Synthetic",
    }],
    ["missing pixel data", {
      png: `data:image/png;base64,${Buffer.concat([
        Buffer.from(pngBase64, "base64").subarray(0, 33),
        Buffer.from(pngBase64, "base64").subarray(-12),
      ]).toString("base64")}`,
      transcript: "Synthetic",
    }],
    ["corrupted chunk checksum", {
      png: `data:image/png;base64,${Buffer.concat([
        Buffer.from(pngBase64, "base64").subarray(0, -4), Buffer.alloc(4),
      ]).toString("base64")}`,
      transcript: "Synthetic",
    }],
  ])("rejects %s instead of accepting an incomplete capture", async (_reason, payload) => {
    await expect(decodeCapture(payload)).rejects.toThrow()
  })

  it.each([
    [19, 20],
    [10_001, 20],
    [5_000, 5_000],
  ])("rejects unsupported image dimensions %i by %i", async (width, height) => {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8
    header[9] = 2
    const chunks: [string, Buffer][] = [
      ["IHDR", header],
      ["IDAT", deflateSync(Buffer.alloc((width * 3 + 1) * height))],
      ["IEND", Buffer.alloc(0)],
    ]
    const encoded = chunks.map(([type, data]) => {
      const body = Buffer.concat([Buffer.from(type), data])
      let crc = 0xffffffff
      for (const byte of body) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
      }
      const length = Buffer.alloc(4)
      length.writeUInt32BE(data.length)
      const checksum = Buffer.alloc(4)
      checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
      return Buffer.concat([length, body, checksum])
    })
    const png = Buffer.concat([Buffer.from(pngBase64, "base64").subarray(0, 8), ...encoded])

    await expect(decodeCapture({
      png: `data:image/png;base64,${png.toString("base64")}`,
      transcript: "Synthetic",
    })).rejects.toThrow()
  })
})

describe("offline design output", () => {
  it("embeds untrusted annotations as round-trippable JSON, never executable closing tags", () => {
    const annotation = '</script><script>throw new Error("injected")</script>\u2028\u2029'
    const scenes = renderedScenes().map(scene => ({ ...scene, purpose: annotation }))
    const serialized = scriptJson({ annotation })
    const html = galleryHtml(scenes)

    expect(JSON.parse(serialized)).toEqual({ annotation })
    expect(serialized).not.toMatch(/[<\u2028\u2029]/)
    expect(html).not.toContain('<script>throw new Error("injected")')
    expect(html).not.toContain(annotation)
  })

  it("uses catalog order for offline options and bounded previous, next and selection navigation", () => {
    const scenes = renderedScenes()
    const html = galleryHtml(scenes)
    const elements = new Map<string, ReturnType<typeof element>>()
    function element(tag: string, textContent = "") {
      return {
        tag, textContent, value: "", src: "", href: "", alt: "", disabled: false,
        children: [] as { value: string; textContent: string }[],
        listeners: new Map<string, () => void>(),
        onclick: () => {},
        append(...children: { value: string; textContent: string }[]) { this.children.push(...children) },
        replaceChildren() { this.children = [] },
        addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener) },
      }
    }
    for (const [, tag, id, text] of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>([^<]*)/g)) {
      elements.set(id, element(tag, text))
    }
    const location = { hash: "" }
    const context = createContext({
      document: { getElementById: (id: string) => elements.get(id), createElement: element },
      location,
      history: { replaceState: (_state: unknown, _unused: string, hash: string) => { location.hash = hash } },
    })
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    expect(scripts.length).toBeGreaterThan(0)
    for (const [, attributes, script] of scripts) {
      expect(attributes).not.toMatch(/\bsrc\s*=/)
      runInContext(script, context)
    }
    const select = [...elements.values()].find(node => node.tag === "select")!
    const previous = [...elements.values()].find(node => node.tag === "button" && node.textContent === "Previous")!
    const next = [...elements.values()].find(node => node.tag === "button" && node.textContent === "Next")!
    const image = [...elements.values()].find(node => node.tag === "img")!
    const notes = [...elements.values()].find(node => node.tag === "dl")!

    expect(select.children.map(option => [option.value, option.textContent])).toEqual(
      scenes.map(scene => [scene.id, scene.label]),
    )
    expect(select.value).toBe(scenes[0].id)
    expect(image.src).toBe(`screens/${scenes[0].id}.png`)
    for (const value of [scenes[0].purpose, scenes[0].decision, scenes[0].consequence]) {
      expect(notes.children.map(node => node.textContent)).toContain(value)
    }
    expect(previous.disabled).toBe(true)
    next.onclick()
    expect(select.value).toBe(scenes[1].id)
    expect(image.src).toBe(`screens/${scenes[1].id}.png`)
    expect(location.hash).toBe(`#${scenes[1].id}`)
    expect(next.disabled).toBe(true)
    previous.onclick()
    expect(select.value).toBe(scenes[0].id)
    select.value = scenes[1].id
    select.listeners.get("change")!()
    expect(image.src).toBe(`screens/${scenes[1].id}.png`)
    expect(image.alt).toBe(scenes[1].title)
  })

  it("writes every PNG, transcript and annotated PDF page in catalog order, not capture or ID order", async () => {
    const directory = await outputDirectory()
    const scenes = renderedScenes()
    const captures = new Map<string, Capture>([...scenes].reverse().map(scene => [
      scene.id, { png: Buffer.from(pngBase64, "base64"), transcript: `Transcript for ${scene.id}` },
    ]))

    await writeDesignPack(directory, scenes, captures, "synthetic-revision")

    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"))
    expect(manifest.revision).toBe("synthetic-revision")
    expect(manifest.scenes).toMatchObject(scenes.map(({ ansi, ...scene }) => scene))
    expect(manifest.scenes.map((scene: { id: string }) => scene.id)).toEqual(scenes.map(scene => scene.id))
    const document = await PDFDocument.load(await readFile(join(directory, "Replica-wizard-design-guide.pdf")))
    expect(manifest.scenes[0].pdfPage).toBeLessThan(manifest.scenes[1].pdfPage)
    for (const [index, scene] of scenes.entries()) {
      expect(await readFile(join(directory, "screens", `${scene.id}.png`))).toEqual(captures.get(scene.id)!.png)
      expect(await readFile(join(directory, "screens", `${scene.id}.txt`), "utf8")).toBe(captures.get(scene.id)!.transcript)
      const text = pageText(document.getPage(manifest.scenes[index].pdfPage - 1))
      for (const value of [scene.label, scene.id, scene.purpose, scene.decision, scene.consequence]) {
        expect(text).toContain(value)
      }
    }
    const html = await readFile(join(directory, "index.html"), "utf8")
    expect(html.indexOf(scenes[0].label)).toBeLessThan(html.indexOf(scenes[1].label))
    expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//)
  })

  it("writes nothing when an unknown capture substitutes for a missing catalog scene", async () => {
    const directory = await outputDirectory()
    const scenes = renderedScenes()
    const capture = { png: Buffer.from(pngBase64, "base64"), transcript: "Synthetic" }
    const captures = new Map([[scenes[0].id, capture], ["unknown-scene", capture]])

    await expect(writeDesignPack(directory, scenes, captures, "synthetic-revision")).rejects.toThrow()

    expect(await readdir(directory)).toEqual([])
  })
})
