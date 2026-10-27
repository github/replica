import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { expect, test } from "vitest"

import { normalizeSpinnerSource } from "./normalize-shadcn.mjs"

const fixtureRoot = process.cwd()

const iconFixtures = [
  { icon: "LoaderCircle", module: "lucide-react" },
  { icon: "RiLoader4Line", module: "@remixicon/react" },
]

function spinnerSource({ icon, module, type = 'React.ComponentProps<"svg">' }) {
  return [
    `import * as React from "react"`,
    `import { ${icon} } from "${module}"`,
    "",
    `const marker = "preserve this source byte"`,
    "",
    `function Spinner(props: ${type}) {`,
    `  return (<${icon} aria-label="Loading" data-marker="keep" {...props} />)`,
    "}",
    "",
    "export { Spinner }",
    "",
  ].join("\r\n")
}

function hugeiconsSpinnerSource({
  type = 'React.ComponentProps<"svg">',
  iconAttributes = ["icon={Loading03Icon}"],
} = {}) {
  return [
    `import * as React from "react"`,
    `import { HugeiconsIcon } from "./hugeicons"`,
    `import { Loading03Icon } from "./hugeicons-glyph"`,
    "",
    `const marker = "preserve this source byte"`,
    "",
    `function Spinner(props: ${type}) {`,
    "  return (",
    "    <HugeiconsIcon",
    ...iconAttributes.map((attribute) => `      ${attribute}`),
    `      className="size-4"`,
    `      role="status"`,
    `      aria-label="Loading"`,
    "      {...props}",
    "    />",
    "  )",
    "}",
    "",
    "export { Spinner }",
    "",
  ].join("\r\n")
}

const strictIconDeclarations = {
  "strict-icon.d.ts": `import type * as React from "react"

export interface RemixiconProps {
  className?: string
  size?: number
  children?: never
}
export const RiLoader4Line: React.ComponentType<RemixiconProps>
`,
}

const hugeiconsDeclarations = {
  "hugeicons.d.ts": `import type * as React from "react"
import type { HugeiconsGlyph } from "./hugeicons-glyph"

export interface HugeiconsProps extends React.SVGProps<SVGSVGElement> {
  icon: HugeiconsGlyph
}
export const HugeiconsIcon: React.ComponentType<HugeiconsProps>
`,
  "hugeicons-glyph.d.ts": `export interface HugeiconsGlyph {
  name: string
}
export const Loading03Icon: HugeiconsGlyph
`,
}

const hugeiconsCaller = `import * as React from "react"
import { Spinner } from "./spinner"

const example = <Spinner className="size-4" role="status" aria-label="Loading" />
export { example }
`

function compileDiagnostics(source, declarationFiles = strictIconDeclarations, additionalFiles = {}) {
  const directory = mkdtempSync(join(fixtureRoot, ".normalize-shadcn-typecheck-"))
  try {
    const sourcePath = join(directory, "spinner.tsx")
    writeFileSync(sourcePath, source)
    for (const [file, contents] of Object.entries({ ...declarationFiles, ...additionalFiles })) {
      writeFileSync(join(directory, file), contents)
    }
    const options = {
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2020,
      types: ["react"],
    }
    const rootNames = [
      sourcePath,
      ...Object.keys(declarationFiles).map((file) => join(directory, file)),
      ...Object.keys(additionalFiles).map((file) => join(directory, file)),
    ]
    const program = ts.createProgram(rootNames, options)
    return ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("aligns Lucide and Remixicon-like Spinner props while preserving every other source byte", () => {
  for (const fixture of iconFixtures) {
    const source = spinnerSource(fixture)
    const result = normalizeSpinnerSource(source, ts)
    const expected = source.replace(
      'React.ComponentProps<"svg">',
      `React.ComponentProps<typeof ${fixture.icon}>`,
    )

    expect(result).toEqual({
      source: expected,
      changed: true,
      icon: fixture.icon,
    })
  }
})

test("omits only a required Hugeicons glyph prop and preserves the public SVG props", () => {
  const source = hugeiconsSpinnerSource()
  const result = normalizeSpinnerSource(source, ts)
  const expected = source.replace(
    'React.ComponentProps<"svg">',
    'Omit<React.ComponentProps<typeof HugeiconsIcon>, "icon">',
  )

  expect(result).toEqual({
    source: expected,
    changed: true,
    icon: "HugeiconsIcon",
  })
  expect(result.source).toContain("icon={Loading03Icon}")
  expect(result.source).toContain('className="size-4"')
  expect(result.source).toContain('role="status"')
  expect(result.source).toContain('aria-label="Loading"')
  expect(
    compileDiagnostics(result.source, hugeiconsDeclarations, { "caller.tsx": hugeiconsCaller }),
  ).toEqual([])
})

test("aligns a strict Remixicon-like prop type so the generated Spinner compiles", () => {
  const source = spinnerSource({ ...iconFixtures[1], module: "./strict-icon" })
  const before = compileDiagnostics(source)
  expect(before.length).toBeGreaterThan(0)
  expect(before.join("\n")).toMatch(/children|ReactNode|never/i)

  const result = normalizeSpinnerSource(source, ts)
  expect(compileDiagnostics(result.source)).toEqual([])
})

test("leaves an already aligned Spinner unchanged", () => {
  for (const fixture of iconFixtures) {
    const source = spinnerSource({
      ...fixture,
      type: `React.ComponentProps<typeof ${fixture.icon}>`,
    })
    expect(normalizeSpinnerSource(source, ts)).toEqual({
      source,
      changed: false,
      icon: fixture.icon,
    })
  }

  const source = hugeiconsSpinnerSource({
    type: 'Omit<React.ComponentProps<typeof HugeiconsIcon>, "icon">',
  })
  expect(normalizeSpinnerSource(source, ts)).toEqual({
    source,
    changed: false,
    icon: "HugeiconsIcon",
  })
})

test("rejects unknown or ambiguous Spinner icon shapes explicitly", () => {
  const cases = [
    spinnerSource({ icon: "LoaderCircle", module: "lucide-react" })
      .replace("return (<LoaderCircle", "return (<UnknownIcon"),
    [
      `import * as React from "react"`,
      `import { Loader, LoaderCircle } from "lucide-react"`,
      "",
      `function Spinner(props: React.ComponentProps<"svg">) {`,
      "  return (<>",
      "    <Loader {...props} />",
      "    <LoaderCircle {...props} />",
      "  </>)",
      "}",
    ].join("\n"),
    hugeiconsSpinnerSource({ iconAttributes: ["icon={createGlyph()}"] }),
    hugeiconsSpinnerSource({
      iconAttributes: ["icon={Loading03Icon}", "icon={Loading03Icon}"],
    }),
    hugeiconsSpinnerSource({
      type: 'Omit<React.ComponentProps<typeof HugeiconsIcon>, "className">',
    }),
  ]

  for (const source of cases) {
    expect(() => normalizeSpinnerSource(source, ts)).toThrow(
      /Cannot normalize shadcn Spinner:/,
    )
  }
})
