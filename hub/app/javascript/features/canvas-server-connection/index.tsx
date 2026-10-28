import { ActionMenu, Button, Heading } from "@primer/react-brand"
import { useEffect, useState } from "react"

import { HubAlert } from "@components/hub-alert"
import { request } from "@utils/prototype-canvas-request"

import { serverCopy as copy } from "./en"
import "./styles.css"

type Servers = {
  servers: { url: string; command: string; pid: number }[]
  warnings: string[]
  development?: { scripts: { id: string; invocation: string }[]; message: string }
}

/** Keeps server execution behind an explicit choice in the current checkout. */
export function CanvasServerConnection({ token }: { token: string }) {
  const [data, setData] = useState<Servers | null>(null)
  const [script, setScript] = useState("")
  const [operation, setOperation] = useState<string | null>(null)
  const busy = operation !== null
  const [scanError, setScanError] = useState("")
  const [error, setError] = useState("")
  const [output, setOutput] = useState("")

  useEffect(() => {
    if (busy) return
    const controller = new AbortController()
    let checking = false
    async function scan() {
      if (checking) return
      checking = true
      try {
        const next = await request<Servers>("/api/servers", token, { signal: controller.signal })
        if (controller.signal.aborted) return
        setData(next)
        setScanError("")
        setScript((selected) =>
          next.development?.scripts.some((entry) => entry.id === selected)
            ? selected
            : (next.development?.scripts[0]?.id ?? ""),
        )
      } catch (cause) {
        if (!controller.signal.aborted)
          setScanError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        checking = false
      }
    }
    const timer = window.setTimeout(() => void scan(), 0)
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void scan()
    }, 30_000)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [busy, token])

  useEffect(() => {
    if (operation !== "start") return
    let disposed = false
    let checking = false
    async function poll() {
      if (checking) return
      checking = true
      try {
        const result = await request<{ startup?: { output: string } }>("/api/server/status", token)
        if (!disposed) setOutput(result.startup?.output ?? "")
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        checking = false
      }
    }
    const timer = window.setInterval(() => void poll(), 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [operation, token])

  async function connect(path: string, body: { script: string } | { url: string }) {
    if (busy) return
    setOperation("url" in body ? body.url : "start")
    setError("")
    setOutput("")
    try {
      await request(path, token, { method: "POST", body: JSON.stringify(body) })
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOperation(null)
    }
  }

  return (
    <section className="canvas-server-connection" aria-labelledby="canvas-server-heading">
      <Heading as="h2" size="subhead-medium" id="canvas-server-heading">
        {copy.heading}
      </Heading>
      <p role="status">{!data && !scanError ? copy.scanning : ""}</p>
      {!data?.servers.length && data?.development ? (
        data.development.scripts.length ? (
          <p>{copy.safety}</p>
        ) : data.development.message ? (
          <HubAlert variant="warning" layout="compact" title={data.development.message} />
        ) : null
      ) : null}
      {!data?.servers.length ? (
        <div className="canvas-server-connection__actions">
          {data?.development?.scripts.length ? (
            <>
              {data.development.scripts.length > 1 ? (
                <ActionMenu
                  size="small"
                  selectionVariant="single"
                  menuAlignment="start"
                  disabled={busy}
                  onSelect={setScript}
                >
                  <ActionMenu.Button
                    variant="secondary"
                    size="small"
                    aria-label={`${copy.script}: ${data.development.scripts.find((entry) => entry.id === script)?.invocation ?? ""}`}
                    disabled={busy}
                  >
                    {data.development.scripts.find((entry) => entry.id === script)?.invocation}
                  </ActionMenu.Button>
                  <ActionMenu.Overlay aria-label={copy.script}>
                    {data.development.scripts.map((entry) => (
                      <ActionMenu.Item
                        key={entry.id}
                        value={entry.id}
                        selected={entry.id === script}
                        role="menuitemradio"
                      >
                        {entry.invocation}
                      </ActionMenu.Item>
                    ))}
                  </ActionMenu.Overlay>
                </ActionMenu>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="small"
                disabled={busy}
                onClick={() => void connect("/api/server/start", { script })}
              >
                {operation === "start" ? copy.starting : copy.start}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {data?.servers.length ? (
        <ul className="canvas-server-connection__servers">
          {data.servers.map((server) => (
            <li key={server.url}>
              <span>{server.url}</span>
              <Button
                type="button"
                variant="secondary"
                size="small"
                disabled={busy}
                onClick={() => void connect("/api/server/connect", { url: server.url })}
              >
                {operation === server.url ? copy.connecting : copy.connect}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {data?.warnings.map((warning, index) => (
        <HubAlert key={index} variant="warning" layout="compact" title={warning} />
      ))}
      {scanError ? (
        <HubAlert
          variant="critical"
          layout="compact"
          title={scanError}
          description={copy.refresh}
        />
      ) : null}
      {error ? <HubAlert variant="critical" layout="compact" title={error} /> : null}
      {output ? (
        <pre className="canvas-server-connection__output" aria-label={copy.output}>
          <code>{output}</code>
        </pre>
      ) : null}
    </section>
  )
}
