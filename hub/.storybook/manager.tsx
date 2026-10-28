import React from "react"
import { AddonPanel } from "storybook/internal/components"
import { addons, types } from "storybook/manager-api"
import { create } from "storybook/theming"

import { UsagePanel } from "./usage-panel"

addons.register("replica/component-usage", () => {
  addons.add("replica/component-usage/panel", {
    type: types.PANEL,
    title: "Used in",
    render: ({ active }) => (
      <AddonPanel active={!!active}>
        <UsagePanel />
      </AddonPanel>
    ),
  })
})

addons.setConfig({
  theme: create({
    base: "light",
    brandTitle: "Replica Hub",
    brandUrl: "/?path=/story/hub-design-overview--taxonomy",
    brandTarget: "_self",
    colorPrimary: "#0969da",
    colorSecondary: "#8250df",
  }),
})
