/* global Terminal, htmlToImage */
const status = document.getElementById("status")
const select = document.getElementById("scene")
const generate = document.getElementById("generate")
const previous = document.getElementById("previous")
const next = document.getElementById("next")
const frame = document.getElementById("terminal-frame")
const terminal = new Terminal({
  cols: 112, rows: 38, convertEol: true, disableStdin: true,
  fontFamily: "Menlo, Monaco, Consolas, monospace", fontSize: 16, lineHeight: 1.15,
  cursorBlink: false, scrollback: 1000,
  theme: { background: "#0d1117", foreground: "#e6edf3", cursor: "#0d1117" },
})
terminal.open(document.getElementById("terminal"))
let scenes
let token
let current = 0
let busy = true
let exported = false

function controls() {
  select.disabled = busy
  previous.disabled = busy || current === 0
  next.disabled = busy || current === scenes.length - 1
  generate.disabled = busy || exported
}

function fitPreview() {
  const viewport = document.getElementById("viewport")
  const scale = Math.min(1, viewport.clientWidth / frame.offsetWidth)
  document.getElementById("terminal-scale").style.transform = `scale(${scale})`
  viewport.style.height = `${frame.offsetHeight * scale}px`
}

new ResizeObserver(fitPreview).observe(document.getElementById("viewport"))

function visibleText() {
  const buffer = terminal.buffer.active
  return Array.from({ length: terminal.rows }, (_, row) =>
    buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "",
  ).join("\n").trimEnd()
}

async function show(scene) {
  current = scenes.indexOf(scene)
  select.value = scene.id
  terminal.reset()
  terminal.resize(scene.columns, scene.rows)
  await new Promise(resolve => terminal.write(`\x1b[2J\x1b[H${scene.ansi}\x1b[?25l`, resolve))
  await document.fonts.ready
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  fitPreview()
  document.getElementById("title").textContent = `${String(scene.ordinal).padStart(3, "0")} / ${scene.title}`
  document.getElementById("group").textContent = scene.group
  document.getElementById("source").textContent = `Source: ${scene.source}\nStable ID: ${scene.id}`
  document.getElementById("page").textContent = `PDF page ${2 + Math.ceil(scenes.length / 25) + current}`
  const notes = document.getElementById("notes")
  notes.replaceChildren()
  for (const [heading, key] of [["Purpose", "purpose"], ["Decision / input", "decision"], ["Consequence / next", "consequence"]]) {
    const dt = document.createElement("dt")
    const dd = document.createElement("dd")
    dt.textContent = heading
    dd.textContent = scene[key]
    notes.append(dt, dd)
  }
  document.getElementById("visible-text").textContent = visibleText()
  for (const [id, extension] of [["original", "png"], ["transcript", "txt"]]) {
    const link = document.getElementById(id)
    link.hidden = !exported
    link.href = `/gallery/screens/${scene.id}.${extension}`
  }
  history.replaceState(null, "", `#${scene.id}`)
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? `Export failed (${response.status}).`)
  return result
}

generate.onclick = async () => {
  const selected = current
  busy = true
  controls()
  try {
    for (const scene of scenes) {
      status.textContent = `Capturing ${scene.ordinal} of ${scenes.length}: ${scene.title}`
      await show(scene)
      const png = await htmlToImage.toPng(frame, { pixelRatio: 2, skipFonts: true })
      const transcript = visibleText()
      await post(`/capture/${scene.id}`, { png, transcript })
    }
    status.textContent = "Creating offline gallery and annotated PDF..."
    const result = await post("/finish", {})
    exported = true
    status.textContent = `Complete: ${scenes.length} screens.\n${result.directory}`
    for (const [label, href] of [["Open offline gallery", result.gallery], ["Open annotated PDF", result.pdf]]) {
      const link = document.createElement("a")
      link.textContent = label
      link.href = href
      document.getElementById("result").append(link)
    }
  } catch (error) {
    status.textContent = `Generation failed: ${error.message}`
  } finally {
    await show(scenes[selected])
    busy = false
    controls()
  }
}

async function navigate(index) {
  busy = true
  controls()
  try {
    await show(scenes[Math.max(0, Math.min(scenes.length - 1, index))])
  } catch (error) {
    status.textContent = `Preview failed: ${error.message}`
  } finally {
    busy = false
    controls()
  }
}

select.onchange = () => navigate(scenes.findIndex(scene => scene.id === select.value))
previous.onclick = () => navigate(current - 1)
next.onclick = () => navigate(current + 1)

async function load() {
  const response = await fetch("/scenes.json")
  if (!response.ok) throw new Error(`Could not load catalog (${response.status}).`)
  const data = await response.json()
  scenes = data.scenes
  token = data.token
  for (const scene of scenes) {
    const option = document.createElement("option")
    option.value = scene.id
    option.textContent = scene.label
    select.append(option)
  }
  document.getElementById("summary").textContent = `${scenes.length} synthetic states · source ${data.revision} · no Azure commands · real Ink presentation`
  const initial = scenes.findIndex(scene => scene.id === location.hash.slice(1))
  await show(scenes[initial < 0 ? 0 : initial])
  status.textContent = "Browse the screens, or generate the complete offline gallery and PDF. Keep this page open during export."
  busy = false
  controls()
}

load().catch(error => { status.textContent = `Capture page failed: ${error.message}` })
