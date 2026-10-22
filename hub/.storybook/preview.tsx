import type { Preview } from "@storybook/react-vite"

import { HubThemeProvider } from "@/hooks/use-hub-theme"

import "@/tokens/base.css"

import "./preview.css"

function hubColorMode(value: unknown): "auto" | "light" | "dark" {
  if (value === "light" || value === "dark") return value
  if (value === "day") return "light"
  if (value === "night") return "dark"

  return "auto"
}

const preview: Preview = {
  decorators: [
    (Story, context) => (
      <HubThemeProvider colorMode={hubColorMode(context.globals.colorMode)}>
        <Story />
      </HubThemeProvider>
    ),
  ],
  globalTypes: {
    colorMode: {
      description: "Hub color mode",
      toolbar: {
        icon: "paintbrush",
        items: [
          { value: "auto", title: "System" },
          { value: "day", title: "Light" },
          { value: "night", title: "Dark" },
        ],
      },
    },
  },
  initialGlobals: {
    colorMode: "auto",
  },
  parameters: {
    controls: { expanded: true },
    options: {
      storySort: {
        method: "alphabetical",
        order: ["Components", "Prototype canvas", "Hub", ["Design", "Pages", "Features"]],
      },
    },
    viewport: {
      options: {
        mobile: {
          name: "Mobile",
          styles: { width: "390px", height: "844px" },
        },
        tablet: {
          name: "Tablet",
          styles: { width: "768px", height: "1024px" },
        },
        narrowDesktop: {
          name: "Narrow desktop",
          styles: { width: "1024px", height: "768px" },
        },
        desktop: {
          name: "Desktop",
          styles: { width: "1440px", height: "900px" },
        },
      },
    },
  },
}

export default preview
