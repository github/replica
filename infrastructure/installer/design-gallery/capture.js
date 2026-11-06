/* global Terminal, htmlToImage */
const status = document.getElementById("status")
const select = document.getElementById("scene")
const generate = document.getElementById("generate")
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

async function show(scene) {
  select.value = scene.id
  terminal.reset()
  terminal.resize(scene.columns, scene.rows)
  await new Promise(resolve => terminal.write(`\x1b[2J\x1b[H${scene.ansi}\x1b[?25l`, resolve))
  await document.fonts.ready
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  document.getElementById("notes").textContent =
    `${scene.label}\n${scene.group}\n\nPurpose: ${scene.purpose}\n\nDecision / input: ${scene.decision}\n\nConsequence / next: ${scene.consequence}\n\nSource: ${scene.source}\nStable ID: ${scene.id}`
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
  generate.disabled = true
  select.disabled = true
  try {
    for (const scene of scenes) {
      status.textContent = `Capturing ${scene.ordinal} of ${scenes.length}: ${scene.title}`
      await show(scene)
      const png = await htmlToImage.toPng(frame, { pixelRatio: 2, skipFonts: true })
      const buffer = terminal.buffer.active
      const transcript = Array.from({ length: terminal.rows }, (_, row) =>
        buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "",
      ).join("\n").trimEnd()
      await post(`/capture/${scene.id}`, { png, transcript })
    }
    status.textContent = "Creating offline gallery and annotated PDF..."
    const result = await post("/finish", {})
    status.textContent = `Complete: ${scenes.length} screens.\n${result.directory}`
    for (const [label, href] of [["Open offline gallery", result.gallery], ["Open annotated PDF", result.pdf]]) {
      const link = document.createElement("a")
      link.textContent = label
      link.href = href
      link.style.marginRight = "24px"
      document.getElementById("result").append(link)
    }
    select.disabled = false
  } catch (error) {
    status.textContent = `Generation failed: ${error.message}`
    generate.disabled = false
    select.disabled = false
  }
}

select.onchange = () => {
  select.disabled = true
  show(scenes.find(scene => scene.id === select.value)).catch(error => {
    status.textContent = `Preview failed: ${error.message}`
  }).finally(() => { select.disabled = false })
}

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
  await show(scenes[0])
  status.textContent = `Ready: ${scenes.length} synthetic screens. Generation stays in this browser; keep this page open until complete.`
  generate.disabled = false
  select.disabled = false
}

load().catch(error => { status.textContent = `Capture page failed: ${error.message}` })
