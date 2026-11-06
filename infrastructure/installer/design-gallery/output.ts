import { writeFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib"
import type { PDFFont, PDFPage } from "pdf-lib"

import type { Capture, RenderedScene } from "./types.ts"

export const evidence =
  "Synthetic design reference. Real Ink presentation and field validation; fabricated cloud data, errors, plans and results. No deployment, sign-in, lock recovery or private configuration was used. This is not an Azure, accessibility or end-to-end deployment audit."

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function verifyPngChunks(png: Buffer) {
  let offset = 8
  let imageData = false
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    if (offset + length + 12 > png.length) throw new Error("Capture PNG contains a truncated chunk.")
    let crc = 0xffffffff
    for (let index = offset + 4; index < offset + length + 8; index++) {
      crc = crcTable[(crc ^ png[index]!) & 255]! ^ (crc >>> 8)
    }
    if (((crc ^ 0xffffffff) >>> 0) !== png.readUInt32BE(offset + length + 8)) {
      throw new Error("Capture PNG failed its chunk checksum.")
    }
    const type = png.toString("ascii", offset + 4, offset + 8)
    if (type === "IDAT") imageData = true
    offset += length + 12
    if (type === "IEND") {
      if (length !== 0 || offset !== png.length || !imageData) {
        throw new Error("Capture PNG has an invalid image ending.")
      }
      return
    }
  }
  throw new Error("Capture PNG is missing its image ending.")
}

export function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
}

