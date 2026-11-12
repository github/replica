import type { RepositoriesShowPageData } from "@pages/repositories-show-page/types"

import { welcomeFullPageScreenshot } from "./builds"
import { octocat } from "./users"

export const welcomePrototype: RepositoriesShowPageData["prototypes"][number] = {
  author: {
    avatarUrl: octocat.avatarUrl,
    label: "by @octocat",
    ownerLabel: "@octocat",
    url: "https://github.com/octocat",
  },
  branchName: "prototype/welcome",
  name: "Welcome",
  description: "Explore the new welcome flow.",
  id: "1",
  latestBuild: { state: "successful", stateLabel: "Successful" },
  path: "/repositories/2001/prototypes/1",
  reviewBuild: {
    number: 1,
    screenshotAlt: "Desktop screenshot of prototype/welcome, build 1",
    screenshotSrc: welcomeFullPageScreenshot,
  },
}
