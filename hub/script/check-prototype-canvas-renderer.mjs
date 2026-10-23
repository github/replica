import assert from "node:assert/strict"
import { createServer } from "node:http"
import path from "node:path"

import { chromium } from "../../actions/build/node_modules/playwright/index.mjs"
import { startCanvasServer } from "../../.github/extensions/replica-prototype/start-canvas-server/index.mjs"
import { withContext } from "../../.github/extensions/replica-prototype/test-support/with-context/index.mjs"
import { createCanvasContext } from "../../.github/extensions/replica-prototype/create-canvas-context/index.mjs"
import { createImprovementNotes } from "../../.github/extensions/replica-prototype/improvement-notes/index.mjs"

function sanitize(message) {
  return String(message).replace(/https?:\/\/\S+/g, "[local resource]")
}
const prototype = createServer((request, response) => {
  if (request.url === "/controls.replica.json") {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, { "Content-Type": "text/html" })
  response.end(
    '<!doctype html><html><head><title>Projects</title></head><body><button id="save">Save project</button><input aria-label="Prototype title"></body></html>',
  )
})
let browser
let phase = "startup"
const errors = []
const failedAssets = []

try {
  await new Promise((resolve) => prototype.listen(0, "127.0.0.1", resolve))
  const address = prototype.address()
  assert.ok(address && typeof address === "object")
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  })
  await withContext(async (fixture) => {
    const context = await createCanvasContext({
      prototypeUrl: `http://127.0.0.1:${address.port}/projects?view=active#list`,
      name: "Renderer smoke",
      sessionId: "renderer-smoke",
      repository: fixture.target.repository,
      repositoryPath: fixture.repositoryPath,
      sessionWorkspacePath: fixture.sessionWorkspacePath,
    })
    const dispatched = []
    const session = { send: async (message) => dispatched.push(message) }
    const directory = path.join(context.sessionWorkspacePath, "notes")
    const store = createImprovementNotes(
      () => context,
      session,
      async () => null,
      { directory },
    )
    const canvas = await startCanvasServer(context, session, {
      improvementNotesDirectory: directory,
      hubOptions: { directory: path.join(context.sessionWorkspacePath, "credentials") },
    })
    let page
    try {
      page = await browser.newPage()
      page.on("pageerror", (error) => errors.push(sanitize(error.message)))
      page.on("response", (response) => {
        const url = new URL(response.url())
        if (url.pathname.startsWith("/assets/") && response.status() !== 200)
          failedAssets.push({ asset: path.basename(url.pathname), status: response.status() })
      })
      page.on("requestfailed", (request) => {
        const url = new URL(request.url())
        if (url.pathname.startsWith("/assets/"))
          failedAssets.push({ asset: path.basename(url.pathname), error: "request failed" })
      })
      const capture = Promise.withResolvers()
      await page.route("**/api/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === "/api/improvement-notes/capture") {
          const response = await route.fetch()
          await capture.promise
          return route.fulfill({ response })
        }
        // Keep notes, source capture, and batch persistence on the real disk API.
        if (pathname.startsWith("/api/improvement-notes")) return route.continue()
        if (pathname === "/api/state" || pathname === "/api/refresh")
          return route.fulfill({
            json: {
              name: "Renderer smoke",
              stats: { branch: "prototype", commitSha: "a".repeat(40), workingTree: "clean" },
              publishRequest: { state: "idle", requestedAt: null },
            },
          })
        if (pathname === "/api/agent/next") return route.fulfill({ json: { command: null } })
        return route.fulfill({ json: { state: "unconfigured" } })
      })
      const cards = page.getByRole("button", { name: /^Open improvement:/ })
      const dialog = page.getByRole("dialog", { name: "Improvement", exact: true })
      function fix(count) {
        return page.getByRole("button", {
          name: `Fix all, ${count} pending ${count === 1 ? "request" : "requests"}`,
          exact: true,
        })
      }
      async function filter(name) {
        await page.getByRole("button", { name: /^Filter improvement notes:/ }).click()
        await page.getByRole("menuitemradio", { name, exact: true }).click()
      }
      async function answer(batch, message) {
        await store.results({
          batchId: batch.id,
          results: [
            {
              localId: batch.notes[0].localId,
              revision: batch.notes[0].revision,
              status: "ready",
              message,
            },
          ],
        })
      }

      phase = "select preview target and save locally"
      await page.goto(canvas.url)
      const picker = page.getByRole("button", { name: "Pick & polish", exact: true })
      assert.ok(await fix(0).isDisabled())
      await picker.click()
      const preview = page.frameLocator('iframe[title="Renderer smoke prototype"]')
      await preview.locator('[data-replica-canvas-bridge][style*="crosshair"]').waitFor()
      const target = preview.getByRole("button", { name: "Save project", exact: true })
      await target.hover({ force: true })
      await preview.locator("html > [data-replica-canvas-bridge]").waitFor()
      // The bridge's selection surface receives this real pointer click over the target.
      await target.click({ force: true })
      capture.resolve()
      const composer = page.getByRole("dialog", { name: "Add improvement note", exact: true })
      await composer
        .getByRole("textbox", { name: "What should change?", exact: true })
        .fill("Make the save action clearer.")
      const noteDraft = composer.getByRole("textbox", { name: "What should change?", exact: true })
      await noteDraft.press("s")
      assert.equal(await noteDraft.inputValue(), "Make the save action clearer.s")
      await noteDraft.press("Backspace")
      await composer.getByRole("button", { name: "Save note", exact: true }).click()
      await cards.first().waitFor()
      assert.equal(await cards.count(), 1)
      let state = await store.load()
      assert.equal(state.notes.length, 1)
      assert.equal(state.notes[0].body, "Make the save action clearer.")
      assert.equal(state.notes[0].anchor.selector, "#save")
      assert.deepEqual(state.notes[0].anchor.route, {
        pathname: "/projects",
        search: "?view=active",
        hash: "#list",
      })
      assert.equal(state.notes[0].status, "open")
      assert.equal(dispatched.length, 0)

      phase = "selection shortcuts in the canvas and cross-origin preview"
      await picker.focus()
      await page.keyboard.press("s")
      const selectionSurface = preview.locator('[data-replica-canvas-bridge][style*="crosshair"]')
      await selectionSurface.waitFor()
      await page.keyboard.press("s")
      await selectionSurface.waitFor({ state: "detached" })
      await target.press("s")
      await selectionSurface.waitFor()
      await target.press("Escape")
      await selectionSurface.waitFor({ state: "detached" })
      const prototypeTitle = preview.getByRole("textbox", { name: "Prototype title" })
      await prototypeTitle.fill("Project")
      await prototypeTitle.press("s")
      assert.equal(await prototypeTitle.inputValue(), "Projects")
      assert.equal(await selectionSurface.count(), 0)
      assert.equal((await store.load()).notes.length, 1)
      await page.getByRole("button", { name: "Open improvement notes (1)" }).click()

      phase = "explicit first batch"
      await fix(1).click()
      await page.getByText("In progress", { exact: true }).waitFor()
      state = await store.load()
      const first = await store.batch({ batchId: state.activeBatch })
      assert.equal(dispatched.length, 1)
      assert.deepEqual(first.notes[0].requestIds, [state.notes[0].localId])
      assert.ok(await fix(0).isDisabled())

      phase = "follow-up while the captured batch is pending"
      await cards.first().click()
      await dialog
        .getByRole("textbox", { name: "Follow-up", exact: true })
        .fill("Keep the existing shortcut.")
      const followUpSaved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/improvement-notes" &&
          response.request().method() === "POST" &&
          response.request().postDataJSON()?.operation === "follow-up" &&
          response.ok(),
      )
      await dialog.getByRole("button", { name: "Add follow-up", exact: true }).click()
      await followUpSaved
      await dialog.getByText("Keep the existing shortcut.", { exact: true }).waitFor()
      state = await store.load()
      const followUp = state.notes[0].thread.messages.find((message) => message.role === "author")
      assert.ok(followUp)
      assert.equal(dispatched.length, 1)
      assert.deepEqual(await store.batch({ batchId: first.id }), first)
      await answer(first, "The save action is clearer.")
      await dialog.getByText("The save action is clearer.", { exact: true }).waitFor()
      state = await store.load()
      assert.equal(state.notes[0].status, "open")
      assert.equal(dispatched.length, 1)
      assert.ok(await fix(1).isEnabled())
      await dialog.getByRole("button", { name: "Close improvement", exact: true }).click()
      await filter("Ready to review")
      assert.equal(await cards.count(), 0)
      await filter("Active notes")
      await cards.first().waitFor()

      phase = "explicit subsequent batch answers only the follow-up"
      await fix(1).click()
      await page.getByText("In progress", { exact: true }).waitFor()
      state = await store.load()
      const second = await store.batch({ batchId: state.activeBatch })
      assert.notEqual(second.id, first.id)
      assert.deepEqual(second.notes[0].requestIds, [followUp.id])
      assert.equal(dispatched.length, 2)
      await answer(second, "The existing shortcut is preserved.")
      await page.getByText("Ready to review", { exact: true }).waitFor()
      assert.equal((await store.load()).notes[0].status, "ready")
      await cards.first().click()
      await dialog.getByText("The existing shortcut is preserved.", { exact: true }).waitFor()
      if (process.env.REPLICA_CANVAS_SCREENSHOT)
        await page.screenshot({ path: process.env.REPLICA_CANVAS_SCREENSHOT, fullPage: true })
      await dialog.getByRole("button", { name: "Close improvement", exact: true }).click()

      phase = "resolve and filter"
      await page.getByRole("button", { name: "Improvement actions: 1", exact: true }).click()
      await page.getByRole("menuitem", { name: "Mark as resolved", exact: true }).click()
      await cards.first().waitFor({ state: "hidden" })
      await filter("Resolved")
      await cards.first().waitFor()
      const saved = (await store.load()).notes
      assert.equal(saved[0].status, "resolved")
      assert.equal(saved[0].body, "Make the save action clearer.")
      assert.deepEqual(
        saved[0].thread.messages.map(({ role, body }) => ({ role, body })),
        [
          { role: "author", body: "Keep the existing shortcut." },
          { role: "copilot", body: "The save action is clearer." },
          { role: "copilot", body: "The existing shortcut is preserved." },
        ],
      )

      phase = "reload retains local history"
      await page.reload()
      await filter("Resolved")
      await cards.first().click()
      for (const body of [
        saved[0].body,
        ...saved[0].thread.messages.map((message) => message.body),
      ])
        await dialog.getByText(body, { exact: true }).waitFor()
      const reloaded = createImprovementNotes(
        () => context,
        session,
        async () => null,
        { directory },
      )
      assert.deepEqual((await reloaded.load()).notes, saved)
      assert.equal(dispatched.length, 2)

      phase = "confirmed deletion"
      await dialog.getByRole("button", { name: "Close improvement", exact: true }).click()
      await page.getByRole("button", { name: "Improvement actions: 1", exact: true }).click()
      await page.getByRole("menuitem", { name: "Delete improvement", exact: true }).click()
      const deletion = page.getByRole("dialog", { name: "Delete this improvement?", exact: true })
      await deletion.waitFor()
      assert.equal((await store.load()).notes.length, 1)
      await deletion.getByRole("button", { name: "Delete improvement", exact: true }).click()
      await deletion.waitFor({ state: "hidden" })
      await cards.first().waitFor({ state: "hidden" })
      assert.equal((await reloaded.load()).notes.length, 0)
      assert.equal(dispatched.length, 2)

      phase = "prepare isolated blocked notes for overlapping row menus"
      // A fixture-only author extends beneath the menu; no profile or Hub request is made.
      const menuStore = createImprovementNotes(
        () => context,
        session,
        async () => ({
          origin: "https://hub.example.test",
          status: async () => ({
            state: "undiscovered",
            repositoryAuthorized: true,
            repository: context.target.repository,
            branch: context.target.branch,
            viewerId: 1,
            viewerLogin: "renderer-menu-fixture-author",
          }),
        }),
        { directory, readProfile: async () => ({ avatarUrl: null, error: null }) },
      )
      state = await menuStore.load()
      for (let index = 0; index < 8; index++)
        state = await menuStore.save({
          ...state,
          operation: "create",
          body: `Blocked menu fixture ${index + 1}`,
          anchor: saved[0].anchor,
        })
      state = await store.fix(state)
      const blockedBatch = await store.batch({ batchId: state.activeBatch })
      await store.results({
        batchId: blockedBatch.id,
        results: blockedBatch.notes.map((note) => ({
          localId: note.localId,
          revision: note.revision,
          status: "blocked",
          message: "Fixture work could not be completed.",
        })),
      })
      const blockedNotes = (await store.load()).notes
      assert.ok(blockedNotes.every((note) => note.status === "blocked"))
      const menu = page.getByRole("menu", { name: /^Improvement actions:/ })
      const list = page.locator(".thread-sample__list")

      for (const viewport of [
        { width: 1280, height: 720 },
        { width: 390, height: 844 },
      ]) {
        for (const colorScheme of ["light", "dark"]) {
          phase = `blocked menu stacking at ${viewport.width}px in ${colorScheme}`
          await page.setViewportSize(viewport)
          await page.emulateMedia({ colorScheme, reducedMotion: "reduce" })
          await page.reload()
          await page.getByRole("button", { name: /^Open improvement notes \(/ }).click()
          await cards.nth(1).waitFor()
          const rows = page.locator(".thread-sample__card")
          const firstActions = rows.first().getByRole("button", {
            name: /^Improvement actions:/,
          })
          const geometry = await rows.first().evaluate((row) => {
            const bounds = row.getBoundingClientRect()
            const listElement = row.closest(".thread-sample__list")
            const list = listElement.getBoundingClientRect()
            const filter = document
              .querySelector('.thread-sample__filters button[aria-haspopup="true"]')
              .getBoundingClientRect()
            const avatar = row.querySelector(".hub-user-avatar").getBoundingClientRect()
            const actions = row
              .querySelector('button[aria-haspopup="menu"]')
              .getBoundingClientRect()
            const body = row.querySelector(".review-comment-row__body").getBoundingClientRect()
            const hover = getComputedStyle(row, "::before")
            return {
              avatarOffset: avatar.left - filter.left,
              hoverGutter: bounds.left + parseFloat(hover.insetInlineStart) - list.left,
              actionInset: list.right - actions.right,
              actionWidth: actions.width,
              textGap: actions.left - body.right,
              scrollOverflow: listElement.scrollWidth - listElement.clientWidth,
            }
          })
          console.log(JSON.stringify({ viewport: viewport.width, colorScheme, geometry }))
          assert.ok(Math.abs(geometry.avatarOffset) < 0.5, "Avatar aligns with Active notes")
          assert.ok(Math.abs(geometry.hoverGutter - 8) < 0.5, "Hover retains its 8px left gutter")
          assert.ok(
            Math.abs(geometry.actionInset - 16) < 0.5,
            "Actions retain the ordinary comment's 16px right inset",
          )
          assert.ok(geometry.actionWidth >= 32, "Action hit target is not reduced")
          assert.ok(geometry.textGap >= 4, "Wrapped row text stays clear of actions")
          assert.equal(geometry.scrollOverflow, 0, "Rows do not overflow horizontally")
          await firstActions.click()
          await menu.getByRole("menuitem", { name: "Retry", exact: true }).waitFor()
          const deleteItem = menu.getByRole("menuitem", {
            name: "Delete improvement",
            exact: true,
          })

          async function assertMenuAboveSibling() {
            const probes = await rows.nth(1).evaluate((row) => {
              const overlay = document.querySelector('[role="menu"]')
              const bounds = overlay.getBoundingClientRect()
              return [".review-comment-row__author", 'button[aria-haspopup="menu"]'].map(
                (selector) => {
                  const sibling = row.querySelector(selector).getBoundingClientRect()
                  const left = Math.max(bounds.left, sibling.left)
                  const right = Math.min(bounds.right, sibling.right)
                  const top = Math.max(bounds.top, sibling.top)
                  const bottom = Math.min(bounds.bottom, sibling.bottom)
                  const x = (left + right) / 2
                  const y = (top + bottom) / 2
                  const stack = document.elementsFromPoint(x, y)
                  return {
                    selector,
                    overlaps: right > left && bottom > top,
                    intersection: { left, right, top, bottom },
                    menu: bounds.toJSON(),
                    sibling: sibling.toJSON(),
                    menuOnTop: overlay.contains(document.elementFromPoint(x, y)),
                    siblingBelow: stack.some((element) => row.contains(element)),
                  }
                },
              )
            })
            for (const probe of probes) {
              assert.ok(
                probe.overlaps,
                `Menu must overlap the following row: ${JSON.stringify(probe)}`,
              )
              assert.ok(probe.siblingBelow, `Probe must include the sibling's ${probe.selector}`)
              assert.ok(probe.menuOnTop, `Menu must hit-test above the sibling's ${probe.selector}`)
            }
          }

          await assertMenuAboveSibling()
          const sibling = await rows.nth(1).boundingBox()
          const menuBounds = await menu.boundingBox()
          assert.ok(sibling && menuBounds)
          // Hover the uncovered row gutter, not the overlay, to activate its real hover layer.
          assert.ok(sibling.x + 2 < menuBounds.x)
          await page.mouse.move(sibling.x + 2, sibling.y + sibling.height / 2)
          assert.ok(await rows.nth(1).evaluate((row) => row.matches(":hover")))
          await assertMenuAboveSibling()
          await deleteItem.click()
          await deletion.waitFor()
          const firstBody = await cards.first().getAttribute("aria-label")
          assert.equal(
            await deletion.locator("blockquote").innerText(),
            firstBody.replace("Open improvement: ", ""),
          )
          assert.deepEqual((await store.load()).notes, blockedNotes)
          await deletion
            .getByRole("button", { name: "Cancel", exact: true })
            .filter({ hasText: /^Cancel$/ })
            .click()
          await deletion.waitFor({ state: "hidden" })
          assert.ok(await firstActions.evaluate((element) => element === document.activeElement))

          await firstActions.click()
          await menu.waitFor()
          await page.keyboard.press("Escape")
          await menu.waitFor({ state: "hidden" })
          assert.ok(await firstActions.evaluate((element) => element === document.activeElement))
          await firstActions.click()
          await menu.waitFor()
          await page.getByRole("heading", { name: "Pick & polish", exact: true }).click()
          await menu.waitFor({ state: "hidden" })

          phase = `scrolled blocked menu at ${viewport.width}px in ${colorScheme}`
          const listBounds = await list.boundingBox()
          assert.ok(listBounds)
          await page.mouse.move(listBounds.x + 8, listBounds.y + listBounds.height / 2)
          await page.mouse.wheel(0, 160)
          await page.waitForFunction(
            () => document.querySelector(".thread-sample__list").scrollTop > 0,
          )
          const scrolledActions = rows.nth(3).getByRole("button", {
            name: /^Improvement actions:/,
          })
          await scrolledActions.click()
          await menu.waitFor()
          const scrollTop = await list.evaluate((element) => element.scrollTop)
          const scrolledDelete = menu.getByRole("menuitem", {
            name: "Delete improvement",
            exact: true,
          })
          assert.ok(
            await scrolledDelete.evaluate((element) => {
              const bounds = element.getBoundingClientRect()
              return element.contains(
                document.elementFromPoint(
                  bounds.x + bounds.width / 2,
                  bounds.y + bounds.height / 2,
                ),
              )
            }),
            "A scrolled menu item must not be clipped or covered",
          )
          await scrolledDelete.click()
          await deletion.waitFor()
          assert.equal(
            await deletion.locator("blockquote").innerText(),
            (await cards.nth(3).getAttribute("aria-label")).replace("Open improvement: ", ""),
          )
          await page.keyboard.press("Escape")
          await deletion.waitFor({ state: "hidden" })
          assert.ok(await scrolledActions.evaluate((element) => element === document.activeElement))
          assert.equal(await list.evaluate((element) => element.scrollTop), scrollTop)
          assert.deepEqual((await store.load()).notes, blockedNotes)
        }
      }

      phase = "unsaved follow-up prevents opening overlapping menus"
      await cards.first().click()
      const draft = dialog.getByRole("textbox", { name: "Follow-up", exact: true })
      await draft.fill("Unsaved fixture follow-up")
      const actions = page.getByRole("button", { name: /^Improvement actions:/ })
      assert.ok(await actions.nth(0).isDisabled())
      assert.ok(await actions.nth(1).isDisabled())
      assert.equal(await menu.count(), 0)
      await draft.fill("")
      await dialog.getByRole("button", { name: "Close improvement", exact: true }).click()
      assert.ok(await actions.first().isEnabled())

      phase = "outside prototype clicks dismiss conversations without losing drafts"
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.reload()
      await page.getByRole("button", { name: /^Open improvement notes \(/ }).click()
      await cards.first().click()
      await dialog.waitFor()
      const previewOutside = preview.locator("html")
      await previewOutside.click({ position: { x: 700, y: 500 } })
      await dialog.waitFor({ state: "hidden" })
      assert.ok(
        await cards.first().evaluate((element) => element !== document.activeElement),
        "Outside preview click must not restore focus to the conversation opener",
      )

      await cards.first().click()
      const outsideDraft = dialog.getByRole("textbox", { name: "Follow-up", exact: true })
      await outsideDraft.fill("Keep this outside-click draft.")
      await previewOutside.click({ position: { x: 700, y: 500 } })
      await dialog.getByText("Keep this draft?", { exact: true }).waitFor()
      await previewOutside.click({ position: { x: 700, y: 500 } })
      await dialog.getByText("Keep this draft?", { exact: true }).waitFor()
      await dialog.getByRole("button", { name: "Keep", exact: true }).click()
      assert.equal(await outsideDraft.inputValue(), "Keep this outside-click draft.")
      await dialog.getByRole("button", { name: "Close improvement", exact: true }).click()
      await dialog.getByRole("button", { name: "Discard", exact: true }).click()
      await dialog.waitFor({ state: "hidden" })

      assert.deepEqual((await store.load()).notes, blockedNotes)
      assert.deepEqual(errors, [])
      assert.deepEqual(failedAssets, [])
      console.log(
        "Packaged renderer smoke passed: local notes, explicit batches, persisted history, and overlapping blocked-note menus.",
      )
    } finally {
      await page?.close()
      await canvas.close()
    }
  })
} catch (error) {
  console.error(
    JSON.stringify({
      phase,
      reason: sanitize(error.message.split("\n")[0]),
      source: error.stack?.match(/check-prototype-canvas-renderer\.mjs:\d+:\d+/)?.[0],
      runtimeErrors: errors,
      failedAssets,
    }),
  )
  // eslint-disable-next-line preserve-caught-error -- Playwright errors may include private capability URLs.
  throw new Error("Packaged renderer smoke failed; see sanitized diagnostics above.")
} finally {
  await browser?.close()
  if (prototype.listening)
    await new Promise((resolve, reject) =>
      prototype.close((error) => (error ? reject(error) : resolve())),
    )
}