export function galleryHtml(scenes: readonly RenderedScene[]) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Replica wizard design gallery</title>
<link rel="stylesheet" href="gallery.css">
<header><h1>Replica Hub installation wizard</h1><p>${scenes.length} synthetic states · no Azure commands · real Ink presentation</p>
<nav aria-label="Screen navigation"><button id="previous">Previous</button><select id="scene" aria-label="Screen"></select><button id="next">Next</button><a href="Replica-wizard-design-guide.pdf">Annotated PDF</a></nav></header>
<main><section><h2 id="title"></h2><img id="screen" alt=""><p class="screen-links"><a id="original">Original 2x PNG</a><a id="transcript">Visible terminal transcript</a></p></section><aside><p id="group"></p><dl id="notes"></dl><small id="source"></small><p id="page"></p><p>${evidence}</p></aside></main>
<script>const scenes=${scriptJson(scenes.map(({ ansi, ...scene }) => scene))};
const select=document.getElementById('scene');let current=0;
for(const s of scenes){let o=document.createElement('option');o.value=s.id;o.textContent=s.label;select.append(o)}
function show(index){current=Math.max(0,Math.min(scenes.length-1,index));const s=scenes[current];select.value=s.id;document.getElementById('title').textContent=String(s.ordinal).padStart(3,'0')+' / '+s.title;document.getElementById('group').textContent=s.group;document.getElementById('source').textContent='Source: '+s.source+' | Stable ID: '+s.id;document.getElementById('page').textContent='PDF page '+(2+Math.ceil(scenes.length/25)+current);const img=document.getElementById('screen');img.src='screens/'+s.id+'.png';img.alt=s.title;document.getElementById('original').href=img.src;document.getElementById('transcript').href='screens/'+s.id+'.txt';const notes=document.getElementById('notes');notes.replaceChildren();for(const [heading,key] of [['Purpose','purpose'],['Decision / input','decision'],['Consequence / next','consequence']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=heading;dd.textContent=s[key];notes.append(dt,dd)}document.getElementById('previous').disabled=current===0;document.getElementById('next').disabled=current===scenes.length-1;history.replaceState(null,'','#'+s.id)}
select.addEventListener('change',()=>show(scenes.findIndex(s=>s.id===select.value)));document.getElementById('previous').onclick=()=>show(current-1);document.getElementById('next').onclick=()=>show(current+1);const initial=scenes.findIndex(s=>s.id===location.hash.slice(1));show(initial<0?0:initial);
</script></html>`
}

function printable(text: string) {
  return text.replace(/[–—−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/→/g, "->").replace(/…/g, "...").replace(/≥/g, ">=").replace(/≤/g, "<=")
    .replace(/\u00a0/g, " ")
}

function paragraph(page: PDFPage, font: PDFFont, text: string, x: number, y: number, width: number, size = 11) {
  for (const line of printable(text).split("\n")) {
    let row = ""
    for (const word of line.split(/\s+/)) {
      if (font.widthOfTextAtSize(`${row} ${word}`.trim(), size) > width && row) {
        if (y < 40) throw new Error("PDF annotations exceed the page. Shorten the scene annotations.")
        page.drawText(row, { x, y, font, size })
        y -= size * 1.4
        row = ""
      }
      let remainder = word
      while (font.widthOfTextAtSize(remainder, size) > width) {
        let length = 1
        while (font.widthOfTextAtSize(remainder.slice(0, length + 1), size) <= width) length++
        if (y < 40) throw new Error("PDF annotations exceed the page. Shorten the scene annotations.")
        page.drawText(remainder.slice(0, length), { x, y, font, size })
        y -= size * 1.4
        remainder = remainder.slice(length)
      }
      row = `${row} ${remainder}`.trim()
    }
    if (y < 40) throw new Error("PDF annotations exceed the page. Shorten the scene annotations.")
    page.drawText(row, { x, y, font, size })
    y -= size * 1.4
  }
  return y
}

export async function decodeCapture(payload: unknown): Promise<Capture> {
  if (!payload || typeof payload !== "object" || !("png" in payload) || !("transcript" in payload) ||
      typeof payload.png !== "string" || typeof payload.transcript !== "string" ||
      !payload.transcript.trim() || payload.transcript.length > 200_000 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.png)) {
    throw new Error("Capture must contain a PNG data URL and a nonempty visible-text transcript.")
  }
  const png = Buffer.from(payload.png.slice("data:image/png;base64,".length), "base64")
  if (png.length < 45 || png.length > 8_000_000 ||
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      png.toString("ascii", 12, 16) !== "IHDR" ||
      png.readUInt32BE(16) < 20 || png.readUInt32BE(16) > 10_000 ||
      png.readUInt32BE(20) < 20 || png.readUInt32BE(20) > 10_000 ||
      png.readUInt32BE(16) * png.readUInt32BE(20) > 20_000_000 ||
      png.toString("ascii", png.length - 8, png.length - 4) !== "IEND") {
    throw new Error("Capture PNG is incomplete or exceeds the supported image dimensions.")
  }
  verifyPngChunks(png)
  const document = await PDFDocument.create()
  await document.embedPng(png)
  await document.save()
  return { png, transcript: payload.transcript }
}

export async function writeDesignPack(
  directory: string,
  scenes: readonly RenderedScene[],
  captures: ReadonlyMap<string, Capture>,
  revision: string,
) {
  if (captures.size !== scenes.length || scenes.some(scene => !captures.has(scene.id))) {
    throw new Error(`Incomplete capture: expected all ${scenes.length} catalog scenes before creating the PDF.`)
  }
  const document = await PDFDocument.create()
  document.setTitle("Replica wizard design guide")
  document.setSubject(evidence)
  const font = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const cover = document.addPage([1190.55, 841.89])
  paragraph(cover, bold, "Replica wizard design guide", 48, 770, 1000, 30)
  paragraph(cover, font, evidence, 48, 700, 900, 16)
  paragraph(cover, font, `Source revision: ${revision}\n${scenes.length} distinct synthetic states. One canonical catalog order supplies all displayed numbers.\nStable scene IDs are file names and links, not display numbers.\nThe following contents link to individual screens. Keep index.html, gallery.css, manifest.json and screens/ together for offline use.`, 48, 580, 900, 14)
  const contents = Array.from({ length: Math.ceil(scenes.length / 25) }, () => document.addPage([1190.55, 841.89]))
  const screenPages: PDFPage[] = []
  for (const scene of scenes) {
    const capture = captures.get(scene.id)!
    const page = document.addPage([1190.55, 841.89])
    screenPages.push(page)
    paragraph(page, bold, scene.label, 36, 796, 1110, 21)
    paragraph(page, font, `${scene.group} | Synthetic screen | ${scene.columns} columns x ${scene.rows} rows`, 36, 766, 1110, 11)
    const image = await document.embedPng(capture.png)
    const scale = Math.min(820 / image.width, 670 / image.height)
    page.drawRectangle({ x: 36, y: 58, width: 820, height: 680, color: rgb(0.051, 0.067, 0.09) })
    page.drawImage(image, { x: 36, y: 738 - image.height * scale, width: image.width * scale, height: image.height * scale })
    let y = 728
    for (const [heading, text] of [
      ["Purpose", scene.purpose], ["Decision / input", scene.decision], ["Consequence / next", scene.consequence],
      ["Source", scene.source], ["Stable ID", scene.id],
    ]) {
      y = paragraph(page, bold, heading!, 880, y, 270, 12) - 4
      y = paragraph(page, font, text!, 880, y, 270, 11) - 18
    }
    page.drawText(`Screen ${scene.ordinal} of ${scenes.length} | Source revision ${revision} | Synthetic, not deployment evidence`, { x: 36, y: 25, font, size: 9 })
  }
  scenes.forEach((scene, index) => {
    const page = contents[Math.floor(index / 25)]!
    if (index % 25 === 0) paragraph(page, bold, "Screen contents", 48, 780, 1000, 24)
    const y = 738 - (index % 25) * 26
    const pageNumber = 2 + contents.length + index
    paragraph(page, font, `${scene.label}  (page ${pageNumber})`, 48, y, 1090, 13)
    page.node.addAnnot(document.context.register(document.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [48, y - 4, 1140, y + 16],
      Border: [0, 0, 0], Dest: [screenPages[index]!.ref, PDFName.of("Fit")],
    })))
  })
  const pdf = await document.save()
  await mkdir(join(directory, "screens"), { recursive: true })
  for (const scene of scenes) {
    const capture = captures.get(scene.id)!
    await writeFile(join(directory, "screens", `${scene.id}.png`), capture.png)
    await writeFile(join(directory, "screens", `${scene.id}.txt`), capture.transcript)
  }
  await writeFile(join(directory, "Replica-wizard-design-guide.pdf"), pdf)
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    revision, evidence,
    scenes: scenes.map(({ ansi, ...scene }) => ({ ...scene, pdfPage: 2 + contents.length + scene.ordinal - 1 })),
  }, null, 2) + "\n")
  await writeFile(join(directory, "index.html"), galleryHtml(scenes))
  await writeFile(join(directory, "gallery.css"), await readFile(new URL("./gallery.css", import.meta.url)))
}
