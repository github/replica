import { randomBytes } from "node:crypto"
import type { Response } from "express"

import { maximumResumeTokenLength } from "../../../domains/private-preview/types.ts"
import type { PrivatePreviewAddress } from "../../../utils/private-preview-address/index.ts"

// The reader answers a begin or renewal at once; a frame that loads without answering failed.
const readerReplyGrace = 3_000
const readerReplyLimit = 20_000

/**
 * Renders the Hub shell that the Build page frames. It starts the reader handoff in a nested
 * frame, asks Hub for each grant with a same-origin request, and never shows prototype content.
 */
export function renderInlineLaunch(
  response: Response,
  { hubOrigin, readerOrigin }: { hubOrigin: string; readerOrigin: string },
  address: PrivatePreviewAddress,
  grantPath: string,
  intent: string,
  page?: string,
) {
  const nonce = randomBytes(18).toString("base64url")
  // The Origin header on each form POST must name Hub without revealing the shell URL.
  response.setHeader("Referrer-Policy", "origin")
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      `frame-src ${readerOrigin}`,
      `form-action ${readerOrigin}`,
      "base-uri 'none'",
      `frame-ancestors ${hubOrigin}`,
    ].join("; "),
  )
  return response.type("html")
    .send(`<!doctype html><meta charset="utf-8"><title>Private prototype</title>
<style nonce="${nonce}">html,body{height:100%;margin:0}iframe{display:block;width:100%;height:100%;border:0}iframe[hidden]{display:none}p{margin:1rem;font:0.875rem system-ui,sans-serif}</style>
<p id="status" role="status" hidden></p>
<iframe name="prototype" title="Prototype" sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"></iframe>
<form hidden method="post" target="prototype" action="${readerOrigin}${address.begin}"><input type="hidden" name="intent" value="${intent}"></form>
<form hidden method="post" target="prototype" action="${readerOrigin}${address.exchange}"><input type="hidden" name="grant"><input type="hidden" name="page"></form>
<script nonce="${nonce}">
  const frame = document.querySelector("iframe");
  const [begin, exchange] = document.forms;
  const status = document.getElementById("status");
  let page = ${JSON.stringify(page ?? "")};
  let pending = false;
  let awaiting = null;
  let grace = null;
  function settle() {
    clearTimeout(awaiting);
    clearTimeout(grace);
    awaiting = grace = null;
  }
  function fail(message) {
    settle();
    frame.hidden = true;
    status.textContent = message;
    status.hidden = false;
  }
  function expectReply() {
    settle();
    awaiting = setTimeout(() => fail("This prototype did not open. Open it in a new tab."), ${readerReplyLimit});
  }
  frame.addEventListener("load", () => {
    if (awaiting && !grace)
      grace = setTimeout(() => fail("This prototype did not open. Open it in a new tab."), ${readerReplyGrace});
  });
  addEventListener("message", async (event) => {
    if (event.origin !== ${JSON.stringify(readerOrigin)} || event.source !== frame.contentWindow || pending) return;
    const data = event.data;
    const name = data && typeof data.continuation === "string" ? "continuation"
      : data && typeof data.resume === "string" ? "resume" : null;
    if (!name || data[name].length > ${maximumResumeTokenLength} || !/^[A-Za-z0-9_.-]+$/.test(data[name])) return;
    settle();
    pending = true;
    try {
      const response = await fetch(${JSON.stringify(grantPath)}, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ [name]: data[name] }),
      });
      if (response.status === 401) return fail("Sign in to Hub again, then reload this page.");
      if (!response.ok) throw new Error("unavailable");
      const { grant } = await response.json();
      if (typeof grant !== "string") throw new Error("unavailable");
      exchange.elements.grant.value = grant;
      // Only the first launch opens a requested route; a renewal keeps its signed route.
      exchange.elements.page.disabled = name !== "continuation" || !page;
      exchange.elements.page.value = page;
      exchange.submit();
      exchange.elements.grant.value = "";
      page = "";
    } catch {
      fail("This prototype cannot open here. Open it in a new tab.");
    } finally {
      pending = false;
    }
  });
  expectReply();
  begin.submit();
</script>`)
}
