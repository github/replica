import seed from "../seed.json"

import screenshotsUrl from "./previews.svg?url"

const authors = [
  ["avery-chen", "Avery Chen"],
  ["jordan-ellis", "Jordan Ellis"],
  ["riley-patel", "Riley Patel"],
  ["sam-rivera", "Sam Rivera"],
  ["taylor-brooks", "Taylor Brooks"],
  ["morgan-reed", "Morgan Reed"],
  ["casey-wong", "Casey Wong"],
  ["quinn-hayes", "Quinn Hayes"],
  ["alex-moreno", "Alex Moreno"],
  ["drew-bennett", "Drew Bennett"],
  ["jamie-park", "Jamie Park"],
  ["robin-shah", "Robin Shah"],
  ["cameron-lee", "Cameron Lee"],
  ["sage-walker", "Sage Walker"],
  ["devon-clarke", "Devon Clarke"],
  ["rowan-kim", "Rowan Kim"],
  ["blair-foster", "Blair Foster"],
  ["emery-james", "Emery James"],
  ["finley-gray", "Finley Gray"],
  ["harper-singh", "Harper Singh"],
  ["reese-martin", "Reese Martin"],
  ["arden-lopez", "Arden Lopez"],
  ["skyler-bell", "Skyler Bell"],
  ["parker-adams", "Parker Adams"],
] as const

const areas = [
  "Projects",
  "Repositories",
  "Pull requests",
  "Issues",
  "Discussions",
  "Teams",
  "Organizations",
  "Releases",
  "Deployments",
  "Workflows",
  "Packages",
  "Environments",
  "Milestones",
  "Code reviews",
  "Insights",
  "Notifications",
  "Saved searches",
  "Security alerts",
] as const

const views = ["overview", "search", "activity", "settings", "planning", "welcome"] as const

type FixtureBuild = Omit<(typeof seed.builds)[number], "startedAt"> & {
  startedAt: string | null
}

export function createFixtureSeed() {
  const data: Omit<typeof seed, "builds"> & { builds: FixtureBuild[] } = structuredClone(seed)
  data.users.push(...authors.map(([login, name]) => ({ id: login, login, name, avatarUrl: null })))

  function build(
    prototypeId: number,
    number: number,
    authorLogin: string,
    name: string,
  ): FixtureBuild {
    const created =
      Date.parse("2026-10-28T15:00:00Z") +
      (prototypeId === 1 ? (number - 3) * 120 : prototypeId * 45 + number * 120) * 60_000
    const isLatest = prototypeId !== 1 && number === 2 + (prototypeId % 4)
    const state = isLatest
      ? ["successful", "successful", "failed", "queued", "running", "superseded"][prototypeId % 6]!
      : number % 13 === 0
        ? "failed"
        : number % 9 === 0
          ? "superseded"
          : "successful"
    const view = views[prototypeId % views.length]!
    return {
      number,
      repositoryId: 2001,
      prototypeId,
      state,
      commitSha: (prototypeId * 1000 + number).toString(16).padStart(40, "0"),
      commitAuthorLogin: authorLogin,
      createdAt: new Date(created).toISOString(),
      startedAt: state === "queued" ? null : new Date(created + 10_000).toISOString(),
      finishedAt:
        state === "queued" || state === "running"
          ? null
          : new Date(created + 45_000 + (number % 5) * 12_000).toISOString(),
      previewUrl:
        state === "successful"
          ? `/mock-previews/example.html?prototype=${encodeURIComponent(name)}&build=${number}`
          : null,
      desktopScreenshotUrl: state === "successful" ? `${screenshotsUrl}#${view}` : null,
      narrowScreenshotUrl: state === "successful" ? `${screenshotsUrl}#${view}-narrow` : null,
      failureSummary:
        state === "failed"
          ? "Type checking failed: the form submit handler needs an event type."
          : null,
    }
  }

  for (const original of data.builds) {
    if (original.desktopScreenshotUrl) original.desktopScreenshotUrl = `${screenshotsUrl}#welcome`
    if (original.narrowScreenshotUrl)
      original.narrowScreenshotUrl = `${screenshotsUrl}#welcome-narrow`
  }
  for (let number = 4; number <= 57; number += 1) {
    data.builds.push(build(1, number, data.users[number % data.users.length]!.login, "Welcome"))
  }
  for (const [areaIndex, area] of areas.entries()) {
    for (const [variant, suffix] of ["overview", "search", "activity"].entries()) {
      const id = 4 + areaIndex * 3 + variant
      const name = `${area} ${suffix}`
      const authorLogin = data.users[(id - 4) % data.users.length]!.login
      data.prototypes.push({
        id,
        repositoryId: 2001,
        name,
        branchName: `prototype/${name.toLowerCase().replaceAll(" ", "-")}`,
        description: [
          `Bring ${area.toLowerCase()} status, ownership, and next steps into one workspace.`,
          `Find ${area.toLowerCase()} with saved filters and clearer result summaries.`,
          `Follow recent changes to ${area.toLowerCase()} without losing your place.`,
        ][variant]!,
        authorLogin,
      })
      if (id % 11 === 0) continue
      for (let number = 1; number <= 2 + (id % 4); number += 1) {
        data.builds.push(build(id, number, authorLogin, name))
      }
    }
  }
  return data
}
