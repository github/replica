import type { BuildsIndexPageData } from "@pages/builds-index-page/types"

import { octocat } from "./users"

export const welcomeScreenshot = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800">
    <rect width="1280" height="800" fill="#f6f8fa"/>
    <rect x="72" y="64" width="1136" height="88" rx="12" fill="#ffffff" stroke="#d0d7de"/>
    <rect x="72" y="184" width="720" height="52" rx="8" fill="#0969da"/>
    <rect x="72" y="276" width="1136" height="360" rx="16" fill="#ffffff" stroke="#d0d7de"/>
    <text x="112" y="118" font-family="system-ui" font-size="28" fill="#1f2328">github/prototype</text>
    <text x="112" y="218" font-family="system-ui" font-size="26" fill="#ffffff">prototype/welcome</text>
    <text x="112" y="348" font-family="system-ui" font-size="42" font-weight="700" fill="#1f2328">Welcome to the prototype</text>
    <text x="112" y="408" font-family="system-ui" font-size="24" fill="#59636e">Review this design with Octocat and Mona.</text>
  </svg>
`)}`

export const welcomeFullPageScreenshot = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 3200">
    <rect width="1280" height="3200" fill="#f6f8fa"/>
    <rect width="1280" height="96" fill="#24292f"/>
    <text x="72" y="60" fill="white" font-family="system-ui" font-size="30">github/prototype</text>
    <text x="72" y="245" fill="#0969da" font-family="system-ui" font-size="28">prototype/welcome</text>
    <text x="72" y="360" fill="#1f2328" font-family="system-ui" font-size="64" font-weight="700">Welcome to the prototype</text>
    <text x="72" y="425" fill="#59636e" font-family="system-ui" font-size="28">Review this design with Octocat and Mona.</text>
    <rect x="72" y="530" width="1136" height="640" rx="24" fill="#dbeafe"/>
    <circle cx="640" cy="850" r="210" fill="#0969da"/>
    <text x="72" y="1320" fill="#1f2328" font-family="system-ui" font-size="48" font-weight="700">Explore the welcome flow</text>
    <rect x="72" y="1390" width="540" height="490" rx="24" fill="#ffffff" stroke="#d0d7de"/>
    <rect x="668" y="1390" width="540" height="490" rx="24" fill="#ffffff" stroke="#d0d7de"/>
    <text x="120" y="1500" fill="#0969da" font-family="system-ui" font-size="32">Get started</text>
    <text x="716" y="1500" fill="#0969da" font-family="system-ui" font-size="32">Share feedback</text>
    <rect x="72" y="2010" width="1136" height="760" rx="24" fill="#ddf4e4"/>
    <text x="120" y="2160" fill="#1f2328" font-family="system-ui" font-size="48" font-weight="700">See what comes next</text>
    <rect x="0" y="2920" width="1280" height="280" fill="#24292f"/>
    <text x="72" y="3060" fill="white" font-family="system-ui" font-size="32">Prototype footer</text>
  </svg>
`)}`

export const welcomeNarrowFullPageScreenshot = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 1800">
    <rect width="390" height="1800" fill="#f6f8fa"/>
    <rect width="390" height="72" fill="#24292f"/>
    <text x="24" y="45" fill="white" font-family="system-ui" font-size="22">github/prototype</text>
    <text x="24" y="150" fill="#0969da" font-family="system-ui" font-size="20">prototype/welcome</text>
    <text x="24" y="226" fill="#1f2328" font-family="system-ui" font-size="30" font-weight="700">Welcome</text>
    <text x="24" y="270" fill="#59636e" font-family="system-ui" font-size="16">Review this design with the team.</text>
    <rect x="24" y="320" width="342" height="360" rx="16" fill="#dbeafe"/>
    <circle cx="195" cy="500" r="110" fill="#0969da"/>
    <text x="24" y="760" fill="#1f2328" font-family="system-ui" font-size="26" font-weight="700">Explore the flow</text>
    <rect x="24" y="804" width="342" height="270" rx="16" fill="white" stroke="#d0d7de"/>
    <text x="48" y="864" fill="#0969da" font-family="system-ui" font-size="22">Get started</text>
    <rect x="24" y="1100" width="342" height="270" rx="16" fill="white" stroke="#d0d7de"/>
    <text x="48" y="1160" fill="#0969da" font-family="system-ui" font-size="22">Share feedback</text>
    <rect x="24" y="1410" width="342" height="220" rx="16" fill="#ddf4e4"/>
    <text x="48" y="1480" fill="#1f2328" font-family="system-ui" font-size="22">See what comes next</text>
    <rect y="1700" width="390" height="100" fill="#24292f"/>
  </svg>
`)}`

export const successfulBuild: BuildsIndexPageData["builds"][number] = {
  author: {
    avatarUrl: octocat.avatarUrl,
    label: "By @octocat",
    url: "https://github.com/octocat",
  },
  commitLabel: "Commit aaaaaaa",
  commitSha: "a".repeat(40),
  createdAt: "2026-09-14T12:00:00Z",
  createdLabel: "Added to Hub September 14, 2026",
  number: 1,
  numberLabel: "build 1",
  path: "/repositories/2001/prototypes/1/builds/1",
  shortCommitSha: "aaaaaaa",
  state: "successful",
  stateLabel: "Successful",
}
