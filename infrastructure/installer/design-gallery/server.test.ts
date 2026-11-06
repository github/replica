import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { orderedScenes } from "./catalog.ts"
import { startGallery } from "./server.ts"
import type { RenderedScene, Scene } from "./types.ts"

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAEklEQVR4nGNgGAWjYBSMgqELAATEAAE0eCSYAAAAAElFTkSuQmCC"
const directories: string[] = []
const servers: Awaited<ReturnType<typeof startGallery>>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function gallery() {
  const directory = resolve(`.design-gallery-server-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory)
  const catalog: Scene[] = ["zebra-recovery", "alpha-shell"].map(id => ({
    id,
    title: id,
    group: "Synthetic examples",
    source: "infrastructure/installer/design-gallery/server.test.ts",
    kind: "shell",
    message: `Synthetic output for ${id}`,
    purpose: "Explain the synthetic state.",
    decision: "Read this example.",
    consequence: "No cloud operation occurs.",
    phase: "provision",
    columns: 80,
    rows: 24,
  }))
  const scenes: RenderedScene[] = orderedScenes(catalog).map(scene => ({ ...scene, ansi: scene.message }))
  const server = await startGallery({ directory, scenes, revision: "synthetic-revision" })
  servers.push(server)
  const origin = new URL(server.url).origin
  const headers = {
    Authorization: `Bearer ${server.token}`,
    Origin: origin,
    "Content-Type": "application/json",
  }
  const capture = { png: `data:image/png;base64,${pngBase64}`, transcript: "Synthetic visible terminal text" }
  const post = (path: string, body?: unknown) => fetch(new URL(path, server.url), {
    method: "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { directory, scenes, server, origin, headers, capture, post }
}

describe("loopback design capture server", () => {
  it.each(["capture/zebra-recovery", "finish"])(
    "protects %s with a token, exact Origin and loopback Host even when its payload is valid",
    async path => {
      const { directory, scenes, server, origin, headers, capture, post } = await gallery()
      if (path === "finish") {
        for (const scene of scenes) expect((await post(`/capture/${scene.id}`, capture)).ok).toBe(true)
      }
      const { Authorization, Origin, ...contentHeaders } = headers
      const attempts = [
        { name: "missing token", headers: { ...contentHeaders, Origin } },
        { name: "wrong token", headers: { ...headers, Authorization: "Bearer not-the-token" } },
        { name: "missing origin", headers: { ...contentHeaders, Authorization } },
        { name: "foreign origin", headers: { ...headers, Origin: "https://example.invalid" } },
        { name: "non-exact origin", headers: { ...headers, Origin: `${origin}/` } },
        { name: "foreign host", headers: { ...headers, Host: "example.invalid" } },
      ]

      for (const attempt of attempts) {
        const status = await new Promise<number>((resolve, reject) => {
          const outgoing = request(new URL(`/${path}`, server.url), {
            method: "POST", headers: attempt.headers,
          }, response => {
            response.resume()
            response.once("end", () => resolve(response.statusCode!))
          })
          outgoing.once("error", reject)
          outgoing.end(path.startsWith("capture/") ? JSON.stringify(capture) : undefined)
        })
        expect(status, attempt.name).toBeGreaterThanOrEqual(400)
        expect(status, attempt.name).toBeLessThan(500)
      }

      await expect(readFile(join(directory, "Replica-wizard-design-guide.pdf"))).rejects.toMatchObject({ code: "ENOENT" })
      if (path.startsWith("capture/")) expect((await post("/finish")).ok).toBe(false)
    },
  )

  it("rejects an oversized request before treating it as a capture", async () => {
    const { directory, server, headers } = await gallery()
    const response = await fetch(new URL("/capture/zebra-recovery", server.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ png: `data:image/png;base64,${pngBase64}`, transcript: "x".repeat(24_000_000) }),
    })

    expect(response.status).toBe(413)
    await response.arrayBuffer()
    await expect(readFile(join(directory, "Replica-wizard-design-guide.pdf"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("serves only known assets and completes an offline pack only after every valid known capture", async () => {
    const { directory, scenes, server, headers, capture, post } = await gallery()
    const url = new URL(server.url)
    expect(url.hostname).toBe("127.0.0.1")
    expect(Number(url.port)).toBeGreaterThan(0)
    expect(server.token).not.toBe("")
    const ui = await fetch(server.url)
    expect(ui.ok).toBe(true)
    expect(ui.headers.get("content-type")).toContain("text/html")
    await ui.text()
    const catalog = await (await fetch(new URL("/scenes.json", server.url))).json()
    expect(catalog.scenes ?? catalog).toEqual(scenes)
    expect(catalog.revision).toBe("synthetic-revision")
    for (const asset of ["xterm.js", "xterm.css", "html-to-image.js", "gallery.css", "capture.js"]) {
      const response = await fetch(new URL(`/assets/${asset}`, server.url))
      expect(response.ok, asset).toBe(true)
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
    }
    await writeFile(join(directory, "not-public.txt"), "Synthetic file outside the public asset routes.")
    for (const path of ["/assets/not-public.txt", "/gallery/not-public.txt", "/not-public.txt"]) {
      const response = await fetch(new URL(path, server.url))
      expect(response.status, path).toBe(404)
      await response.arrayBuffer()
    }
    expect((await post("/capture/unknown-scene", capture)).ok).toBe(false)
    const malformed = await fetch(new URL(`/capture/${scenes[0].id}`, server.url), {
      method: "POST", headers, body: "{",
    })
    expect(malformed.ok).toBe(false)
    await malformed.arrayBuffer()
    const invalid = await post(`/capture/${scenes[0].id}`, { ...capture, png: "data:image/png;base64,YmFk" })
    expect(invalid.ok).toBe(false)
    await invalid.arrayBuffer()
    expect((await post(`/capture/${scenes[1].id}`, capture)).ok).toBe(true)
    const incomplete = await post("/finish")
    expect(incomplete.ok).toBe(false)
    await incomplete.arrayBuffer()
    await expect(readFile(join(directory, "Replica-wizard-design-guide.pdf"))).rejects.toMatchObject({ code: "ENOENT" })

    expect((await post(`/capture/${scenes[0].id}`, capture)).ok).toBe(true)
    const complete = await post("/finish")

    expect(complete.ok).toBe(true)
    expect(await complete.json()).toEqual({
      directory,
      gallery: "/gallery/index.html",
      pdf: "/gallery/Replica-wizard-design-guide.pdf",
    })
    const manifest = await fetch(new URL("/gallery/manifest.json", server.url))
    expect(manifest.ok).toBe(true)
    expect((await manifest.json()).scenes.map((scene: { id: string }) => scene.id)).toEqual(scenes.map(scene => scene.id))
    const html = await fetch(new URL("/gallery/index.html", server.url))
    expect(html.ok).toBe(true)
    expect(await html.text()).toContain("Replica-wizard-design-guide.pdf")
    const css = await fetch(new URL("/gallery/gallery.css", server.url))
    expect(css.headers.get("content-type")).toContain("text/css")
    expect(await css.text()).toBe(await readFile(new URL("./gallery.css", import.meta.url), "utf8"))
    const pdf = await fetch(new URL("/gallery/Replica-wizard-design-guide.pdf", server.url))
    expect(pdf.ok).toBe(true)
    expect(pdf.headers.get("content-type")).toContain("application/pdf")
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF")
    for (const scene of scenes) {
      const png = await fetch(new URL(`/gallery/screens/${scene.id}.png`, server.url))
      expect(png.ok).toBe(true)
      expect(Buffer.from(await png.arrayBuffer())).toEqual(Buffer.from(pngBase64, "base64"))
      const transcript = await fetch(new URL(`/gallery/screens/${scene.id}.txt`, server.url))
      expect(await transcript.text()).toBe(capture.transcript)
    }
    for (const path of [
      "/gallery/not-public.txt", "/gallery/screens/unknown-scene.png",
      "/gallery/%2e%2e%2fnot-public.txt", "/assets/%2e%2e%2fnot-public.txt",
    ]) {
      const response = await fetch(new URL(path, server.url))
      expect(response.status, path).toBe(404)
      await response.arrayBuffer()
    }
  })
})
