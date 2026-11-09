import { createFixtureBuild } from "../create-fixture-build"
import {
  buildCountVariation,
  minimumBuildCount,
  originalWelcomeBuildCount,
  screenshotsUrl,
} from "../create-fixture-build/constants"
import type { FixtureBuild } from "../create-fixture-build/types"
import seed from "../seed.json"

const welcomeBuildCount = 57
const firstGeneratedPrototypeId = 4
const noBuildPrototypeInterval = 11

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

export function createFixtureSeed() {
  const data: Omit<typeof seed, "builds"> & { builds: FixtureBuild[] } = structuredClone(seed)
  data.users.push(...authors.map(([login, name]) => ({ id: login, login, name, avatarUrl: null })))

  for (const original of data.builds) {
    if (original.desktopScreenshotUrl) original.desktopScreenshotUrl = `${screenshotsUrl}#welcome`
    if (original.narrowScreenshotUrl)
      original.narrowScreenshotUrl = `${screenshotsUrl}#welcome-narrow`
  }
  for (let number = originalWelcomeBuildCount + 1; number <= welcomeBuildCount; number += 1) {
    data.builds.push(
      createFixtureBuild(1, number, data.users[number % data.users.length]!.login, "Welcome"),
    )
  }
  for (const [areaIndex, area] of areas.entries()) {
    const variants = ["overview", "search", "activity"] as const
    for (const [variant, suffix] of variants.entries()) {
      const id = firstGeneratedPrototypeId + areaIndex * variants.length + variant
      const name = `${area} ${suffix}`
      const authorLogin = data.users[(id - firstGeneratedPrototypeId) % data.users.length]!.login
      data.prototypes.push({
        id: String(id),
        repositoryId: "2001",
        name,
        branchName: `prototype/${name.toLowerCase().replaceAll(" ", "-")}`,
        description: [
          `Bring ${area.toLowerCase()} status, ownership, and next steps into one workspace.`,
          `Find ${area.toLowerCase()} with saved filters and clearer result summaries.`,
          `Follow recent changes to ${area.toLowerCase()} without losing your place.`,
        ][variant]!,
        authorLogin,
      })
      if (id % noBuildPrototypeInterval === 0) continue
      for (let number = 1; number <= minimumBuildCount + (id % buildCountVariation); number += 1) {
        data.builds.push(createFixtureBuild(id, number, authorLogin, name))
      }
    }
  }
  return data
}
