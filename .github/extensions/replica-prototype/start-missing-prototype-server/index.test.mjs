import assert from "node:assert/strict"
import { request } from "node:http"
import { describe, it } from "node:test"
import { runInNewContext } from "node:vm"

import { StartupError } from "../startup-error/index.mjs"
import { startMissingPrototypeServer } from "./index.mjs"

const candidate = { url: "http://[::1]:5173/", command: "node", pid: 123 }
const rawErrorDetails = "secret=DO_NOT_EXPOSE\n    at handler (/private/checkout/server.mjs:63:14)"

describe("startMissingPrototypeServer()", () => {
  it("rejects malformed unauthenticated request targets without stopping the server", async () => {
    const server = await startMissingPrototypeServer({
      discover: assert.fail,
      connect: assert.fail,
    })
    try {
      for (const target of ["//", "//[", "http://["]) {
        const result = await new Promise((resolve, reject) => {
          const outgoing = request(
            new URL(server.url),
            { path: target, method: "GET" },
            (response) => {
              let body = ""
              response.setEncoding("utf8")
              response.on("data", (chunk) => {
                body += chunk
              })
              response.on("error", reject)
              response.on("end", () => resolve({ status: response.statusCode, body }))
            },
          )
          outgoing.on("error", reject)
          outgoing.end()
        })
        assert.deepEqual(result, { status: 400, body: "Invalid canvas request URL." })
        assert.equal((await fetch(server.url)).status, 200)
        assert.equal((await fetch(new URL("/status", server.url))).status, 403)
      }
    } finally {
      await server.close()
    }
  })

  it("requires a separate document capability for setup HTML and connected redirects", async () => {
    let starts = 0
    let scans = 0
    let connects = 0
    const options = {
      discover: async () => {
        scans += 1
        return { servers: [candidate], warnings: [] }
      },
      connect: async () => {
        connects += 1
      },
      devServer: {
        describe: async () => ({ scripts: [], message: "" }),
        status: () => ({ starting: false, output: "", message: "" }),
        start: async (script) => {
          assert.equal(script, "revision:dev")
          starts += 1
          return candidate.url
        },
      },
    }
    const server = await startMissingPrototypeServer(options)
    let other
    try {
      other = await startMissingPrototypeServer(options)
      const url = new URL(server.url)
      const documentToken = url.searchParams.get("document")
      assert.match(documentToken, /^[A-Za-z0-9_-]{43}$/)
      assert.notEqual(documentToken, new URL(other.url).searchParams.get("document"))
      const page = await fetch(server.url)
      assert.equal(page.status, 200)
      assert.equal(page.headers.get("referrer-policy"), "no-referrer")
      assert.equal(page.headers.get("cache-control"), "no-store")
      const html = await page.text()
      const token = html.match(/<script nonce="([^"]+)">/)[1]
      assert.notEqual(documentToken, token)
      assert.ok(!html.includes(documentToken))
      const headers = { "X-Replica-Canvas-Token": token }
      async function assertDeniedDocuments() {
        for (const search of [
          "",
          "?document=",
          "?document=wrong",
          `?document=${token}`,
          `?document=${new URL(other.url).searchParams.get("document")}`,
          `?document=${documentToken}&document=${documentToken}`,
        ]) {
          const denied = await fetch(`${url.origin}/${search}`, {
            redirect: "manual",
            headers: {
              ...headers,
              Origin: candidate.url,
              "Sec-Fetch-Site": "cross-site",
              "Sec-Fetch-Dest": "iframe",
            },
          })
          assert.equal(denied.status, 403)
          assert.equal(denied.headers.get("location"), null)
          assert.equal(denied.headers.get("content-type"), "text/plain; charset=utf-8")
          assert.equal(await denied.text(), "Invalid canvas document token.")
          assert.ok(!denied.headers.get("content-security-policy").includes(token))
        }
      }
      await assertDeniedDocuments()
      assert.equal((await fetch(`${server.url}&view=extra`)).status, 200)
      assert.equal(await requestWithHost(server.url, "attacker.example"), 403)
      for (const [pathname, method] of [
        ["/servers", "GET"],
        ["/status", "GET"],
        ["/start", "POST"],
        ["/connect", "POST"],
      ]) {
        for (const supplied of [undefined, "wrong", documentToken]) {
          const denied = await fetch(new URL(`${pathname}?document=${documentToken}`, server.url), {
            method,
            headers: supplied ? { "X-Replica-Canvas-Token": supplied } : {},
          })
          assert.equal(denied.status, 403)
          assert.equal(await denied.text(), "Invalid canvas token.")
        }
      }
      assert.deepEqual([starts, scans, connects], [0, 0, 0])
      const status = await fetch(new URL("/status?view=extra", server.url), { headers })
      assert.equal(status.status, 200)
      assert.equal((await status.json()).prototypeUrl, null)
      const scan = await fetch(new URL("/servers?view=extra", server.url), { headers })
      assert.equal(scan.status, 200)
      assert.deepEqual((await scan.json()).servers, [candidate])
      assert.equal(scans, 1)
      const startup = await fetch(new URL("/start?script=revision:dev", server.url), {
        method: "POST",
        headers,
      })
      assert.equal(startup.status, 200)
      assert.deepEqual([starts, connects], [1, 1])
      assert.equal(
        (await fetch(new URL("/assets/renderer.js", server.url), { headers })).status,
        404,
      )

      const rendererUrl = "http://127.0.0.1:12345/?document=renderer-document"
      server.connect(rendererUrl)
      await assertDeniedDocuments()
      const redirect = await fetch(server.url, { redirect: "manual" })
      assert.equal(redirect.status, 302)
      assert.equal(redirect.headers.get("location"), rendererUrl)
      assert.equal(redirect.headers.get("referrer-policy"), "no-referrer")
      assert.equal(await redirect.text(), "")
      server.disconnect()
      assert.equal(server.url, url.href)
      assert.equal((await fetch(server.url)).status, 200)
    } finally {
      await Promise.all([server.close(), other?.close()])
    }
  })

  it("shows start as the primary action beside scan and executes only the selected script after a click", async () => {
    let starts = 0
    let available = false
    let fail = true
    let pendingScan
    let pendingStart
    let finishScan
    let finishStart
    const scripts = [
      {
        id: "revision:dev",
        invocation: "npm run dev",
        command: "vite",
        directory: "/checkout",
        hooks: ["predev: node prepare.mjs"],
      },
      {
        id: "revision:serve",
        invocation: "npm run serve",
        command: "webpack serve",
        directory: "/checkout",
        hooks: [],
      },
    ]
    const server = await startMissingPrototypeServer({
      discover: async () => {
        await pendingScan
        return { servers: available ? [candidate] : [], warnings: [] }
      },
      connect: async (url) => {
        assert.equal(url, candidate.url)
        server.connect("http://127.0.0.1:12345/")
      },
      devServer: {
        describe: async () => ({ scripts, message: "Only run scripts from a trusted checkout." }),
        status: () => ({ starting: false, output: "vite output", message: "" }),
        start: async (id) => {
          starts += 1
          assert.equal(id, scripts[1].id)
          await pendingStart
          if (fail) throw new StartupError("npm run serve exited (code 2).")
          return candidate.url
        },
      },
    })
    try {
      const html = await (await fetch(server.url)).text()
      assert.doesNotMatch(html, /id="(?:command|invocation|command-details)"/)
      const token = html.match(/<script nonce="([^"]+)">/)[1]
      assert.equal(
        (await fetch(new URL("/start?script=revision:serve", server.url), { method: "POST" }))
          .status,
        403,
      )
      assert.equal(starts, 0)
      const elements = new Map()
      function element() {
        return {
          textContent: "",
          value: "",
          disabled: false,
          hidden: true,
          children: [],
          handlers: {},
          setAttribute() {},
          addEventListener(event, handler) {
            this.handlers[event] = handler
          },
          append(...children) {
            this.children.push(...children)
          },
          replaceChildren() {
            this.children = []
          },
        }
      }
      for (const id of [
        "scan",
        "status",
        "servers",
        "warnings",
        "start",
        "scripts",
        "consent",
        "output",
      ]) {
        elements.set(`#${id}`, element())
      }
      let destination
      let finishRefresh
      const refreshed = new Promise((resolve) => {
        finishRefresh = resolve
      })
      await runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]+?)<\/script>/)[1], {
        URL,
        document: { querySelector: (selector) => elements.get(selector), createElement: element },
        fetch: (url, options) => fetch(new URL(url, server.url), options),
        setTimeout: finishRefresh,
        window: {
          location: {
            replace(url) {
              destination = url
            },
          },
        },
      })
      await refreshed
      const start = elements.get("#start")
      const selector = elements.get("#scripts")
      assert.equal(starts, 0)
      assert.equal(start.hidden, false)
      assert.equal(selector.hidden, false)
      assert.deepEqual(
        Array.from(selector.children, (option) => option.textContent),
        ["npm run dev", "npm run serve"],
      )
      assert.equal(elements.get("#consent").hidden, false)
      assert.equal(
        elements.get("#consent").textContent,
        "Only run scripts from a trusted checkout.",
      )
      assert.equal(elements.get("#output").textContent, "vite output")
      selector.value = scripts[1].id
      pendingScan = new Promise((resolve) => {
        finishScan = resolve
      })
      const rescan = elements.get("#scan").handlers.click()
      assert.equal(start.disabled, true)
      assert.equal(selector.disabled, true)
      assert.equal(elements.get("#scan").disabled, true)
      assert.equal(selector.value, scripts[1].id)
      await start.handlers.click()
      assert.equal(starts, 0, "Start must not run while a rescan is pending.")
      await elements.get("#scan").handlers.click()
      finishScan()
      await rescan
      assert.equal(start.disabled, false)
      assert.equal(selector.disabled, false)
      assert.equal(elements.get("#scan").disabled, false)
      selector.value = scripts[1].id
      pendingStart = new Promise((resolve) => {
        finishStart = resolve
      })
      const startup = start.handlers.click()
      assert.equal(start.disabled, true)
      assert.equal(selector.disabled, true)
      assert.equal(elements.get("#scan").disabled, true)
      await elements.get("#scan").handlers.click()
      await start.handlers.click()
      assert.equal(selector.value, scripts[1].id)
      assert.equal(elements.get("#scan").disabled, true)
      finishStart()
      await startup
      assert.equal(elements.get("#status").textContent, "npm run serve exited (code 2).")
      assert.equal(start.disabled, false)
      assert.equal(selector.disabled, false)
      assert.equal(elements.get("#scan").disabled, false)
      fail = false
      await start.handlers.click()
      assert.equal(destination, "http://127.0.0.1:12345/")
      available = true
      await elements.get("#scan").handlers.click()
      assert.equal(start.hidden, true)
      assert.equal(selector.hidden, true)
      assert.equal(starts, 2)
      assert.match(
        html,
        /id="start" hidden>Start dev server<\/button>\s*<button type="button" id="scan"/,
      )
      assert.match(html, /#start\s*\{\s*background:/)
      assert.equal(
        (
          await fetch(new URL("/status", server.url), {
            headers: { "X-Replica-Canvas-Token": token },
          })
        ).status,
        200,
      )
    } finally {
      finishScan?.()
      finishStart?.()
      await server.close()
    }
  })

  it("serves protected scans and rechecks the selected server before connecting", async () => {
    let scans = 0
    let available = true
    const server = await startMissingPrototypeServer({
      discover: async () => {
        scans += 1
        return { servers: available ? [candidate] : [], warnings: [] }
      },
      connect: async (url) => {
        assert.equal(url, candidate.url)
        server.connect("http://127.0.0.1:12345/")
      },
    })
    try {
      const response = await fetch(server.url)
      const html = await response.text()
      assert.match(html, /Scan again/)
      assert.match(
        html,
        /<h1>Open your prototype<\/h1>\s*<p id="status"[^>]*>[^<]+<\/p>\s*<div class="actions">/,
      )
      assert.match(
        html,
        /id="start" hidden>Start dev server<\/button>\s*<button type="button" id="scan"/,
      )
      assert.doesNotMatch(html, /No chat request or process will be started/)
      assert.doesNotMatch(html, /connection-status/)
      assert.doesNotMatch(html, /Find or start prototype|request-prototype|Follow Copilot/)
      const token = html.match(/<script nonce="([^"]+)">/)[1]
      const headers = { "X-Replica-Canvas-Token": token }
      assert.match(response.headers.get("content-security-policy"), new RegExp(`nonce-${token}`))
      assert.equal((await fetch(new URL("/servers", server.url))).status, 403)
      assert.equal(scans, 0)
      assert.deepEqual(await (await fetch(new URL("/servers", server.url), { headers })).json(), {
        servers: [candidate],
        warnings: [],
      })
      function connect(url = candidate.url) {
        return fetch(new URL(`/connect?url=${encodeURIComponent(url)}`, server.url), {
          method: "POST",
          headers,
        })
      }
      assert.equal((await connect("http://unrelated.example/")).status, 409)
      available = false
      assert.equal((await connect()).status, 409)
      available = true
      assert.deepEqual(await (await connect()).json(), { prototypeUrl: "http://127.0.0.1:12345/" })
      assert.deepEqual(await (await fetch(new URL("/status", server.url), { headers })).json(), {
        prototypeUrl: "http://127.0.0.1:12345/",
        message: "",
      })
      const redirect = await fetch(server.url, { redirect: "manual" })
      assert.equal(redirect.status, 302)
      assert.equal(redirect.headers.get("location"), "http://127.0.0.1:12345/")
      assert.equal(
        (await fetch(new URL("/request-prototype", server.url), { method: "POST", headers }))
          .status,
        404,
      )
      assert.equal(await requestWithHost(server.url, "attacker.example.com"), 403)
      server.disconnect(rawErrorDetails)
      assert.equal((await fetch(server.url, { redirect: "manual" })).status, 200)
      assert.deepEqual(await (await fetch(new URL("/status", server.url), { headers })).json(), {
        prototypeUrl: null,
        message: "Prototype server unavailable. Start it again or choose another server.",
      })
    } finally {
      await server.close()
    }
    await assert.rejects(fetch(server.url))
  })

  it("keeps scan retryable after success, missing tools, and connection failures", async () => {
    let failScan = true
    let failConnect = true
    let available = true
    const server = await startMissingPrototypeServer({
      discover: async () => {
        if (failScan) throw new Error(`lsof is not installed. ${rawErrorDetails}`)
        return {
          servers: available ? [candidate] : [],
          warnings: ["http://127.0.0.1:5174/ did not return an HTML page (HTTP 404)."],
        }
      },
      connect: async (url) => {
        assert.equal(url, candidate.url)
        if (failConnect) throw new Error(`Server stopped. ${rawErrorDetails}`)
        server.connect("http://127.0.0.1:12345/")
      },
    })
    try {
      const html = await (await fetch(server.url)).text()
      let destination
      const elements = new Map()
      function element() {
        return {
          textContent: "",
          disabled: false,
          children: [],
          handlers: {},
          setAttribute() {},
          addEventListener(event, handler) {
            this.handlers[event] = handler
          },
          append(...children) {
            this.children.push(...children)
          },
          replaceChildren() {
            this.children = []
          },
        }
      }
      for (const id of ["#scan", "#status", "#servers", "#warnings"]) {
        elements.set(id, element())
      }
      await runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]+?)<\/script>/)[1], {
        URL,
        document: { querySelector: (selector) => elements.get(selector), createElement: element },
        fetch: (url, options) => fetch(new URL(url, server.url), options),
        setTimeout() {},
        window: {
          location: {
            replace(url) {
              destination = url
            },
          },
        },
      })
      const button = elements.get("#scan")
      const status = elements.get("#status")
      assert.equal(button.disabled, false)
      assert.equal(
        status.textContent,
        "Could not check for servers. Check that lsof is installed and can inspect this checkout.",
      )
      failScan = false
      available = false
      await button.handlers.click()
      assert.equal(
        status.textContent,
        "No running servers found. Start your development server, then scan again.",
      )
      assert.equal(elements.get("#servers").children.length, 0)
      available = true
      await button.handlers.click()
      assert.equal(button.disabled, false)
      assert.match(status.textContent, /Choose a server/)
      assert.equal(
        elements.get("#warnings").textContent,
        "http://127.0.0.1:5174/ did not return an HTML page (HTTP 404).",
      )
      const label = elements.get("#servers").children[0].children[0]
      assert.equal(label.textContent, "http://localhost:5173/ — node (PID 123)")
      assert.equal(label.title, candidate.url)
      const connectButton = elements.get("#servers").children[0].children[1]
      await connectButton.handlers.click()
      assert.equal(connectButton.disabled, false)
      assert.equal(
        status.textContent,
        "Could not connect to that server. Make sure it is running, then try again or choose another server.",
      )
      failConnect = false
      await connectButton.handlers.click()
      assert.equal(destination, "http://127.0.0.1:12345/")
      await button.handlers.click()
      assert.equal(button.disabled, false)
    } finally {
      await server.close()
    }
  })

  it("keeps raw exception details out of scan, warning, connect, start, status and description responses", async () => {
    let failScan = true
    const server = await startMissingPrototypeServer({
      discover: async () => {
        if (failScan) throw new Error(`Could not inspect servers: ${rawErrorDetails}`)
        return {
          servers: [{ ...candidate, directory: "/private/checkout" }],
          warnings: [
            "http://[::1]:5174/ did not return an HTML page (HTTP 404).",
            `http://127.0.0.1:5175/ could not be checked: ${rawErrorDetails}`,
            `Unknown warning: ${rawErrorDetails}`,
          ],
        }
      },
      connect: async () => {
        throw new Error(rawErrorDetails)
      },
      devServer: {
        start: async () => {
          throw new Error(rawErrorDetails)
        },
        describe: async () => {
          throw new Error(rawErrorDetails)
        },
        status: () => ({
          starting: false,
          message: rawErrorDetails,
          output: "Intentional script output",
          privateDetails: rawErrorDetails,
        }),
      },
    })
    try {
      const html = await (await fetch(server.url)).text()
      const token = html.match(/<script nonce="([^"]+)">/)[1]
      const headers = { "X-Replica-Canvas-Token": token }
      const scanFailure = await fetch(new URL("/servers", server.url), { headers })
      assert.equal(scanFailure.status, 500)
      const scanError = await scanFailure.json()
      assert.deepEqual(scanError, {
        error:
          "Could not check for servers. Check that lsof is installed and can inspect this checkout.",
      })

      failScan = false
      const scanResult = await (await fetch(new URL("/servers", server.url), { headers })).json()
      assert.deepEqual(scanResult, {
        servers: [candidate],
        warnings: [
          "http://[::1]:5174/ did not return an HTML page (HTTP 404).",
          "http://127.0.0.1:5175/ could not be checked. Make sure it is running.",
          "A server could not be checked. Make sure it is running and serves HTML.",
        ],
        development: {
          scripts: [],
          message: "Could not read dev scripts. Check package.json and start your server manually.",
        },
      })

      const connectionFailure = await fetch(
        new URL(`/connect?url=${encodeURIComponent(candidate.url)}`, server.url),
        { method: "POST", headers },
      )
      assert.equal(connectionFailure.status, 500)
      const connectionError = await connectionFailure.json()
      assert.deepEqual(connectionError, {
        error:
          "Could not connect to that server. Make sure it is running, then try again or choose another server.",
      })
      const startupFailure = await fetch(new URL("/start?script=revision:dev", server.url), {
        method: "POST",
        headers,
      })
      assert.equal(startupFailure.status, 500)
      const startupError = await startupFailure.json()
      assert.deepEqual(startupError, {
        error: "Could not start the dev server. Scan again, then retry or start it manually.",
      })
      const status = await (await fetch(new URL("/status", server.url), { headers })).json()
      assert.deepEqual(status.startup, {
        starting: false,
        message: "Could not start the dev server. Scan again, then retry or start it manually.",
        output: "Intentional script output",
      })
      assert.doesNotMatch(
        JSON.stringify([scanError, scanResult, connectionError, startupError, status]),
        /DO_NOT_EXPOSE|private\/checkout/,
      )
    } finally {
      await server.close()
    }
  })
})

function requestWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const local = request(url, { headers: { Host: host } }, (response) => {
      response.resume()
      response.on("end", () => resolve(response.statusCode))
    })
    local.on("error", reject)
    local.end()
  })
}
