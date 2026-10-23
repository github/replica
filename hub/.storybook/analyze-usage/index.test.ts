// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { describe, expect, it } from "vitest"

import { analyzeUsage } from "./index"

async function writeSources(root: string, sources: Record<string, string>) {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        paths: {
          "@/*": ["./app/javascript/*"],
          "@components/*": ["./app/javascript/components/*"],
          "@features/*": ["./app/javascript/features/*"],
          "@pages/*": ["./app/javascript/pages/*"],
        },
      },
      include: ["app/javascript/**/*", "app/views/**/*.tsx"],
    }),
    ...sources,
  }
  await Promise.all(
    Object.entries(files).map(async ([path, source]) => {
      const target = join(root, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, source)
    }),
  )
}

describe("analyzeUsage()", () => {
  it("counts JSX locations by consumer and resolves aliases without counting unused or type imports", async () => {
    const root = await mkdtemp(join(tmpdir(), "replica-analyze-usage-"))
    try {
      await writeSources(root, {
        "app/javascript/components/widget/index.tsx": `
export function Widget() { return <span /> }
export default Widget
`,
        "app/javascript/components/unused/index.tsx":
          "export default function Unused() { return <span /> }",
        "app/javascript/components/type-only/index.tsx":
          "export function TypeOnlyWidget() { return <span /> }",
        "app/javascript/components/exports/index.ts":
          'export { Widget as RenamedWidget } from "../widget"',
        "app/javascript/features/consumer.tsx": [
          'import DefaultWidget from "@components/widget"',
          'import { Widget as RelativeWidget } from "../components/widget"',
          'import { RenamedWidget } from "@components/exports"',
          'import * as Components from "@components/exports"',
          'import Unused from "@components/unused"',
          'import type { TypeOnlyWidget } from "@components/type-only"',
          "type WidgetType = typeof TypeOnlyWidget",
          "export function Consumer() {",
          "  return <>",
          "    <DefaultWidget />",
          "    <RelativeWidget></RelativeWidget>",
          "    <RenamedWidget />",
          "    <Components.RenamedWidget /><Components.RenamedWidget />",
          "  </>",
          "}",
        ].join("\n"),
        "app/javascript/pages/example.tsx": [
          'import Widget from "@components/widget"',
          "export default function Example() {",
          "  return <Widget />",
          "}",
        ].join("\n"),
      })

      const result = analyzeUsage(root)

      expect(result.components["app/javascript/components/widget/index.tsx"]).toEqual({
        consumers: [
          { path: "app/javascript/features/consumer.tsx", lines: [10, 11, 12, 13, 13] },
          { path: "app/javascript/pages/example.tsx", lines: [3] },
        ],
        surfaces: ["app/javascript/pages/example.tsx"],
      })
      expect(result.components["app/javascript/components/unused/index.tsx"]).toEqual({
        consumers: [],
        surfaces: [],
      })
      expect(result.components["app/javascript/components/type-only/index.tsx"]).toEqual({
        consumers: [],
        surfaces: [],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("excludes stories, test files, and test or Storybook directories from production usage", async () => {
    const root = await mkdtemp(join(tmpdir(), "replica-analyze-usage-"))
    try {
      const render = `
import Widget from "@components/widget"
export default function Example() { return <Widget /> }
`
      await writeSources(root, {
        "app/javascript/components/widget/index.tsx":
          "export default function Widget() { return <span /> }",
        "app/javascript/components/widget/stories.tsx": `
import Widget from "./index"
export default { component: Widget }
export const Example = { render: () => <Widget /> }
`,
        "app/javascript/pages/example.test.tsx": render,
        "app/javascript/pages/example.spec.tsx": render,
        "app/javascript/pages/test/example.tsx": render,
        "app/javascript/pages/tests/example.tsx": render,
        "app/javascript/pages/__tests__/example.tsx": render,
        "app/javascript/application/storybook/example.tsx": render,
        "app/javascript/features/test-support/render-prototype-canvas-hub-panel/index.tsx": render,
        "app/views/examples/show.test.tsx": render,
        "app/javascript/pages/contest/example.tsx": render,
      })

      const result = analyzeUsage(root)

      expect(result.components["app/javascript/components/widget/index.tsx"]).toEqual({
        consumers: [{ path: "app/javascript/pages/contest/example.tsx", lines: [3] }],
        surfaces: ["app/javascript/pages/contest/example.tsx"],
      })
      expect(result.stories["app/javascript/components/widget/stories.tsx"]).toEqual([
        "app/javascript/components/widget/index.tsx",
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("follows JSX consumer edges through cycles to pages, canvas applications, and Rails views", async () => {
    const root = await mkdtemp(join(tmpdir(), "replica-analyze-usage-"))
    try {
      await writeSources(root, {
        "app/javascript/components/widget/index.tsx":
          "export default function Widget() { return <span /> }",
        "app/javascript/features/first/index.tsx": [
          'import Widget from "@components/widget"',
          'import Second from "../second"',
          "export default function First() { return <><Widget /><Second /></> }",
        ].join("\n"),
        "app/javascript/features/second/index.tsx": [
          'import First from "../first"',
          "export default function Second() { return <First /> }",
        ].join("\n"),
        "app/javascript/pages/example/index.tsx": [
          'import First from "@features/first"',
          "export default function ExamplePage() { return <First /> }",
        ].join("\n"),
        "app/javascript/application/prototype-canvas/index.tsx": [
          'import Second from "@features/second"',
          "export default function Canvas() { return <Second /> }",
        ].join("\n"),
        "app/views/examples/show.tsx": [
          'import ExamplePage from "@pages/example"',
          "export default function ExampleView() { return <ExamplePage /> }",
        ].join("\n"),
        "app/javascript/pages/import-only.tsx": [
          'import Widget from "@components/widget"',
          "export default function ImportOnly() { return <main /> }",
        ].join("\n"),
      })

      const result = analyzeUsage(root)

      expect(result.components["app/javascript/components/widget/index.tsx"]).toEqual({
        consumers: [{ path: "app/javascript/features/first/index.tsx", lines: [3] }],
        surfaces: [
          "app/javascript/application/prototype-canvas/index.tsx",
          "app/javascript/pages/example/index.tsx",
          "app/views/examples/show.tsx",
        ],
      })
      expect(result.components["app/javascript/pages/example/index.tsx"]?.surfaces).toEqual([
        "app/views/examples/show.tsx",
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("maps default metadata component references through const and type wrappers without guessing from titles or renders", async () => {
    const root = await mkdtemp(join(tmpdir(), "replica-analyze-usage-"))
    try {
      await writeSources(root, {
        "app/javascript/components/widget/index.tsx":
          "export default function Widget() { return <span /> }",
        "app/javascript/components/other/index.tsx": "export function Other() { return <span /> }",
        "app/javascript/components/exports/index.ts":
          'export { default as RenamedWidget } from "../widget"',
        "app/javascript/components/widget/stories.tsx": `
import { RenamedWidget as Subject } from "@components/exports"
import { Other } from "@components/other"
type Meta = { title: string; component: unknown }
const meta = ({ title: "Not the component name", component: Subject } satisfies Meta)
export default meta
export const Example = { render: () => <Other /> }
`,
        "app/javascript/components/other/stories.tsx": `
import * as Components from "@components/other"
type Meta = { component: unknown }
export default (({ component: Components.Other }) as Meta)
`,
        "app/javascript/storybook/title-only/stories.tsx": `
import Widget from "@components/widget"
export default { title: "Components/Widget" }
export const Example = { render: () => <Widget /> }
`,
      })

      const result = analyzeUsage(root)

      expect(result.stories["app/javascript/components/widget/stories.tsx"]).toEqual([
        "app/javascript/components/widget/index.tsx",
      ])
      expect(result.stories["app/javascript/components/other/stories.tsx"]).toEqual([
        "app/javascript/components/other/index.tsx",
      ])
      expect(result.stories["app/javascript/storybook/title-only/stories.tsx"] ?? []).toEqual([])
      expect(Object.keys(result.stories).every((path) => path.endsWith("/stories.tsx"))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
